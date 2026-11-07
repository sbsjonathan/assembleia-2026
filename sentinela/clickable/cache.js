// clickable/cache.js

const CacheAnotacao = {
  /**
   * Salva o conteúdo no localStorage usando um ID único.
   * @param {string} id - O ID único da anotação (ex: "21-1").
   * @param {string} conteudo - O HTML do conteúdo a ser salvo.
   */
  salvar: function(id, conteudo) {
    if (!id) {
      console.warn("Tentativa de salvar anotação sem ID.");
      return;
    }
    try {
      localStorage.setItem(id, conteudo);
    } catch (e) {
      console.error("Erro ao salvar anotação no cache:", e);
    }
  },

  /**
   * Carrega o conteúdo do localStorage usando um ID.
   * @param {string} id - O ID da anotação a ser carregada.
   * @returns {string} - O conteúdo salvo ou uma string vazia.
   */
  carregar: function(id) {
    if (!id) return '';
    try {
      return localStorage.getItem(id) || '';
    } catch (e) {
      console.error("Erro ao carregar anotação do cache:", e);
      return '';
    }
  }
};

// Torna o objeto acessível globalmente para outros scripts
window.CacheAnotacao = CacheAnotacao;