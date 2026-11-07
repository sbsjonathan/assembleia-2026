'use strict';
// Source-backed full-text search. No generated associations or remote query service.
(function (root) {
  const BOOK_NAMES = ["Gênesis","Êxodo","Levítico","Números","Deuteronômio","Josué","Juízes","Rute","1 Samuel","2 Samuel","1 Reis","2 Reis","1 Crônicas","2 Crônicas","Esdras","Neemias","Ester","Jó","Salmos","Provérbios","Eclesiastes","Cântico de Salomão","Isaías","Jeremias","Lamentações","Ezequiel","Daniel","Oseias","Joel","Amós","Obadias","Jonas","Miqueias","Naum","Habacuque","Sofonias","Ageu","Zacarias","Malaquias","Mateus","Marcos","Lucas","João","Atos","Romanos","1 Coríntios","2 Coríntios","Gálatas","Efésios","Filipenses","Colossenses","1 Tessalonicenses","2 Tessalonicenses","1 Timóteo","2 Timóteo","Tito","Filêmon","Hebreus","Tiago","1 Pedro","2 Pedro","1 João","2 João","3 João","Judas","Apocalipse"];
  const STOP = new Set(['a','as','o','os','de','da','das','do','dos','e','em','no','nos','na','nas','um','uma','uns','umas','com','para','por','que','se','ao','aos']);
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
  const normalizedText = value => words(value).join(' ');
  // Only plural equivalents are folded; prefixes match from the start of a word.
  function stem(word) {
    if (word.length > 5 && word.endsWith('oes')) return word.slice(0,-3)+'ao';
    if (word.length > 5 && word.endsWith('aes')) return word.slice(0,-3)+'ao';
    if (word.length > 4 && /[aeio]s$/.test(word)) return word.slice(0,-1);
    return word;
  }
  function parseQuery(value) {
    const query=String(value || '').trim();
    const phrases=[...query.matchAll(/"([^"]+)"/g)].map(match=>normalizedText(match[1])).filter(Boolean);
    const all=words(query);let tokens=all.filter(word=>!STOP.has(word));
    if (!tokens.length) tokens=all;
    return {query,phrases,tokens:[...new Set(tokens)],terms:[...new Set(all.filter(word=>!STOP.has(word)))]};
  }
  const categoryOf = kind => kind==='verse'?'verses':kind==='note'?'notes':kind==='document'?'documents':'related';
  const targetKey = target => target?.book ? `${target.book}:${target.chapter}:${target.verse}-${target.endBook||target.book}:${target.endChapter||target.chapter}:${target.endVerse||target.verse}` : '';
  function passageLabel(index,target) {
    const title=(book,chapter,verse)=>index.verseRecords.get(`${book}:${chapter}:${verse}`)?.title||`${BOOK_NAMES[book-1]||book} ${chapter}:${verse}`;
    let label=title(target.book,target.chapter,target.verse);
    const endBook=target.endBook||target.book,endChapter=target.endChapter||target.chapter,endVerse=target.endVerse;
    if(endVerse&&(endBook!==target.book||endChapter!==target.chapter||endVerse!==target.verse))
      label+='–'+(endBook!==target.book?title(endBook,endChapter,endVerse):endChapter!==target.chapter?`${endChapter}:${endVerse}`:endVerse);
    return label;
  }
  function intersects(a,b) {
    const output=[];let i=0,j=0;
    while(i<a.length && j<b.length){if(a[i]===b[j]){output.push(a[i]);i++;j++;}else if(a[i]<b[j])i++;else j++;}
    return output;
  }
  function excerpt(text,terms,limit=235) {
    const source=String(text || '').replace(/\s+/g,' ').trim();if(source.length<=limit)return source;
    const normalized=normalize(source);let at=-1;
    for(const term of terms){const where=normalized.indexOf(term);if(where>=0 && (at<0||where<at))at=where;}
    let start=Math.max(0,at-65);if(start>0){const boundary=source.indexOf(' ',start);if(boundary>=0 && boundary<start+24)start=boundary+1;}
    let end=Math.min(source.length,start+limit);if(end<source.length){const boundary=source.lastIndexOf(' ',end);if(boundary>start+100)end=boundary;}
    return (start?'…':'')+source.slice(start,end)+(end<source.length?'…':'');
  }
  async function createIndex(records,onProgress=()=>{}) {
    const entries=[],postings=new Map(),unique=new Set(),verseRecords=new Map(),vocabulary=new Set();
    for(let i=0;i<records.length;i++) {
      const record=records[i];if(!record||!record.id||unique.has(record.id)||typeof record.text!=='string'||!record.target)continue;
      unique.add(record.id);const title=normalizedText(record.title),text=normalizedText(record.text),number=entries.length;
      entries.push({record,title,text});
      if(record.kind==='verse')verseRecords.set(`${record.target.book}:${record.target.chapter}:${record.target.verse}`,record);
      const rawTerms=[...words(record.title),...words(record.text)];
      for(const term of rawTerms)vocabulary.add(term);
      const terms=new Set(rawTerms.map(stem));
      for(const term of terms){let list=postings.get(term);if(!list){list=[];postings.set(term,list);}list.push(number);}
      if(i && i%2000===0){onProgress(Math.round(i/records.length*100));await new Promise(resolve=>setTimeout(resolve,0));}
    }
    for(const [term,list] of postings)postings.set(term,Uint32Array.from(list));
    return {entries,postings,verseRecords,vocabulary:[...vocabulary].sort()};
  }
  function lowerBound(values,value) {
    let low=0,high=values.length;
    while(low<high){const middle=(low+high)>>>1;if(values[middle]<value)low=middle+1;else high=middle;}
    return low;
  }
  function contains(values,value){return values?.[lowerBound(values||[],value)]===value;}
  function tokenMatches(word,token){return stem(word)===stem(token)||(token.length>=2&&word.startsWith(token));}
  function tokenPostings(index,token) {
    const exact=index.postings.get(stem(token))||new Uint32Array();
    // Search the raw vocabulary, not only stems: “coraçõe” must find “corações”.
    if(token.length<2)return {exact,list:exact};
    const vocabulary=index.vocabulary||[],terms=new Set([stem(token)]);
    for(let i=lowerBound(vocabulary,token);i<vocabulary.length&&vocabulary[i].startsWith(token);i++)terms.add(stem(vocabulary[i]));
    if(terms.size===1)return {exact,list:exact};
    const seen=new Uint8Array(index.entries.length),list=[];
    for(const term of terms)for(const number of index.postings.get(term)||[])if(!seen[number]){seen[number]=1;list.push(number);}
    list.sort((a,b)=>a-b);return {exact,list};
  }
  function matchedTerms(record,tokens) {
    return [...new Set([...words(record.title),...words(record.text)].filter(word=>tokens.some(token=>tokenMatches(word,token))))];
  }
  function search(index,options={}) {
    const parsed=parseQuery(options.query),limit=Math.max(1,Math.min(100,Number(options.limit)||30)),offset=Math.max(0,Math.floor(Number(options.offset)||0));
    const empty={items:[],total:0,counts:{all:0,verses:0,notes:0,documents:0,related:0},hasMore:false,queryTerms:parsed.terms};
    if(parsed.query.length<2||!parsed.tokens.length)return {...empty,message:'Digite uma palavra, um assunto ou uma referência bíblica.'};
    if(parsed.query.length>256)return {...empty,message:'Use uma busca de até 256 caracteres.'};
    const tokenLists=parsed.tokens.map(token=>tokenPostings(index,token));
    const lists=tokenLists.map(item=>item.list).sort((a,b)=>a.length-b.length);
    if(!lists[0]?.length)return empty;
    let candidates=Array.from(lists[0]);for(let i=1;i<lists.length&&candidates.length;i++)candidates=intersects(candidates,lists[i]);
    const phrase=normalizedText(parsed.query),hits=[],lexicalVerseTargets=new Set(),outlineTargets=new Set();
    for(const number of candidates){
      const entry=index.entries[number],all=' '+entry.title+' '+entry.text+' ';
      const exactMatches=tokenLists.map(item=>contains(item.exact,number));
      // Shared plural postings can include a spelling that lacks this prefix.
      if(parsed.tokens.some((token,i)=>!exactMatches[i]&&(token.length<2||!all.includes(' '+token))))continue;
      if(parsed.phrases.some(value=>!all.includes(' '+value+' ')))continue;
      const record=entry.record,exactTitle=entry.title===phrase,titlePhrase=(' '+entry.title+' ').includes(' '+phrase+' '),textPhrase=(' '+entry.text+' ').includes(' '+phrase+' ');
      const exact=exactMatches.every(Boolean),titleWords=words(entry.title);
      const titleTerms=parsed.tokens.filter(token=>titleWords.some(word=>exact?stem(word)===stem(token):tokenMatches(word,token))).length;
      const score=(exactTitle?180:0)+(titlePhrase?70:0)+(textPhrase?18:0)+titleTerms*9+({outline:50,verse:35,note:25,document:15}[record.kind]||0);
      hits.push({record,score,number,exact});
      if(record.kind==='verse')lexicalVerseTargets.add(targetKey(record.target));
      if(record.kind==='outline')outlineTargets.add(targetKey(record.target));
    }
    hits.sort((a,b)=>Number(b.exact)-Number(a.exact)||b.score-a.score||a.number-b.number);
    const related=new Map();
    for(const hit of hits){
      if(!['note','document'].includes(hit.record.kind))continue;
      const groups=hit.record.linkGroups||[{text:hit.record.text,links:hit.record.links||[]}];
      for(const group of groups){
        const text=normalizedText(group.text),tokens=words(group.text);
        if(parsed.tokens.some(token=>!tokens.some(word=>tokenMatches(word,token)))||parsed.phrases.some(phrase=>!(' '+text+' ').includes(' '+phrase+' ')))continue;
        for(const link of group.links){
        const key=targetKey(link.target);if(!key||lexicalVerseTargets.has(key)||outlineTargets.has(key))continue;
        const passageText=index.verseRecords.get(`${link.target.book}:${link.target.chapter}:${link.target.verse}`)?.text||'Referência citada no material de estudo. Abra a passagem para ler o texto bíblico.';
        const candidate={id:'r:'+key,kind:'related',title:link.label,source:'Referência citada em '+hit.record.title,text:passageText,target:link.target,
          related:true,reason:'Citada em um texto que corresponde à busca',origin:{title:hit.record.title,target:hit.record.target,source:hit.record.source}};
        if(!related.has(key))related.set(key,{record:candidate,score:hit.score*.15,number:related.size});
        }
      }
    }
    const combined=[...hits,...related.values()];
    const counts={all:combined.length,verses:0,notes:0,documents:0,related:0};
    for(const hit of combined)counts[categoryOf(hit.record.kind)]++;
    const category=['verses','notes','documents','related'].includes(options.category)?options.category:'all';
    const filtered=category==='all'?combined:combined.filter(hit=>categoryOf(hit.record.kind)===category);
    const items=filtered.slice(offset,offset+limit).map(({record})=>{
      const terms=matchedTerms(record,parsed.tokens);
      return {id:record.id,kind:record.kind,title:record.title,source:record.source,
        snippet:record.kind==='outline'?passageLabel(index,record.target):excerpt(record.text,terms),target:record.target,terms,
        ...(record.kind==='outline'?{related:true,reason:'Relato descrito no conteúdo do livro'}:{}),
        ...(record.related?{related:true,reason:record.reason,origin:record.origin}:{})};
    });
    return {items,total:filtered.length,counts,hasMore:offset+items.length<filtered.length,queryTerms:parsed.terms};
  }
  root.SentinelaSearchCore={normalize,words,normalizedText,stem,parseQuery,createIndex,search,bookName:(number,fallback)=>BOOK_NAMES[number-1]||fallback||String(number)};
})(typeof self!=='undefined'?self:globalThis);
