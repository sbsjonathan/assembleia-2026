class SupabaseSync {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.isOnline = navigator.onLine;
        this.initPromise = null;
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
            this.checkExistingSession();
            this.setupNetworkMonitoring();
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
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    checkExistingSession() {
        try {
            const savedUser = localStorage.getItem('supabase_user');
            this.currentUser = savedUser ? JSON.parse(savedUser) : null;
        } catch (error) {
            this.currentUser = null;
        }
    }

    setupNetworkMonitoring() {
        window.addEventListener('online', () => { this.isOnline = true; });
        window.addEventListener('offline', () => { this.isOnline = false; });
    }

    async ensureInitialized() {
        if (this.initPromise) {
            await this.initPromise;
        }
        return this.supabase !== null;
    }

    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + 'salt_app_2024');
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async cadastrarUsuario(usuario, senha, nomeCompleto) {
        await this.ensureInitialized();
        try {
            const { data: existing } = await this.supabase.from('usuarios').select('id').eq('usuario', usuario).single();
            if (existing) return { success: false, error: 'Usuário já existe' };

            const senhaHash = await this.hashPassword(senha);
            const { data: newUser, error } = await this.supabase.from('usuarios').insert({ usuario, senha_hash: senhaHash, nome_completo: nomeCompleto }).select().single();
            
            if (error) return { success: false, error: 'Erro ao criar usuário' };
            
            this.currentUser = newUser;
            localStorage.setItem('supabase_user', JSON.stringify({ id: newUser.id, usuario: newUser.usuario, nome: newUser.nome_completo }));
            return { success: true, userData: newUser };
        } catch (error) {
            return { success: false, error: 'Erro interno no cadastro' };
        }
    }

    async logarUsuario(usuario, senha) {
        await this.ensureInitialized();
        try {
            const senhaHash = await this.hashPassword(senha);
            const { data: userData, error } = await this.supabase.from('usuarios').select('*').eq('usuario', usuario).eq('senha_hash', senhaHash).single();

            if (error || !userData) return { success: false, error: 'Usuário ou senha incorretos' };

            this.currentUser = userData;
            localStorage.setItem('supabase_user', JSON.stringify({ id: userData.id, usuario: userData.usuario, nome: userData.nome_completo }));
            return { success: true, userData: userData };
        } catch (error) {
            return { success: false, error: 'Erro interno no login' };
        }
    }
    
    logout() {
        this.currentUser = null;
        localStorage.removeItem('supabase_user');
        window.dispatchEvent(new Event('supabaseLogout'));
    }
    
    isLoggedIn() {
        this.checkExistingSession();
        return this.currentUser !== null;
    }
    
    getCurrentUser() {
        this.checkExistingSession();
        return this.currentUser;
    }

    async carregarRichtextAnotacoes(semana) {
        const initialized = await this.ensureInitialized();
        this.checkExistingSession();
        // null means a successful query with no document, never a failed read.
        if (!initialized || !this.currentUser || !this.isOnline) throw new Error('Não foi possível consultar a nuvem.');
        const { data, error } = await this.supabase.from('richtext_anotacoes').select('conteudo_html').eq('usuario_id', this.currentUser.id).eq('semana', semana).eq('tipo', 'assembleia2026:richtext').maybeSingle();
        if (error) throw error;
        return data?.conteudo_html || null;
    }
    
    async salvarRichtextAnotacoes(semana, conteudo) {
        await this.ensureInitialized();
        this.checkExistingSession();
        if (!this.currentUser || !this.isOnline) return { success: false, error: 'Não conectado' };

        const userId = this.currentUser.id;
        try {
            const { data: existing, error: readError } = await this.supabase.from('richtext_anotacoes').select('id').eq('usuario_id', userId).eq('semana', semana).eq('tipo', 'assembleia2026:richtext').maybeSingle();
            if (readError) throw readError;
            this.checkExistingSession();
            if (this.currentUser?.id !== userId) throw new Error('A conta mudou durante o salvamento.');
            
            const { data, error } = existing
                ? await this.supabase.from('richtext_anotacoes').update({ conteudo_html: conteudo }).eq('id', existing.id).eq('usuario_id', userId).select().single()
                : await this.supabase.from('richtext_anotacoes').insert({ usuario_id: userId, semana, tipo: 'assembleia2026:richtext', conteudo_html: conteudo }).select().single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async carregarSentinelaAnotacoes(semana, estudoId) {
        await this.ensureInitialized();
        this.checkExistingSession();
        if (!this.currentUser || !this.isOnline) return null;

        try {
            const { data, error } = await this.supabase.from('richtext_anotacoes').select('conteudo_html').eq('usuario_id', this.currentUser.id).eq('semana', semana).eq('tipo', 'assembleia2026:sentinela_anotacoes').maybeSingle();
            if (error && error.code !== 'PGRST116') throw error;

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
        if (!this.currentUser || !this.isOnline) return { success: false, error: 'Não conectado' };

        try {
            const conteudoJSON = JSON.stringify({ estudo: estudoId, anotacoes, timestamp: new Date().toISOString() });
            const { data: existing } = await this.supabase.from('richtext_anotacoes').select('id').eq('usuario_id', this.currentUser.id).eq('semana', semana).eq('tipo', 'assembleia2026:sentinela_anotacoes').maybeSingle();

            const { data, error } = existing
                ? await this.supabase.from('richtext_anotacoes').update({ conteudo_html: conteudoJSON }).eq('id', existing.id).select().single()
                : await this.supabase.from('richtext_anotacoes').insert({ usuario_id: this.currentUser.id, semana, tipo: 'assembleia2026:sentinela_anotacoes', conteudo_html: conteudoJSON }).select().single();

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async carregarAssembleiaAnotacoes(ano) {
        const initialized = await this.ensureInitialized();
        this.checkExistingSession();
        if (!initialized || !this.currentUser || !this.isOnline) throw new Error('Não foi possível consultar a nuvem.');
        const userId = this.currentUser.id;
        const tipo = `assembleia2026:programacao:${ano}`;
        const { data, error } = await this.supabase.from('richtext_anotacoes').select('conteudo_html').eq('usuario_id', userId).eq('tipo', tipo).maybeSingle();
        if (error) throw error;
        this.checkExistingSession();
        if (this.currentUser?.id !== userId) throw new Error('A conta mudou durante a consulta.');
        // A missing document is different from a failed query or invalid JSON.
        if (!data) return null;
        const value = JSON.parse(data.conteudo_html);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O backup da nuvem está inválido.');
        return value;
    }

    async salvarAssembleiaAnotacoes(ano, anotacoesObj, options = {}) {
        try {
            const initialized = await this.ensureInitialized();
            this.checkExistingSession();
            if (!initialized || !this.currentUser || !this.isOnline) throw new Error('Não conectado');
            const userId = this.currentUser.id;
            const tipo = `assembleia2026:programacao:${ano}`;
            const { data: existing, error: readError } = await this.supabase.from('richtext_anotacoes').select('id, conteudo_html').eq('usuario_id', userId).eq('tipo', tipo).maybeSingle();
            if (readError) throw readError;
            if (Object.prototype.hasOwnProperty.call(options, 'expectedRemote')) {
                const current = existing ? JSON.parse(existing.conteudo_html) : null;
                const stable = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
                if (stable(current) !== stable(options.expectedRemote)) throw new Error('As notas da nuvem mudaram. Tente sincronizar novamente.');
            }
            this.checkExistingSession();
            if (this.currentUser?.id !== userId) throw new Error('A conta mudou durante o salvamento.');
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
            const initialized = await this.ensureInitialized();
            this.checkExistingSession();
            if (!initialized || !this.currentUser || !this.isOnline) throw new Error('Não conectado');
            const { error } = await this.supabase.from('richtext_anotacoes').delete().eq('usuario_id', this.currentUser.id).eq('tipo', `assembleia2026:programacao:${ano}`);
            if (error) throw error;
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    }

    async apagarAssembleiaDia(ano, dia) {
        try {
            if (!['sex', 'sab', 'dom'].includes(dia)) throw new Error('Dia inválido');
            const remote = await this.carregarAssembleiaAnotacoes(ano);
            if (!remote) return { success: true, removidos: 0 };
            const next = { ...remote };
            const keys = Object.keys(next).filter(key => key.startsWith(`${ano}-${dia}-`));
            keys.forEach(key => delete next[key]);
            const result = await this.salvarAssembleiaAnotacoes(ano, next, { expectedRemote: remote });
            return { ...result, removidos: result.success ? keys.length : 0 };
        } catch (error) { return { success: false, error: error.message }; }
    }

}

if (typeof window.SupabaseSync === 'undefined') {
    window.SupabaseSync = new SupabaseSync();
}