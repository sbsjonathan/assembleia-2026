class SupabaseSync {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.isOnline = navigator.onLine;
        this.initPromise = null;
        this.authGeneration = 0;
        // Local identity is available even when the SDK/network cannot load.
        this.checkExistingSession();
        this.setupNetworkMonitoring();
        this.initPromise = this.init();
    }

    async init() {
        try {
            if (typeof supabase === 'undefined') {
                await this.loadSupabaseLibrary();
            }
            const { createClient } = supabase;
            this.supabase = createClient(
                window.SUPABASE_CONFIG.url,
                window.SUPABASE_CONFIG.anonKey 
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    loadSupabaseLibrary() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = resolve;
            script.onerror = error => { script.remove(); reject(error); };
            document.head.appendChild(script);
        });
    }

    validUserIdentity(user) {
        if (!user || typeof user !== 'object' || Array.isArray(user)) return false;
        return typeof user.id === 'string' ? !!user.id.trim() : typeof user.id === 'number' && Number.isFinite(user.id);
    }

    checkExistingSession() {
        let raw;
        try { raw = localStorage.getItem('supabase_user'); }
        catch (_) {
            this.sessionUnavailable = true;
            return { status: 'unavailable', user: this.currentUser };
        }
        this.sessionUnavailable = false;
        if (raw === null) {
            this.currentUser = null;
            return { status: 'signed-out', raw };
        }
        try {
            const user = JSON.parse(raw);
            if (!this.validUserIdentity(user)) throw new Error('Invalid identity');
            this.currentUser = user;
            return { status: 'signed-in', raw, user };
        } catch (_) {
            // Keep the original value. Parsing or rendering failures are not logout.
            this.currentUser = null;
            return { status: 'invalid', raw };
        }
    }

    setupNetworkMonitoring() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.ensureInitialized();
        });
        window.addEventListener('offline', () => { this.isOnline = false; });
        window.addEventListener('storage', event => {
            if (event.storageArea === localStorage && (event.key === 'supabase_user' || event.key === null)) {
                this.authGeneration++;
                this.currentUser = null;
                this.checkExistingSession();
                window.dispatchEvent(new Event('supabaseSessionChanged'));
            }
        });
    }

    async ensureInitialized() {
        const attempt = this.initPromise;
        if (attempt) await attempt;
        if (!this.supabase && this.isOnline) {
            // Concurrent callers share one retry after a failed SDK load.
            if (this.initPromise === attempt) this.initPromise = this.init();
            await this.initPromise;
        }
        return this.supabase !== null;
    }

    storeSession(user, generation) {
        if (generation !== this.authGeneration) return false;
        if (!this.validUserIdentity(user)) {
            const error = new Error('Não foi possível confirmar sua conta. Tente novamente.');
            error.sessionFailure = true;
            throw error;
        }
        const stored = JSON.stringify({ id: user.id, usuario: user.usuario, nome: user.nome_completo,
            loginId: crypto.randomUUID() });
        // Publish success only after the one authoritative record is persisted.
        try { localStorage.setItem('supabase_user', stored); }
        catch (_) {
            const error = new Error('Não foi possível guardar sua entrada neste aparelho. Tente novamente.');
            error.sessionFailure = true;
            throw error;
        }
        this.currentUser = JSON.parse(stored);
        this.sessionUnavailable = false;
        window.dispatchEvent(new Event('supabaseSessionChanged'));
        return true;
    }

    async validateExistingSession() {
        const session = this.checkExistingSession();
        if (session.status !== 'signed-in') return session;
        if (!this.isOnline) return { status: 'offline' };
        try {
            const ready = await this.ensureInitialized();
            if (this.checkExistingSession().raw !== session.raw) return { status: 'changed' };
            if (!ready) return { status: 'unavailable' };
            const { data, error } = await this.supabase.from('usuarios')
                .select('id').eq('id', session.user.id).maybeSingle();
            if (this.checkExistingSession().raw !== session.raw) return { status: 'changed' };
            // HTTP/query/auth-service errors and ambiguous cardinality do not
            // establish that the account has ceased to exist.
            if (error || (data !== null && data?.id !== session.user.id)) return { status: 'unavailable' };
            if (data === null) {
                return { status: this.logout(session.raw) ? 'removed' : 'changed' };
            }
            return { status: 'valid' };
        } catch (_) {
            return { status: this.checkExistingSession().raw === session.raw ? 'unavailable' : 'changed' };
        }
    }

    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + 'salt_app_2024');
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async cadastrarUsuario(usuario, senha, nomeCompleto) {
        const generation = ++this.authGeneration;
        if (!await this.ensureInitialized()) return { success: false, error: 'Não foi possível conectar. Tente novamente.' };
        try {
            const { data: existing } = await this.supabase.from('usuarios').select('id').eq('usuario', usuario).single();
            if (existing) return { success: false, error: 'Usuário já existe' };

            const senhaHash = await this.hashPassword(senha);
            const { data: newUser, error } = await this.supabase.from('usuarios').insert({ usuario, senha_hash: senhaHash, nome_completo: nomeCompleto }).select().single();
            
            if (error) return { success: false, error: 'Erro ao criar usuário' };
            
            if (!this.storeSession(newUser, generation)) return { success: false, error: 'A entrada foi cancelada.' };
            return { success: true, userData: newUser };
        } catch (error) {
            return { success: false, error: error.sessionFailure ? error.message : 'Erro interno no cadastro' };
        }
    }

    async logarUsuario(usuario, senha) {
        const generation = ++this.authGeneration;
        if (!await this.ensureInitialized()) return { success: false, error: 'Não foi possível conectar. Tente novamente.' };
        try {
            const senhaHash = await this.hashPassword(senha);
            const { data: userData, error } = await this.supabase.from('usuarios').select('*').eq('usuario', usuario).eq('senha_hash', senhaHash).maybeSingle();

            if (error) return { success: false, error: 'Não foi possível verificar sua entrada. Tente novamente.' };
            if (!userData) return { success: false, error: 'Usuário ou senha incorretos' };

            if (!this.storeSession(userData, generation)) return { success: false, error: 'A entrada foi cancelada.' };
            return { success: true, userData: userData };
        } catch (error) {
            return { success: false, error: error.sessionFailure ? error.message : 'Erro interno no login' };
        }
    }
    
    logout(expectedRaw) {
        if (expectedRaw !== undefined && localStorage.getItem('supabase_user') !== expectedRaw) return false;
        localStorage.removeItem('supabase_user');
        this.authGeneration++;
        this.currentUser = null;
        try { localStorage.removeItem('last_login'); } catch (_) {}
        window.dispatchEvent(new Event('supabaseLogout'));
        window.dispatchEvent(new Event('supabaseSessionChanged'));
        return true;
    }
    
    isLoggedIn() {
        this.checkExistingSession();
        return this.currentUser !== null;
    }
    
    getCurrentUser() {
        this.checkExistingSession();
        return this.currentUser;
    }

    async readAssemblyDocument(semana, tipo, legacyTipo) {
        const initialized = await this.ensureInitialized();
        this.checkExistingSession();
        if (!initialized || this.sessionUnavailable || !this.currentUser || !this.isOnline) throw new Error('Não foi possível consultar a nuvem.');
        const userId = this.currentUser.id;
        const read = async name => {
            const { data, error } = await this.supabase.from('richtext_anotacoes').select('conteudo_html').eq('usuario_id', userId).eq('semana', semana).eq('tipo', name).maybeSingle();
            if (error) throw error;
            this.checkExistingSession();
            if (this.sessionUnavailable || this.currentUser?.id !== userId) throw new Error('A conta mudou durante a consulta.');
            return data;
        };
        // A stored empty document is authoritative. Only an absent new document
        // can read the former Assembly copy; writes always use the new identity.
        const current = await read(tipo);
        return current === null && legacyTipo ? await read(legacyTipo) : current;
    }

    async carregarRichtextAnotacoes(semana) {
        const data = await this.readAssemblyDocument(semana, 'ass26:richtext', 'assembleia2026:richtext');
        return data?.conteudo_html ?? null;
    }

    async salvarRichtextAnotacoes(semana, conteudo) {
        await this.ensureInitialized();
        this.checkExistingSession();
        if (this.sessionUnavailable || !this.currentUser || !this.isOnline) return { success: false, error: 'Não conectado' };

        const userId = this.currentUser.id;
        try {
            const { data: existing, error: readError } = await this.supabase.from('richtext_anotacoes').select('id').eq('usuario_id', userId).eq('semana', semana).eq('tipo', 'ass26:richtext').maybeSingle();
            if (readError) throw readError;
            this.checkExistingSession();
            if (this.sessionUnavailable || this.currentUser?.id !== userId) throw new Error('A conta mudou durante o salvamento.');
            
            const { data, error } = existing
                ? await this.supabase.from('richtext_anotacoes').update({ conteudo_html: conteudo }).eq('id', existing.id).eq('usuario_id', userId).select().single()
                : await this.supabase.from('richtext_anotacoes').insert({ usuario_id: userId, semana, tipo: 'ass26:richtext', conteudo_html: conteudo }).select().single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async carregarSentinelaAnotacoes(semana, estudoId) {
        await this.ensureInitialized();
        this.checkExistingSession();
        if (this.sessionUnavailable || !this.currentUser || !this.isOnline) return null;

        try {
            const data = await this.readAssemblyDocument(semana, 'ass26:sentinela_anotacoes', 'assembleia2026:sentinela_anotacoes');

            if (data?.conteudo_html) {
                const wrapper = JSON.parse(data.conteudo_html);
                return wrapper.anotacoes || null;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    
    async salvarSentinelaAnotacoes(semana, estudoId, anotacoes) {
        await this.ensureInitialized();
        this.checkExistingSession();
        if (this.sessionUnavailable || !this.currentUser || !this.isOnline) return { success: false, error: 'Não conectado' };

        try {
            const conteudoJSON = JSON.stringify({ estudo: estudoId, anotacoes, timestamp: new Date().toISOString() });
            const { data: existing } = await this.supabase.from('richtext_anotacoes').select('id').eq('usuario_id', this.currentUser.id).eq('semana', semana).eq('tipo', 'ass26:sentinela_anotacoes').maybeSingle();

            const { data, error } = existing
                ? await this.supabase.from('richtext_anotacoes').update({ conteudo_html: conteudoJSON }).eq('id', existing.id).select().single()
                : await this.supabase.from('richtext_anotacoes').insert({ usuario_id: this.currentUser.id, semana, tipo: 'ass26:sentinela_anotacoes', conteudo_html: conteudoJSON }).select().single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async carregarAssembleiaAnotacoes(ano) {
        if (ano !== 'ca-copgm27') throw new Error('Programa da assembleia incompatível. Atualize a página.');
        const initialized = await this.ensureInitialized();
        this.checkExistingSession();
        if (!initialized || this.sessionUnavailable || !this.currentUser || !this.isOnline) throw new Error('Não foi possível consultar a nuvem.');
        const userId = this.currentUser.id;
        const tipo = `ass26:programacao:${ano}`;
        const { data, error } = await this.supabase.from('richtext_anotacoes').select('conteudo_html').eq('usuario_id', userId).eq('tipo', tipo).maybeSingle();
        if (error) throw error;
        this.checkExistingSession();
        if (this.sessionUnavailable || this.currentUser?.id !== userId) throw new Error('A conta mudou durante a consulta.');
        // A missing document is different from a failed query or invalid JSON.
        if (!data) return null;
        const value = JSON.parse(data.conteudo_html);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O backup da nuvem está inválido.');
        return value;
    }

    async salvarAssembleiaAnotacoes(ano, anotacoesObj, options = {}) {
        try {
            if (ano !== 'ca-copgm27') throw new Error('Programa da assembleia incompatível. Atualize a página.');
            const initialized = await this.ensureInitialized();
            this.checkExistingSession();
            if (!initialized || this.sessionUnavailable || !this.currentUser || !this.isOnline) throw new Error('Não conectado');
            const userId = this.currentUser.id;
            const tipo = `ass26:programacao:${ano}`;
            const { data: existing, error: readError } = await this.supabase.from('richtext_anotacoes').select('id, conteudo_html').eq('usuario_id', userId).eq('tipo', tipo).maybeSingle();
            if (readError) throw readError;
            if (Object.prototype.hasOwnProperty.call(options, 'expectedRemote')) {
                const current = existing ? JSON.parse(existing.conteudo_html) : null;
                const stable = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
                if (stable(current) !== stable(options.expectedRemote)) throw new Error('As notas da nuvem mudaram. Tente sincronizar novamente.');
            }
            this.checkExistingSession();
            if (this.sessionUnavailable || this.currentUser?.id !== userId) throw new Error('A conta mudou durante o salvamento.');
            const conteudoJSON = JSON.stringify(anotacoesObj);
            // Preflight detects known conflicts. This backend has no verified revision
            // column, so simultaneous writes from different devices are not atomic.
            // Never put the full notes payload in a URL filter.
            const { data, error } = existing
                ? await this.supabase.from('richtext_anotacoes').update({ conteudo_html: conteudoJSON, semana: ano }).eq('id', existing.id).eq('usuario_id', userId).select().maybeSingle()
                : await this.supabase.from('richtext_anotacoes').insert({ usuario_id: userId, semana: ano, tipo, conteudo_html: conteudoJSON }).select().single();
            if (error) throw error;
            if (!data) throw new Error('As notas da nuvem mudaram. Tente sincronizar novamente.');
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async apagarAssembleiaCompleto(ano) {
        try {
            if (ano !== 'ca-copgm27') throw new Error('Programa da assembleia incompatível. Atualize a página.');
            const initialized = await this.ensureInitialized();
            this.checkExistingSession();
            if (!initialized || this.sessionUnavailable || !this.currentUser || !this.isOnline) throw new Error('Não conectado');
            const { error } = await this.supabase.from('richtext_anotacoes').delete().eq('usuario_id', this.currentUser.id).eq('tipo', `ass26:programacao:${ano}`);
            if (error) throw error;
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    }

    async apagarAssembleiaDia(ano, dia) {
        try {
            if (dia !== 'unico') throw new Error('Dia inválido');
            const remote = await this.carregarAssembleiaAnotacoes(ano);
            if (!remote) return { success: true, removidos: 0 };
            const next = { ...remote };
            const keys = Object.keys(next).filter(key => key.startsWith(`${ano}:`));
            keys.forEach(key => delete next[key]);
            const result = await this.salvarAssembleiaAnotacoes(ano, next, { expectedRemote: remote });
            return { ...result, removidos: result.success ? keys.length : 0 };
        } catch (error) { return { success: false, error: error.message }; }
    }

}

if (typeof window.SupabaseSync === 'undefined') {
    window.SupabaseSync = new SupabaseSync();
}