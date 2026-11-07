// save/sentinela-sync.js (Versão Final, Robusta e Corrigida)

class SentinelaSync {
    constructor() {
        this.semanaAtual = null;
        this.estudoId = null;
        this.isLoggedIn = false;
        this.isSyncing = false;
        this.autoSaveTimeout = null;
        this.lastSavedDataJSON = '{}';
        
        this.SAVE_DELAY = 2500; // 2.5 segundos de espera após a última anotação
        
        console.log('📖 SentinelaSync (Anotações) inicializando...');
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            // Um pequeno delay garante que as variáveis globais (semana, estudoId) do HTML já foram definidas
            setTimeout(() => this.setup(), 200);
        }
    }

    setup() {
        this.detectSemanaEEstudo();
        this.checkLoginStatus();
        
        if (this.isLoggedIn) {
            this.loadFromSupabase();
        }
        
        this.interceptCacheSalvar();
        
        console.log('✅ SentinelaSync (Anotações) configurado:', {
            semana: this.semanaAtual,
            estudo: this.estudoId,
            logado: this.isLoggedIn
        });
    }

    detectSemanaEEstudo() {
        const urlParams = new URLSearchParams(window.location.search);
        this.semanaAtual = window.semanaAtual || urlParams.get('semana');
        this.estudoId = window.estudoId || document.body.dataset.estudo;
    }

    checkLoginStatus() {
        this.isLoggedIn = !!localStorage.getItem('supabase_user');
    }

    // "Escuta" o salvamento no cache local para então disparar o salvamento na nuvem
    interceptCacheSalvar() {
        // CORREÇÃO DE TIMING: Se o cache.js ainda não carregou, espera e tenta de novo.
        if (!window.CacheAnotacao || typeof window.CacheAnotacao.salvar !== 'function') {
            console.warn('⚠️ CacheAnotacao não encontrado. Tentando novamente em 200ms...');
            setTimeout(() => this.interceptCacheSalvar(), 200);
            return;
        }

        const originalSalvar = window.CacheAnotacao.salvar.bind(window.CacheAnotacao);
        
        window.CacheAnotacao.salvar = (id, conteudo) => {
            originalSalvar(id, conteudo); // Primeiro, executa o salvamento local original
            this.scheduleAutoSave();    // Depois, agenda o salvamento na nuvem
        };

        console.log('🎯 Interceptador do CacheAnotacao ativado.');
    }

    scheduleAutoSave() {
        if (!this.isLoggedIn) return; // Só agenda se estiver logado
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => {
            this.executeAutoSave();
        }, this.SAVE_DELAY);
    }

    async executeAutoSave() {
        // ================== A CORREÇÃO MAIS IMPORTANTE ESTÁ AQUI ==================
        // Antes de salvar, ele verifica se o Supabase está pronto. Se não, ele REAGENDA
        // o salvamento para daqui a 1 segundo, em vez de falhar.
        if (!window.SupabaseSync || typeof window.SupabaseSync.salvarSentinelaAnotacoes !== 'function') {
            console.warn('⚠️ SupabaseSync não está pronto. Reagendando o salvamento...');
            this.scheduleAutoSave(); 
            return;
        }
        // =========================================================================

        if (this.isSyncing || !this.isLoggedIn) {
            return;
        }

        this.isSyncing = true;
        
        try {
            const anotacoes = this.collectAnnotationsFromLocalStorage();
            const anotacoesJSON = JSON.stringify(anotacoes);

            // Se nada mudou desde o último salvamento, não faz nada
            if (anotacoesJSON === this.lastSavedDataJSON) {
                this.isSyncing = false;
                return;
            }

            console.log(`💾 Enviando ${Object.keys(anotacoes).length} anotações da Sentinela para o Supabase...`);

            const result = await window.SupabaseSync.salvarSentinelaAnotacoes(
                this.semanaAtual,
                this.estudoId,
                anotacoes
            );

            if (result.success) {
                this.lastSavedDataJSON = anotacoesJSON;
                console.log('✅ Anotações da Sentinela salvas com sucesso na nuvem.');
            } else {
                console.error('❌ Erro no auto-save de anotações da Sentinela:', result.error);
            }

        } catch (error) {
            console.error('❌ Erro crítico no auto-save de anotações:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    // Carrega os dados da nuvem ao abrir a página, se estiver logado
    async loadFromSupabase() {
        // CORREÇÃO DE TIMING: Espera o Supabase estar pronto antes de carregar
        if (!window.SupabaseSync || typeof window.SupabaseSync.carregarSentinelaAnotacoes !== 'function') {
            setTimeout(() => this.loadFromSupabase(), 500);
            return;
        }
    
        const loadFlag = `sentinela_loaded_${this.semanaAtual}_${this.estudoId}`;
        if (sessionStorage.getItem(loadFlag)) return;
    
        try {
            const anotacoes = await window.SupabaseSync.carregarSentinelaAnotacoes(this.semanaAtual, this.estudoId);
    
            if (anotacoes && Object.keys(anotacoes).length > 0) {
                let localChangesExist = false;
                for (const [key, value] of Object.entries(anotacoes)) {
                    if (localStorage.getItem(key) !== value) {
                        localStorage.setItem(key, value);
                        localChangesExist = true;
                    }
                }
    
                if (localChangesExist) {
                    sessionStorage.setItem(loadFlag, 'true');
                    location.reload(); // Recarrega a página para exibir os dados baixados
                }
            }
        } catch (error) {
            console.error('❌ Erro ao carregar anotações da Sentinela:', error);
        }
    }
    
    // Coleta todas as anotações e marcações do cache local para enviar
    collectAnnotationsFromLocalStorage() {
        const anotacoes = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // Esta regex garante que pegamos comentários, respostas da IA, marcações, etc.
            if (/^(c-|r-|p-|obj-)|-pg-/.test(key)) {
                anotacoes[key] = localStorage.getItem(key);
            }
        }
        return anotacoes;
    }
}

// Inicializa a classe e a torna globalmente acessível
window.sentinelaSync = new SentinelaSync();