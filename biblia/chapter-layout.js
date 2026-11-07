'use strict';

// The publication supplies paragraph boundaries and exact annotation positions.
// Only structured text leaves the worker; no publication HTML is inserted in the UI.
function chapterTree(html) {
  const root = {tag:'root',attrs:{},children:[]}, stack = [root];
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const token of source.match(/<[^>]*>|[^<]+|</g) || []) {
    if (!token.startsWith('<')) { stack[stack.length-1].children.push(decodeEntities(token)); continue; }
    const closing = token.match(/^<\/\s*([a-z][\w-]*)/i);
    if (closing) {
      const name = closing[1].toLowerCase();
      for (let i=stack.length-1;i>0;i--) if (stack[i].tag===name) { stack.length=i; break; }
      continue;
    }
    const opening = token.match(/^<\s*([a-z][\w-]*)/i);
    if (!opening) continue;
    const node = {tag:opening[1].toLowerCase(),attrs:{},children:[]};
    for (const [,key,,quoted,bare] of token.matchAll(/\b(class|id|data-fnid|data-mid)\s*=\s*(?:(["'])(.*?)\2|([^\s>]+))/gi)) node.attrs[key.toLowerCase()]=decodeEntities(quoted ?? bare ?? '');
    stack[stack.length-1].children.push(node);
    if (!/^(?:br|hr|img|input|meta|link|wbr)$/.test(node.tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  return root;
}
function layoutNodeText(node) {
  if (typeof node === 'string') return node;
  if ((node.attrs.class || '').split(/\s+/).includes('tt')) return '';
  return node.children.map(layoutNodeText).join('');
}
function parseChapterLayout(html, lookup) {
  const blocks=[], tree=chapterTree(html), footSymbols=['*','#','△','⊠','†','‡'];
  const blockTags=new Set(['p','h1','h2','h3','h4','h5','h6']);
  function paragraph(node) {
    const cls=(node.attrs.class || '').split(/\s+/);
    const block={type:cls.includes('ss')||cls.includes('sw')?'heading':cls.includes('sl')||cls.includes('sz')?'poetry':'paragraph',indent:cls.includes('sz')?1:0,parts:[]};
    if (cls.includes('sw')) block.superscription=true;
    const add=part=>{
      if (!part.text) return;
      const prev=block.parts[block.parts.length-1];
      if (prev && !prev.note && !part.note && !prev.number && !part.number && prev.verse===part.verse && prev.strong===part.strong && prev.emphasis===part.emphasis) prev.text+=part.text;
      else block.parts.push(part);
    };
    function inline(item, inherited={}) {
      if (typeof item==='string') { add({text:item.replace(/[\r\n\t]+/g,' '),...inherited}); return; }
      const classes=(item.attrs.class || '').split(/\s+/);
      if (classes.includes('tt') || classes.includes('pageNum')) return;
      const verseMatch=(item.attrs.id || '').match(/^v(\d+)-(\d+)-(\d+)(?:-\d+)?$/);
      const flags={...inherited};
      if (verseMatch) flags.verse=Number(verseMatch[3]);
      if (classes.includes('cl') || classes.includes('vl')) {
        const n=flags.verse ?? Number(layoutNodeText(item).trim());
        if (Number.isInteger(n)) add({text:classes.includes('cl')?String(lookup.chapter):String(n),verse:n,number:true,...(classes.includes('cl')?{chapter:true}:{}),...(classes.includes('noLink')?{detached:true}:{}),...(lookup.studyByVerse?.has(n)?{studyNotes:lookup.studyByVerse.get(n).map(x=>x.note)}:{})});
        add({text:' ',verse:n});
        return;
      }
      if (classes.includes('fn') && item.attrs['data-fnid']) {
        const target=lookup.footnotes.get(Number(item.attrs['data-fnid']));
        if (target!=null) {
          const sourceLabel=layoutNodeText(item).trim(), index=sourceLabel.toLowerCase().charCodeAt(0)-97;
          const label=footSymbols[index] || '*';
          add({text:label,verse:flags.verse,note:{id:`fn:${target}`,kind:'footnote',label,title:'Nota de rodapé'}});
        }
        return;
      }
      if (classes.includes('m') && item.attrs['data-mid']) {
        const blockNumber=Number(item.attrs['data-mid']);
        if (lookup.marginals.has(blockNumber)) {
          const label=layoutNodeText(item).trim() || '+';
          add({text:label,verse:flags.verse,note:{id:`marginal:${lookup.document}:${blockNumber}`,kind:'reference',label,title:'Referências cruzadas'}});
        }
        return;
      }
      if (item.tag==='br') { add({text:'\n',...flags}); return; }
      if (item.tag==='strong' || item.tag==='b') flags.strong=true;
      if (item.tag==='em' || item.tag==='i') flags.emphasis=true;
      for (const child of item.children) inline(child,flags);
    }
    for (const child of node.children) inline(child);
    while (block.parts.length && !block.parts[0].note && !block.parts[0].number && !block.parts[0].text.trim()) block.parts.shift();
    if (block.parts[0] && !block.parts[0].note && !block.parts[0].number) block.parts[0].text=block.parts[0].text.trimStart();
    const last=block.parts[block.parts.length-1];if(last && !last.note) last.text=last.text.trimEnd();
    if (block.parts.length) blocks.push(block);
  }
  function walk(node) {
    if (typeof node==='string') return;
    // The chapter HTML also carries a hidden collection of footnote bodies.
    // They are opened separately via their inline markers and must not become
    // additional paragraphs after the scripture itself.
    const classes=(node.attrs.class || '').split(/\s+/);
    if (classes.includes('groupFootnote') || classes.includes('fn-ref')) return;
    if (blockTags.has(node.tag)) paragraph(node);
    else for (const child of node.children) walk(child);
  }
  walk(tree);
  // Study terms are carried in the commentary itself. Mark matching words in the
  // appropriate verse, retaining the original text and every annotation position.
  for (const block of blocks) {
    const result=[];
    for (const part of block.parts) {
      const candidates=lookup.studyByVerse?.get(part.verse);
      if (part.number || part.note || !candidates?.length) {result.push(part);continue;}
      const matches=[];
      for (const candidate of candidates) for (const term of candidate.terms) {
        const pattern=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'[\\s\\u00a0]+');
        let match;
        try {match=new RegExp(pattern,'iu').exec(part.text);} catch {continue;}
        if (match && match[0].length>2) matches.push({start:match.index,end:match.index+match[0].length,note:candidate.note});
      }
      matches.sort((a,b)=>a.start-b.start || b.end-a.end);
      let at=0;
      for (const m of matches) {
        if (m.start<at) continue;
        if(m.start>at) result.push({...part,text:part.text.slice(at,m.start)});
        result.push({...part,text:part.text.slice(m.start,m.end),strong:true,note:m.note});at=m.end;
      }
      if(at<part.text.length) result.push({...part,text:part.text.slice(at)});
    }
    block.parts=result;
  }
  return blocks;
}
async function chapterLayout(active,book,chapter) {
  const db=active.db, tables=tablesOf(active);
  const row=query(db,'SELECT Content,FirstVerseId,LastVerseId FROM BibleChapter WHERE BookNumber=? AND ChapterNumber=?',[book,chapter])[0];
  if (!row?.[0]) return [];
  const document=query(db,'SELECT BookDocumentId FROM BibleBook WHERE BibleBookId=?',[book])[0]?.[0];
  const footnotes=new Map(),marginals=new Set(),studyByVerse=new Map();
  if(tables.has('Footnote')) for(const [index,id] of query(db,'SELECT FootnoteIndex,FootnoteId FROM Footnote WHERE DocumentId=? AND BibleVerseId BETWEEN ? AND ?',[document,row[1],row[2]])) footnotes.set(index,id);
  if(tables.has('BibleCitation')) for(const [block] of query(db,'SELECT DISTINCT BlockNumber FROM BibleCitation WHERE DocumentId=? AND BibleVerseId BETWEEN ? AND ? AND FirstBibleVerseId IS NOT NULL',[document,row[1],row[2]])) marginals.add(block);
  if(tables.has('VerseCommentary') && tables.has('VerseCommentaryMap')) {
    const commentaries=query(db,'SELECT m.BibleVerseId,c.VerseCommentaryId,c.Content,c.Label,v.Content FROM VerseCommentaryMap m JOIN VerseCommentary c ON c.VerseCommentaryId=m.VerseCommentaryId JOIN BibleVerse v ON v.BibleVerseId=m.BibleVerseId WHERE m.BibleVerseId BETWEEN ? AND ? ORDER BY m.VerseCommentaryMapId',[row[1],row[2]]);
    const cache=new Map();
    for(const [,id,content,label,verseBlob] of commentaries) {
      const ref=verseReference(await decode(verseBlob,active.cipher));
      if(!ref) continue;
      if(!cache.has(id)) {
        const html=await decode(content,active.cipher);
        const terms=Array.from(html.matchAll(/<p\b[^>]*>\s*<strong\b[^>]*>([\s\S]*?)<\/strong>/gi),m=>plain(m[1]).replace(/[:：]\s*$/,'').trim()).filter(t=>t.length>2&&t.length<140);
        cache.set(id,{terms,note:{id:`study:${id}`,kind:'study',label:'Estudo',title:plain(label || '')||'Nota de estudo'}});
      }
      if(!studyByVerse.has(ref[2])) studyByVerse.set(ref[2],[]);
      studyByVerse.get(ref[2]).push(cache.get(id));
    }
  }
  return parseChapterLayout(await decode(row[0],active.cipher),{document,chapter,footnotes,marginals,studyByVerse});
}
async function readMarginalNote(active,value) {
  const match=typeof value==='string'&&value.match(/^marginal:(\d+):(\d+)$/);
  if(!match || !tablesOf(active).has('BibleCitation')) fail('Referência inválida.');
  const document=Number(match[1]),block=Number(match[2]);
  if(!Number.isSafeInteger(document)||!Number.isSafeInteger(block)) fail('Referência inválida.');
  const rows=query(active.db,'SELECT FirstBibleVerseId,LastBibleVerseId FROM BibleCitation WHERE DocumentId=? AND BlockNumber=? AND FirstBibleVerseId IS NOT NULL ORDER BY SortPosition,ElementNumber,BibleCitationId',[document,block]);
  if(!rows.length) fail('Referência não encontrada nesta edição.');
  const names=new Map(query(active.db,'SELECT BibleBookId,COALESCE(ChapterDisplayTitle,BookDisplayTitle) FROM BibleBook').map(([n,t])=>[n,plain(t)]));
  const links=[],seen=new Set();
  for(const [first,last] of rows) {
    const key=`${first}:${last}`;if(seen.has(key))continue;seen.add(key);
    const begin=await verseTarget(active,first);if(!begin)continue;
    const end=last!=null&&last!==first?await verseTarget(active,last):null;
    let label=`${names.get(begin.book)||begin.book} ${begin.chapter}:${begin.verse}`;
    if(end) label+=end.book!==begin.book?`–${names.get(end.book)||end.book} ${end.chapter}:${end.verse}`:end.chapter!==begin.chapter?`–${end.chapter}:${end.verse}`:`–${end.verse}`;
    links.push({...begin,label,...(end?{endBook:end.book,endChapter:end.chapter,endVerse:end.verse}:{})});
  }
  return {title:'Referências cruzadas',kind:'reference',text:'',links};
}
