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
            const { data: existing, error: readError } = await this.supabase.from('usuarios').select('id').eq('usuario', usuario).maybeSingle();
            if (readError) return { success: false, error: 'Não foi possível verificar o cadastro. Tente novamente.' };
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

    assertDocumentSession(session) {
        const current = this.checkExistingSession();
        if (current.status !== 'signed-in' || current.raw !== session.raw) {
            throw new Error('A conta mudou ou ficou indisponível. As anotações locais foram mantidas.');
        }
        if (!this.isOnline) throw new Error('Sem conexão. As anotações continuam salvas neste aparelho.');
    }

    async documentSession() {
        // Capture identity before the first await, including a same-account relogin.
        const session = this.checkExistingSession();
        if (session.status !== 'signed-in') throw new Error('Entre na sua conta para sincronizar.');
        this.assertDocumentSession(session);
        const ready = await this.ensureInitialized();
        this.assertDocumentSession(session);
        if (!ready) throw new Error('Não foi possível conectar à nuvem. Tente novamente.');
        return session;
    }

    documentError(error) {
        if (error?.code === '23505') return 'As notas da nuvem mudaram. Tente sincronizar novamente.';
        if (error?.code === '22001') return 'O banco recusou o identificador deste documento. Atualize o aplicativo.';
        return error?.message || 'Não foi possível confirmar a operação na nuvem. Tente novamente.';
    }

    documentScope(semana, tipo, aliases = [], decode = value => value) {
        // Keep both identifiers within the reported varchar(20) limit. Programme
        // identity belongs in semana, not appended to tipo; no truncation needed.
        if (typeof semana !== 'string' || !semana.trim() || semana.length > 20 || tipo.length > 20) {
            throw new Error('Identificador do documento inválido. Atualize a página.');
        }
        return { semana, tipo, aliases, decode };
    }

    documentObject(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('O backup da nuvem está inválido. Nenhuma anotação foi substituída.');
        }
        return value;
    }

    stableDocument(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(item => this.stableDocument(item)).join(',') + ']';
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + this.stableDocument(value[key])).join(',') + '}';
    }

    async readDocumentRow(session, scope, tipo) {
        this.assertDocumentSession(session);
        const { data, error } = await this.supabase.from('richtext_anotacoes')
            .select('id, conteudo_html').eq('usuario_id', session.user.id)
            .eq('semana', scope.semana).eq('tipo', tipo).maybeSingle();
        this.assertDocumentSession(session);
        if (error) throw new Error(this.documentError(error));
        // Undefined/malformed responses are failures, never an empty cloud.
        if (data !== null && (!data || data.id == null || typeof data.conteudo_html !== 'string')) {
            throw new Error('A nuvem retornou um documento inválido. Tente novamente.');
        }
        return data;
    }

    async readDocument(session, scope) {
        const canonical = await this.readDocumentRow(session, scope, scope.tipo);
        let row = canonical;
        for (const alias of scope.aliases) {
            if (row !== null) break;
            row = await this.readDocumentRow(session, scope, alias);
        }
        // Explicit empty content is authoritative and suppresses legacy fallback.
        return { canonical, row, value: row === null ? null : scope.decode(row.conteudo_html) };
    }

    async loadDocument(scope) {
        return (await this.readDocument(await this.documentSession(), scope)).value;
    }

    async writeDocument(scope, content, options = {}) {
        // Validate the payload before any write. Encode/decode has the same contract
        // as loading, including study identity checks and empty-document semantics.
        scope.decode(content);
        const session = await this.documentSession();
        // A new login to the same account must wait for an already-sent write
        // to that same row, while its own raw-session guard remains independent.
        const key = JSON.stringify([session.user.id, scope.tipo, scope.semana]);
        this.documentWrites ||= new Map();
        const previous = this.documentWrites.get(key) || Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            this.assertDocumentSession(session);
            const { canonical, value } = await this.readDocument(session, scope);
            if (Object.prototype.hasOwnProperty.call(options, 'expectedRemote') &&
                this.stableDocument(value) !== this.stableDocument(options.expectedRemote)) {
                throw new Error('As notas da nuvem mudaram. Tente sincronizar novamente.');
            }
            this.assertDocumentSession(session);
            // Preflight catches known conflicts. Cross-device compare-and-swap needs
            // a server revision/RPC; never put full note content into URL filters.
            const query = canonical
                ? this.supabase.from('richtext_anotacoes').update({ conteudo_html: content })
                    .eq('id', canonical.id).eq('usuario_id', session.user.id)
                    .eq('semana', scope.semana).eq('tipo', scope.tipo)
                : this.supabase.from('richtext_anotacoes').insert({ usuario_id: session.user.id,
                    semana: scope.semana, tipo: scope.tipo, conteudo_html: content });
            const { data, error } = await query.select('id, conteudo_html').maybeSingle();
            this.assertDocumentSession(session);
            if (error) throw new Error(this.documentError(error));
            if (!data || data.id == null || data.conteudo_html !== content) {
                throw new Error('A nuvem não confirmou o salvamento. As anotações locais foram mantidas.');
            }
            return { success: true, data };
        });
        this.documentWrites.set(key, operation);
        try { return await operation; }
        finally { if (this.documentWrites.get(key) === operation) this.documentWrites.delete(key); }
    }

    richtextScope(semana) {
        return this.documentScope(semana, 'ass26:richtext', ['assembleia2026:richtext'], value => {
            if (typeof value !== 'string') throw new Error('Conteúdo da anotação inválido.');
            return value;
        });
    }

    sentinelaScope(semana, estudoId) {
        if (estudoId == null || !String(estudoId).trim()) throw new Error('Estudo não identificado. Atualize a página.');
        return this.documentScope(semana, 'ass26:sentinela',
            ['ass26:sentinela_anotacoes', 'assembleia2026:sentinela_anotacoes'], value => {
                const wrapper = this.documentObject(JSON.parse(value));
                if (wrapper.estudo == null || String(wrapper.estudo) !== String(estudoId)) {
                    throw new Error('O backup pertence a outro estudo. Nenhuma anotação foi substituída.');
                }
                return this.documentObject(wrapper.anotacoes);
            });
    }

    assembleiaScope(ano) {
        if (ano !== 'ca-copgm27') throw new Error('Programa da assembleia incompatível. Atualize a página.');
        return this.documentScope(ano, 'ass26:programacao', [`ass26:programacao:${ano}`],
            value => this.documentObject(JSON.parse(value)));
    }

    async carregarRichtextAnotacoes(semana) {
        return this.loadDocument(this.richtextScope(semana));
    }

    async salvarRichtextAnotacoes(semana, conteudo, options = {}) {
        try { return await this.writeDocument(this.richtextScope(semana), conteudo, options); }
        catch (error) { return { success: false, error: this.documentError(error) }; }
    }

    async carregarSentinelaAnotacoes(semana, estudoId) {
        return this.loadDocument(this.sentinelaScope(semana, estudoId));
    }

    async salvarSentinelaAnotacoes(semana, estudoId, anotacoes, options = {}) {
        try {
            const content = JSON.stringify({ estudo: estudoId, anotacoes, timestamp: new Date().toISOString() });
            return await this.writeDocument(this.sentinelaScope(semana, estudoId), content, options);
        } catch (error) { return { success: false, error: this.documentError(error) }; }
    }

    async carregarAssembleiaAnotacoes(ano) {
        return this.loadDocument(this.assembleiaScope(ano));
    }

    async salvarAssembleiaAnotacoes(ano, anotacoesObj, options = {}) {
        try { return await this.writeDocument(this.assembleiaScope(ano), JSON.stringify(anotacoesObj), options); }
        catch (error) { return { success: false, error: this.documentError(error) }; }
    }

    async apagarAssembleiaCompleto(ano, options = {}) {
        // Keep an explicit empty current document so old names cannot restore
        // cleared contents on the next download. This never clears local storage.
        return this.salvarAssembleiaAnotacoes(ano, {}, options);
    }

    async apagarAssembleiaDia(ano, dia) {
        try {
            if (dia !== 'unico') throw new Error('Dia inválido');
            const scope = this.assembleiaScope(ano), session = await this.documentSession();
            const { value: remote } = await this.readDocument(session, scope);
            if (!remote) return { success: true, removidos: 0 };
            const next = { ...remote };
            const keys = Object.keys(next).filter(key => key.startsWith(`${ano}:`));
            keys.forEach(key => delete next[key]);
            this.assertDocumentSession(session);
            const result = await this.salvarAssembleiaAnotacoes(ano, next, { expectedRemote: remote });
            return { ...result, removidos: result.success ? keys.length : 0 };
        } catch (error) { return { success: false, error: error.message }; }
    }

}

if (typeof window.SupabaseSync === 'undefined') {
    window.SupabaseSync = new SupabaseSync();
}
