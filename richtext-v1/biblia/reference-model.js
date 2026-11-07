'use strict';

// References and the preview share one validated list of verses. No DOM or
// editor mutation happens here; Transcrever is the caller's commit boundary.
(() => {
  const defaultBaseURL = new URL('../../sentinela/biblia/data/', document.currentScript?.src || location.href);
  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[.\s\u00a0]/g, '').toLowerCase();
  const tuple = (chapter, verse) => `${chapter}:${verse}`;
  const compare = (a, b) => a.chapter - b.chapter || a.verse - b.verse;

  class NotesBibleReferenceModel {
    constructor({baseURL, aliases = {}} = {}) {
      this.baseURL = new URL(baseURL || defaultBaseURL, defaultBaseURL);
      this.aliases = new Map();
      this.books = new Map();
      for (const [alias, key] of Object.entries(aliases)) {
        if (!/^[1-3]?[a-z]+$/.test(key)) continue;
        this.aliases.set(normalize(alias), key);
        this.aliases.set(normalize(key), key);
      }
    }

    resolveBook(name) {
      const key = this.aliases.get(normalize(name));
      if (!key) throw new Error('Livro não reconhecido. Confira o nome ou a abreviação.');
      return key;
    }

    async loadBook(key) {
      if (!this.books.has(key)) {
        const pending = (async () => {
          const response = await fetch(new URL(`${key}.json`, this.baseURL));
          if (!response.ok) throw new Error('Não foi possível abrir este livro. Conecte-se para carregar o texto que ainda não está salvo.');
          const data = await response.json();
          if (!Array.isArray(data.capitulos) || !data.capitulos.length) throw new Error('O texto deste livro está indisponível.');
          const chapters = new Map(), byVerse = new Map(), verses = [];
          for (const chapter of data.capitulos) {
            const number = Number(chapter.capitulo);
            if (!Number.isInteger(number) || number < 1 || !Array.isArray(chapter.versiculos)) continue;
            const items = new Map();
            for (const entry of chapter.versiculos) {
              const verse = Number(entry.verso);
              if (!Number.isInteger(verse) || verse < 1 || typeof entry.texto !== 'string') continue;
              const item = Object.freeze({chapter: number, verse, text: entry.texto, newParagraph: !!entry.novo_paragrafo});
              items.set(verse, item);
              byVerse.set(tuple(number, verse), item);
            }
            if (items.size) chapters.set(number, items);
          }
          for (const item of byVerse.values()) verses.push(item);
          verses.sort(compare);
          if (!verses.length) throw new Error('O texto deste livro está indisponível.');
          return {key, name: String(data.nome_do_livro || key), chapters, byVerse, verses,
            lastChapter: Math.max(...chapters.keys())};
        })();
        this.books.set(key, pending);
        pending.catch(() => { if (this.books.get(key) === pending) this.books.delete(key); });
      }
      return this.books.get(key);
    }

    async parse(reference) {
      const text = String(reference || '').replace(/\u00a0/g, ' ').trim();
      const match = text.match(/^(.+?)\s*(\d{1,3})\s*[:;]\s*(.+)$/u);
      if (!match) throw new Error('Use livro, capítulo e versículo. Exemplo: João 3:16.');
      const key = this.resolveBook(match[1]), bookData = await this.loadBook(key);
      return this._model(bookData, this._parseExpression(bookData, `${match[2]}:${match[3]}`, Number(match[2])));
    }

    parseSelection(model, input, {append = true} = {}) {
      this._assertModel(model);
      const last = model.verses[model.verses.length - 1];
      const additions = this._parseExpression(model.bookData, input, last.chapter);
      return this._model(model.bookData, append ? model.verses.concat(additions) : additions);
    }

    _parseExpression(book, input, initialChapter) {
      const expression = String(input || '').replace(/[–—−]/g, '-').replace(/\u00a0/g, ' ').trim();
      if (!expression || expression.length > 8000) throw new Error('Informe os versículos. Exemplo: 2-5, 8 ou 2:1-3.');
      const parts = expression.split(/[;,]/), selected = [];
      let currentChapter = initialChapter;
      for (let part of parts) {
        part = part.trim();
        if (!part) throw new Error('Confira o intervalo: há um trecho vazio na referência.');
        if (/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(part)) {
          const named = part.match(/^(.+?)\s*(\d{1,3}\s*:.*)$/u);
          if (!named || this.resolveBook(named[1]) !== book.key) throw new Error('Ajuste os versículos de um livro por vez.');
          part = named[2];
        }
        const match = part.match(/^(?:(\d{1,3})\s*:\s*)?(\d{1,3})(?:\s*-\s*(?:(\d{1,3})\s*:\s*)?(\d{1,3}))?$/);
        if (!match) throw new Error('Intervalo inválido. Use 2-5, 8 ou 1:31-2:2.');
        const start = {chapter: Number(match[1] || currentChapter), verse: Number(match[2])};
        const end = {chapter: Number(match[3] || start.chapter), verse: Number(match[4] || start.verse)};
        if (compare(start, end) > 0) throw new Error('O fim do intervalo deve vir depois do início.');
        this._verse(book, start.chapter, start.verse);
        this._verse(book, end.chapter, end.verse);
        for (let chapter = start.chapter; chapter <= end.chapter; chapter++) {
          const items = this._chapter(book, chapter);
          const first = chapter === start.chapter ? start.verse : Math.min(...items.keys());
          const last = chapter === end.chapter ? end.verse : Math.max(...items.keys());
          // This edition intentionally omits some verse labels (John 8 starts
          // at 12). Traverse the published entries, never invent missing text.
          selected.push(...[...items.values()].filter(item => item.verse >= first && item.verse <= last).sort(compare));
        }
        currentChapter = end.chapter;
      }
      return selected;
    }

    _chapter(book, chapter) {
      const items = book.chapters.get(chapter);
      if (!items) throw new Error(`${book.name} ${chapter}: este capítulo não está disponível no texto salvo.`);
      return items;
    }

    _verse(book, chapter, verse) {
      const item = this._chapter(book, chapter).get(verse);
      if (!item) throw new Error(`${book.name} ${chapter}:${verse}: versículo inexistente ou indisponível no texto salvo.`);
      return item;
    }

    _assertModel(model) {
      if (!model?.bookData?.chapters || !model.verses?.length) throw new Error('Abra uma referência antes de ajustar os versículos.');
    }

    _model(book, verses) {
      const unique = new Map(verses.map(item => [tuple(item.chapter, item.verse), item]));
      const ordered = [...unique.values()].sort(compare);
      if (!ordered.length) throw new Error('Selecione pelo menos um versículo.');
      const model = {book: book.name, key: book.key, verses: Object.freeze(ordered), bookData: book};
      model.title = `${book.name} ${this.formatSelection(model)}`;
      return Object.freeze(model);
    }

    canAdd(model) {
      if (!model?.bookData?.verses?.length || !model.verses?.length) return false;
      return compare(model.verses[model.verses.length - 1], model.bookData.verses[model.bookData.verses.length - 1]) < 0;
    }

    canRemove(model) { return !!model?.verses && model.verses.length > 1; }

    adjust(model, delta) {
      this._assertModel(model);
      if (delta === -1) return this.canRemove(model) ? this._model(model.bookData, model.verses.slice(0, -1)) : model;
      if (delta !== 1) throw new Error('Ajuste inválido.');
      if (!this.canAdd(model)) return model;
      const last = model.verses[model.verses.length - 1], book = model.bookData;
      const currentChapter = [...this._chapter(book, last.chapter).values()].sort(compare);
      const next = currentChapter.find(item => item.verse > last.verse)
        || [...this._chapter(book, last.chapter + 1).values()].sort(compare)[0];
      return this._model(book, model.verses.concat(next));
    }

    formatSelection(model) {
      const groups = new Map();
      for (const item of model.verses) {
        if (!groups.has(item.chapter)) groups.set(item.chapter, []);
        groups.get(item.chapter).push(item.verse);
      }
      return [...groups].map(([chapter, numbers]) => {
        const ranges = [];
        let start = numbers[0], end = start;
        for (let i = 1; i <= numbers.length; i++) {
          if (numbers[i] === end + 1) { end = numbers[i]; continue; }
          ranges.push(start === end ? String(start) : `${start}-${end}`);
          start = end = numbers[i];
        }
        return `${chapter}:${ranges.join(', ')}`;
      }).join('; ');
    }
  }

  window.NotesBibleReferenceModel = NotesBibleReferenceModel;
})();
