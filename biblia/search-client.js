'use strict';
// Reference navigation and worker-backed text search share one input.
(() => {
  const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const compact = value => fold(value).replace(/[.\s]+/g, '');
  const literal = value => String(value).toLocaleLowerCase('pt-BR').replace(/[.\s]+/g, '');
  window.createBibleSearchProvider = ({getPublication, getBooks, readChapter}) => {
    let worker, serial = 0;
    const pending = new Map();
    function stop(error) {
      worker?.terminate(); worker = null;
      for (const call of pending.values()) { clearTimeout(call.timeout); call.reject(error); }
      pending.clear();
    }
    function request(args, onProgress) {
      if (!worker) {
        worker = new Worker('search-worker.js');
        worker.onmessage = ({data}) => {
          const call = pending.get(data.id);
          if (!call) return;
          if (data.progress) { call.onProgress?.(data.progress); return; }
          clearTimeout(call.timeout); pending.delete(data.id);
          data.error ? call.reject(new Error(data.error)) : call.resolve(data.result);
        };
        worker.onerror = () => stop(new Error('Não foi possível iniciar a busca. Tente novamente.'));
        worker.onmessageerror = () => stop(new Error('Não foi possível ler os resultados. Tente novamente.'));
      }
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timeout = setTimeout(() => stop(new Error('A busca demorou demais. Tente novamente.')), 180000);
        pending.set(id, {resolve, reject, onProgress, timeout});
        worker.postMessage({id, action:'search', args});
      });
    }
    function matchesBook(value) {
      const books = getBooks(), term = compact(value);
      const aliases = book => [book.name, ...(book.aliases || [])];
      // Keep Jó distinct from the customary abbreviation Jo for João.
      const exact = books.filter(book => aliases(book).some(alias => literal(alias) === literal(value)));
      if (exact.length) return exact;
      const normalized = books.filter(book => aliases(book).some(alias => compact(alias) === term));
      if (normalized.length) return normalized;
      return term.length >= 2 ? books.filter(book => aliases(book).some(alias => compact(alias).startsWith(term))) : [];
    }
    function page(items, {category='all', offset=0, limit=30}, message='') {
      const visible = category === 'all' || category === 'verses' ? items : [];
      const start = Math.max(0, Number(offset) || 0), size = Math.min(60, Math.max(1, Number(limit) || 30));
      return {items:visible.slice(start,start+size),total:visible.length,
        counts:{all:items.length,verses:items.length,notes:0,documents:0,related:0},
        hasMore:start+size<visible.length,queryTerms:[],message};
    }
    async function search(options) {
      const query = String(options.query || '').trim(), publication = getPublication();
      if (!publication) throw new Error('Aguarde a Bíblia terminar de abrir.');
      if (!query) return page([], options);
      if (query.length > 180) throw new Error('Use uma busca de até 180 caracteres.');
      const reference = query.match(/^(.+?)\s*(\d{1,3})(?:\s*[:.,]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/u);
      if (reference) {
        const books = matchesBook(reference[1]);
        if (books.length) {
          if (books.length > 1) return page([], options, 'Escreva o nome completo do livro para abrir a passagem.');
          const book = books[0], chapter = Number(reference[2]), verse = reference[3] ? Number(reference[3]) : null;
          const endVerse = reference[4] ? Number(reference[4]) : verse;
          if (chapter < 1 || chapter > Number(book.chapters) || verse != null && (verse < 1 || endVerse < verse))
            return page([], options, 'Confira o número do capítulo e do versículo.');
          const data = await readChapter(Number(book.number), chapter);
          if (publication !== getPublication()) return page([], options);
          if (verse != null && (!data.verses.some(v => Number(v.number) === verse) || !data.verses.some(v => Number(v.number) === endVerse)))
            return page([], options, 'Este versículo não existe no capítulo selecionado.');
          const selected = verse == null ? data.verses.slice(0,2) : data.verses.filter(v => v.number >= verse && v.number <= endVerse);
          const title = `${book.name} ${chapter}${verse == null ? '' : ':'+verse+(endVerse>verse?'–'+endVerse:'')}`;
          return page([{id:`reference:${publication}:${book.number}:${chapter}:${verse||1}:${endVerse||1}`,kind:'verse',title,
            source:'Passagem bíblica',snippet:selected.map(v => v.text).join(' '),
            target:{book:Number(book.number),chapter,verse:verse||1,...(endVerse>verse?{endVerse}:{})}}], options);
        }
      }
      const books = matchesBook(query);
      const category=options.category||'all',offset=Math.max(0,Math.floor(Number(options.offset)||0)),limit=Math.min(60,Math.max(1,Math.floor(Number(options.limit)||30)));
      const shortcuts=books.map(book=>({id:`book:${publication}:${book.number}`,kind:'book',title:book.name,
        source:'Livro bíblico',snippet:`${book.chapters} capítulos · Abrir a lista de capítulos`,terms:[book.name],
        target:{book:Number(book.number),showChapters:true}}));
      const quickItems=category==='all'?shortcuts.slice(offset,offset+limit):[];
      const textOffset=category==='all'?Math.max(0,offset-shortcuts.length):offset;
      const textLimit=limit-quickItems.length;
      // Count lexical results even when a page contains only book shortcuts.
      const result=await request({publication,query,category,offset:textOffset,limit:Math.max(1,textLimit)},options.onProgress);
      const items=[...quickItems,...(textLimit?result.items:[])],total=result.total+(category==='all'?shortcuts.length:0);
      return {...result,items,total,counts:{...result.counts,all:result.counts.all+shortcuts.length,books:shortcuts.length},
        nextOffset:offset+items.length,hasMore:offset+items.length<total};
    }
    return {search, destroy:() => stop(new Error('Busca encerrada.'))};
  };
})();
