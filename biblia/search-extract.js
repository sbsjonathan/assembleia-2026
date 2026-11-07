'use strict';
// Imported-edition fallback. Loaded only in the separate search worker, after the
// existing JWPUB reader helpers; the user's library database is never modified.
self.buildImportedSearchCorpus = async function (publication, notify) {
  const active=await selected(publication), db=active.db,tables=tablesOf(active);
  const records=[],verseTargets=new Map(),canonical=new Set(),bookNames=new Map(query(db,'SELECT BibleBookId,COALESCE(ChapterDisplayTitle,BookDisplayTitle) FROM BibleBook').map(([id,name])=>[id,plain(name)]));
  if(String(query(db,'SELECT MepsLanguageIndex FROM Publication LIMIT 1')[0]?.[0])==='5')for(const[id,name]of bookNames)bookNames.set(id,SentinelaSearchCore.bookName(id,name));
  const clean=value=>noteText(value||'').replace(/\s+/g,' ').trim();
  const normalized=value=>SentinelaSearchCore.normalize(clean(value));
  const titleFor=target=>{
    let label=`${bookNames.get(target.book)||target.book} ${target.chapter}:${target.verse}`;
    if(target.endVerse&&(target.endVerse!==target.verse||target.endChapter!==target.chapter))label+='–'+(target.endBook!==target.book?(bookNames.get(target.endBook)||target.endBook)+' ':'')+(target.endChapter!==target.chapter?target.endChapter+':':'')+target.endVerse;
    return label;
  };
  const linksFor=html=>{
    const seen=new Set();return noteLinks(active,html).filter(link=>link.book).flatMap(link=>{
      const {label,...target}=link,key=JSON.stringify(target);if(seen.has(key))return [];seen.add(key);return [{target,label:titleFor(target)}];
    });
  };
  function add(id,kind,title,text,target,source,links){
    text=clean(text);if(!text)return;
    records.push({id,kind,title:clean(title),text,target,source,...(links?.length?{links}:{})});
  }
  async function visit(sql,fn,label){
    const statement=db.prepare(sql);let count=0;
    try{while(statement.step()){await fn(statement.get());if(++count%150===0){notify(`${label}: ${count.toLocaleString('pt-BR')}…`);await new Promise(resolve=>setTimeout(resolve,0));}}}
    finally{statement.free();}
  }
  try{
    await visit('SELECT BibleVerseId,Content FROM BibleVerse ORDER BY BibleVerseId',async([id,blob])=>{
      if(!blob)return;const html=await decode(blob,active.cipher),reference=verseReference(html);if(!reference)return;
      const target={book:reference[0],chapter:reference[1],verse:Math.max(1,reference[2])};verseTargets.set(id,target);add(`v:${id}`,'verse',titleFor(target),html,target,'Texto bíblico');
    },'Indexando versículos');
    if(tables.has('BibleOutlineEntry'))await visit('SELECT BibleOutlineEntryId,Book,BeginChapterNumber,BeginVerseNumber,EndChapterNumber,EndVerseNumber,Content FROM BibleOutlineEntry ORDER BY BibleOutlineEntryId',async([id,book,chapter,verse,endChapter,endVerse,blob])=>{
      if(!blob||!chapter)return;const html=await decode(blob,active.cipher),text=clean(html);if(!/[A-Za-zÀ-ÿ]/.test(text))return;
      const target={book,chapter,verse:Math.max(1,verse||1),...(endVerse?{endBook:book,endChapter:endChapter||chapter,endVerse}:{})};
      add(`o:${id}`,'outline',text,text,target,'Conteúdo de '+(bookNames.get(book)||book));canonical.add(normalized(text));
    },'Indexando relatos');
    const studyParents=new Map();
    if(tables.has('VerseCommentaryMap'))for(const[note,verse]of query(db,'SELECT VerseCommentaryId,BibleVerseId FROM VerseCommentaryMap ORDER BY VerseCommentaryMapId'))if(verseTargets.has(verse)&&!studyParents.has(note))studyParents.set(note,verseTargets.get(verse));
    const footParents=tables.has('Footnote')?new Map(query(db,'SELECT FootnoteId,BibleVerseId FROM Footnote').map(([id,verse])=>[id,verseTargets.get(verse)])):new Map();
    for(const spec of [
      {table:'VerseCommentary',key:'VerseCommentaryId',label:'Label',prefix:'study',source:'Nota de estudo'},
      {table:'Footnote',key:'FootnoteId',label:'NULL',prefix:'fn',source:'Nota de rodapé'},
      {table:'Extract',key:'ExtractId',label:'Caption',prefix:'extract',source:'Glossário e trechos de referência'}]){
      if(!tables.has(spec.table))continue;
      await visit(`SELECT ${spec.key},${spec.label},Content FROM ${spec.table} ORDER BY ${spec.key}`,async([id,label,blob])=>{
        if(!blob)return;const html=await decode(blob,active.cipher),target={noteId:`${spec.prefix}:${id}`},parent=spec.prefix==='study'?studyParents.get(id):spec.prefix==='fn'?footParents.get(id):null;
        if(parent)Object.assign(target,parent);
        const heading=html.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);let title=parent?spec.source+' · '+titleFor(parent):clean(heading?.[1]||label)||spec.source;
        if(spec.prefix==='extract'&&!heading&&label)title=title.replace(/^\S+\s+/,'');
        add(`n:${spec.prefix}:${id}`,'note',title,html,target,spec.source);
        const groups=[];
        for(const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))if(clean(match[1])){
          canonical.add(normalized(match[1]));const links=linksFor(match[1]);if(links.length)groups.push({text:clean(match[1]),links});
        }
        if(groups.length)records[records.length-1].linkGroups=groups;
      },'Indexando notas');
    }
    if(tables.has('Document'))await visit('SELECT DocumentId,Title,Content FROM Document WHERE Content IS NOT NULL ORDER BY DocumentId',async([id,title,blob])=>{
      if(!blob)return;const html=await decode(blob,active.cipher),tree=documentTree(html);let number=0;
      function nodeText(node){return 'text'in node?node.text:(node.children||[]).map(nodeText).join('');}
      function nodeLinks(node){const out=[];function walk(n){if(n.tag==='a'){const target=documentLink(active,n.attrs.href||'','');if(target?.book){delete target.label;out.push({target,label:titleFor(target)});}}for(const child of n.children||[])walk(child);}walk(node);return out;}
      function walk(node){if('text'in node)return;const cls=(node.attrs?.class||'').split(/\s+/);if(['script','style','nav'].includes(node.tag)||cls.includes('groupFootnote'))return;
        const hasParagraph=n=>(n.children||[]).some(child=>child.tag==='p'||/^h[1-6]$/.test(child.tag||'')||hasParagraph(child));
        const standalone=['td','th','li','figcaption','dt','dd','caption'].includes(node.tag)&&!hasParagraph(node);
        if(node.tag==='p'||/^h[1-6]$/.test(node.tag)||standalone){
          const text=clean(nodeText(node));if(!text||canonical.has(normalized(text)))return;
          number++;const block=node.attrs.id,target={documentId:id};if(/^p\d+$/.test(block||''))target.paragraph=Number(block.slice(1));else if(block)target.blockId=block;
          add(`d:${id}:${block||number}`,'document',title,text,target,'Texto de estudo · '+clean(title),nodeLinks(node));return;
        }for(const child of node.children||[])walk(child);
      }walk(tree);
    },'Indexando textos de estudo');
    return records;
  }finally{closeCurrent();}
};
