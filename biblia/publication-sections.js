'use strict';
// Publication navigation and safe semantic document content. Imported by the worker.
// No source HTML, arbitrary URLs, CSS, or event handlers are passed to the page.
function sectionTitle(value) {
  const title = plain(value || '');
  const question = title.match(/^(Pergunta\s+\d+)\s*:\s*(.+)$/i);
  const appendix = title.match(/^([ABC]\d+(?:-[A-Z])?)\s+(.+)$/);
  return question ? {label:question[1].toLocaleUpperCase('pt-BR'),title:question[2]} : appendix ? {label:appendix[1],title:appendix[2]} : {label:'',title};
}
function sectionMedia(active) {
  if (active.sectionMedia) return active.sectionMedia;
  const byDocument = new Map();
  if (tablesOf(active).has('DocumentMultimedia') && tablesOf(active).has('Multimedia')) {
    const rows = query(active.db, `SELECT dm.DocumentId,m.FilePath,m.MimeType,m.Width,m.Height,m.CategoryType,m.Caption,dm.BeginParagraphOrdinal
      FROM DocumentMultimedia dm JOIN Multimedia m ON m.MultimediaId=dm.MultimediaId ORDER BY dm.DocumentMultimediaId`);
    for (const [id,file,mime,width,height,category,caption,paragraph] of rows) {
      if (typeof file !== 'string' || !/^[\w.-]+\.(?:jpe?g|png|gif|webp|svg)$/i.test(file) || !/^image\//.test(mime || '')) continue;
      if (!byDocument.has(id)) byDocument.set(id,[]);
      byDocument.get(id).push({file,mime,width,height,category,alt:plain(caption || ''),paragraph});
    }
  }
  active.sectionMedia = byDocument;
  return byDocument;
}
function sectionDocumentMap(active) {
  if (!active.sectionDocuments) {
    active.sectionDocuments = new Map(query(active.db,'SELECT MepsDocumentId,DocumentId FROM Document').map(([meps,id])=>[meps,id]));
  }
  return active.sectionDocuments;
}
function publicationSections(active) {
  const tables = tablesOf(active), db = active.db;
  const bookRows = query(db, `SELECT b.BibleBookId,b.BookDocumentId,b.IntroDocumentId,b.OverviewDocumentId,b.OutlineDocumentId FROM BibleBook b ORDER BY b.BibleBookId`);
  const bookDocuments = new Map(bookRows.map(row=>[row[1],row[0]]));
  const titleMap = new Map(query(db,'SELECT DocumentId,COALESCE(TocTitle,Title) FROM Document').map(([id,title])=>[id,plain(title || '')]));
  const bookInfo = {};
  for (const [book,,intro,overview,outline] of bookRows) {
    bookInfo[book] = [];
    for (const [id,kind] of [[intro,'intro'],[overview,'overview'],[outline,'outline']]) {
      if (id != null && titleMap.has(id)) bookInfo[book].push({id,documentId:id,title:titleMap.get(id),kind});
    }
  }
  const fallback = {sections:[{id:'books',title:'LIVROS',kind:'books',items:[]}],bookInfo};
  if (!tables.has('PublicationView') || !tables.has('PublicationViewItem')) return fallback;
  const view = query(db,"SELECT PublicationViewId FROM PublicationView WHERE Symbol='jwpub' LIMIT 1")[0];
  if (!view) return fallback;
  const rows = query(db, `SELECT PublicationViewItemId,ParentPublicationViewItemId,Title,DefaultDocumentId FROM PublicationViewItem WHERE PublicationViewId=? ORDER BY PublicationViewItemId`,[view[0]]);
  const children = new Map();
  for (const row of rows) {if(!children.has(row[1]))children.set(row[1],[]);children.get(row[1]).push(row);}
  const media = sectionMedia(active);
  const itemsFor = (parent,depth=0) => {
    if(depth>8)return [];
    const items=[];
    for (const [id,,rawTitle,documentId] of children.get(parent)||[]) {
      const title = sectionTitle(rawTitle);
      if (documentId == null || documentId < 0) {
        items.push({id,heading:true,...title},...itemsFor(id,depth+1));
      } else {
        const images = media.get(documentId)||[];
        const thumb = images.find(x=>x.category===9)||images.find(x=>x.category===17)||images[0];
        items.push({id,documentId,...title,...(bookDocuments.has(documentId)?{book:bookDocuments.get(documentId)}:{}),...(thumb?{thumbnail:thumb.file}:{})});
      }
    }
    return items;
  };
  const sections = (children.get(-1)||children.get(null)||[]).map(([id,,title])=>{
    const items=itemsFor(id), kind=items.some(item=>item.book)?'books':'documents';
    return {id:String(id),title:plain(title||''),kind,items};
  });
  return {sections:sections.length?sections:fallback.sections,bookInfo};
}
function documentTree(html) {
  const root={tag:'root',attrs:{},children:[]}, stack=[root];
  const voids=new Set(['img','br','hr','input','meta','link','source','wbr','area','col','embed','param']);
  const source=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  for (const token of source.match(/<[^>]*>|[^<]+|</g)||[]) {
    if (!token.startsWith('<')) {stack[stack.length-1].children.push({text:decodeEntities(token.replace(/[\t\r\n ]+/g,' '))});continue;}
    const end=token.match(/^<\/([a-z][\w-]*)/i);
    if(end){const name=end[1].toLowerCase();for(let i=stack.length-1;i>0;i--){if(stack[i].tag===name){stack.length=i;break;}}continue;}
    const start=token.match(/^<([a-z][\w-]*)\b/i);if(!start)continue;
    const tag=start[1].toLowerCase(),attrs={};
    for(const match of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1].toLowerCase()]=decodeEntities(match[2]??match[3]??match[4]??'');
    const node={tag,attrs,children:[]};stack[stack.length-1].children.push(node);
    if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  return root;
}
function documentLink(active,href,label) {
  const scripture=bibleLink(href,label);if(scripture)return scripture;
  const chapter=href.match(/^jwpub:\/\/c\/[A-Za-z-]+:(\d+)\/(\d+):(\d+)(?:-(\d+):(\d+))?\/?$/i);
  if(chapter){
    const id=sectionDocumentMap(active).get(Number(chapter[1]));
    const book=query(active.db,'SELECT BibleBookId FROM BibleBook WHERE BookDocumentId=?',[id??-1])[0];
    if(book)return {label,book:book[0],chapter:Number(chapter[2]),verse:Math.max(1,Number(chapter[3])),...(chapter[4]?{endBook:book[0],endChapter:Number(chapter[4]),endVerse:Number(chapter[5])}:{})};
  }
  const document=href.match(/^jwpub:\/\/p\/[A-Za-z-]+:(\d+)(?:\/(\d+)(?:-\d+)?)?\/?$/i);
  if(document){const documentId=sectionDocumentMap(active).get(Number(document[1]));if(documentId!=null){const book=query(active.db,'SELECT BibleBookId FROM BibleBook WHERE BookDocumentId=?',[documentId])[0];if(book)return {label,book:book[0],chapter:1,verse:1};return {label,documentId,...(document[2]?{paragraph:Number(document[2])}:{})};}}
  const noteId=extractTarget(active,href);if(noteId)return {label,noteId};
  return null;
}
function documentParts(active,node,footnotes,state={}) {
  if ('text' in node) return [{text:node.text,...state}];
  if(['script','style','iframe','object','svg','video','img','figure'].includes(node.tag))return [];
  if(node.tag==='br')return [{text:'\n',...state}];
  if(node.attrs?.['data-rel-fnid'])return [];
  if(node.attrs?.['data-fnid']) {
    const id=footnotes.get(Number(node.attrs['data-fnid']));
    const text=node.children.filter(n=>'text'in n).map(n=>n.text).join('').trim()||'*';
    return id!=null?[{text,link:{label:'Nota de rodapé',noteId:`fn:${id}`},sup:true}]:[{text}];
  }
  const format={...state};
  if(['strong','b'].includes(node.tag))format.bold=true;
  if(['em','i'].includes(node.tag))format.italic=true;
  if(node.tag==='sup')format.sup=true;
  if(node.tag==='a'){
    const label=documentParts(active,{tag:'span',children:node.children},footnotes).map(p=>p.text).join('').trim();
    const link=documentLink(active,node.attrs.href||'',label);if(link)format.link=link;
  }
  return (node.children||[]).flatMap(child=>documentParts(active,child,footnotes,format));
}
function trimmedDocumentParts(parts) {
  const result=parts.filter(p=>p.text);
  while(result.length && !result[0].text.trim())result.shift();
  while(result.length && !result[result.length-1].text.trim())result.pop();
  if(result.length){result[0].text=result[0].text.trimStart();result[result.length-1].text=result[result.length-1].text.trimEnd();}
  return result;
}
function documentBlocks(active,tree,footnotes,media,includeStandalone=true) {
  const blocks=[], knownFiles=new Set(media.map(m=>m.file));
  const parts=node=>trimmedDocumentParts(documentParts(active,node,footnotes));
  const walk=(node,context={})=>{
    if('text'in node)return;
    const cls=(node.attrs.class||'').split(/\s+/);
    if(['script','style','iframe','object','svg','nav'].includes(node.tag)||cls.includes('groupFootnote'))return;
    if(node.tag==='img'){
      const file=(node.attrs.src||'').replace(/^jwpub-media:\/\//,'');
      if(knownFiles.has(file)){const m=media.find(m=>m.file===file),classes=(node.attrs.class||'').split(/\s+/);const placement=classes.includes('east_right')?'right':classes.includes('west_left')?'left':context.placement||'center';blocks.push({type:'image',file,alt:node.attrs.alt||m.alt||'',width:Number(node.attrs.width)||m.width||null,height:Number(node.attrs.height)||m.height||null,placement,half:classes.includes('half')||!!context.half});}
      return;
    }
    if(node.tag==='video'){
      const src=node.attrs['data-video']||'', pub=src.match(/[?&]pub=([\w-]+)/),track=src.match(/[?&]track=(\d+)/);
      if(pub&&track){const language=query(active.db,'SELECT MepsLanguageIndex FROM Publication LIMIT 1')[0]?.[0];blocks.push({type:'video',poster:knownFiles.has(node.attrs['data-image'])?node.attrs['data-image']:null,url:`https://www.jw.org/finder?wtlocale=${String(language)==='5'?'T':'E'}&pub=${pub[1]}&track=${Number(track[1])}&srcid=share`,title:'Assistir no JW.ORG'});}
      return;
    }
    if(node.tag==='table'){
      const rows=[];
      const visit=n=>{if(n.tag==='tr'){const cells=n.children.filter(c=>['th','td'].includes(c.tag)).map(c=>{
        // Preserve illustrations in table cells, along with their surrounding
        // paragraphs and links. A text-only cell keeps the compact parts form.
        const cellBlocks=documentBlocks(active,{tag:'root',attrs:{},children:c.children},footnotes,media,false);
        const hasImage=cellBlocks.some(block=>block.type==='image');
        return {parts:parts(c),...(hasImage?{blocks:cellBlocks}:{}),header:c.tag==='th',colspan:Math.max(1,Math.min(10,Number(c.attrs.colspan)||1))};
      });if(cells.length)rows.push(cells);}else for(const child of n.children||[])visit(child);};
      visit(node);if(rows.length)blocks.push({type:'table',rows});return;
    }
    if(cls.includes('mapElement')||cls.includes('diagram')){
      const inner=documentBlocks(active,{tag:'root',attrs:{},children:node.children},footnotes,media,false);
      if(inner.length)blocks.push({type:'details',title:cls.includes('diagram')?'Informações no diagrama':'Informações no mapa',blocks:inner});return;
    }
    if(node.tag==='p'||/^h[1-6]$/.test(node.tag)){
      const content=parts(node);
      if(content.length)blocks.push({type:/^h/.test(node.tag)?'heading':'paragraph',...(/^h/.test(node.tag)?{level:Number(node.tag[1])}:{}),parts:content,...(node.attrs.id?{id:node.attrs.id}:{}),...(context.bullet?{bullet:true}:{}),...(context.caption?{caption:true}:{}),...(cls.includes('contextTtl')?{kicker:true}:{})});return;
    }
    const next={...context,...(cls.includes('east_right')?{placement:'right'}:cls.includes('west_left')?{placement:'left'}:{}),...(cls.includes('half')?{half:true}:{}),...(node.tag==='li'?{bullet:!context.noMarker}:{}),...(node.tag==='figcaption'?{caption:true}:{}),...(node.tag==='ul'||node.tag==='ol'?{noMarker:cls.includes('noMarker')}: {})};
    for(const child of node.children||[])walk(child,next);
  };
  walk(tree);
  // Maps/diagrams can be database-backed SVGs, absent from the text-only HTML.
  const extra=includeStandalone?media.filter(m=>m.mime==='image/svg+xml'&&!blocks.some(b=>b.file===m.file)):[];
  if(extra.length){let at=0;while(at<blocks.length&&(['heading'].includes(blocks[at].type)||blocks[at].kicker))at++;blocks.splice(at,0,...extra.map(m=>({type:'image',file:m.file,alt:m.alt||'Mapa ou diagrama',width:m.width,height:m.height})));}
  return blocks;
}
async function readPublicationDocument(active,value) {
  const id=Number(value);if(!Number.isSafeInteger(id)||id<0)fail('Documento inválido.');
  const row=query(active.db,'SELECT Title,Content FROM Document WHERE DocumentId=?',[id])[0];
  if(!row?.[1])fail('Este conteúdo não está incluído nesta edição.');
  const html=await decode(row[1],active.cipher),footnotes=new Map();
  if(tablesOf(active).has('Footnote'))for(const [index,noteId]of query(active.db,'SELECT FootnoteIndex,FootnoteId FROM Footnote WHERE DocumentId=?',[id]))footnotes.set(index,noteId);
  return {id,title:plain(row[0]||''),blocks:documentBlocks(active,documentTree(html),footnotes,sectionMedia(active).get(id)||[])};
}
