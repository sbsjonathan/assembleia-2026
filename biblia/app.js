'use strict';
const ui=Object.fromEntries([...document.querySelectorAll('[id]')].map(e=>[e.id,e]));
const names=['Gênesis','Êxodo','Levítico','Números','Deuteronômio','Josué','Juízes','Rute','1 Samuel','2 Samuel','1 Reis','2 Reis','1 Crônicas','2 Crônicas','Esdras','Neemias','Ester','Jó','Salmos','Provérbios','Eclesiastes','Cântico de Salomão','Isaías','Jeremias','Lamentações','Ezequiel','Daniel','Oseias','Joel','Amós','Obadias','Jonas','Miqueias','Naum','Habacuque','Sofonias','Ageu','Zacarias','Malaquias','Mateus','Marcos','Lucas','João','Atos','Romanos','1 Coríntios','2 Coríntios','Gálatas','Efésios','Filipenses','Colossenses','1 Tessalonicenses','2 Tessalonicenses','1 Timóteo','2 Timóteo','Tito','Filêmon','Hebreus','Tiago','1 Pedro','2 Pedro','1 João','2 João','3 João','Judas','Apocalipse'];
const abbreviations=['Gên','Êx','Le','Núm','De','Jos','Jz','Ru','1Sa','2Sa','1Rs','2Rs','1Cr','2Cr','Esd','Ne','Est','Jó','Sal','Pr','Ec','Cân','Is','Je','La','Ez','Da','Os','Jl','Am','Ob','Jon','Miq','Na','Hab','Sof','Ag','Za','Mal','Mt','Mr','Lu','Jo','At','Ro','1Co','2Co','Gál','Ef','Fil','Col','1Te','2Te','1Ti','2Ti','Tit','Flm','He','Tg','1Pe','2Pe','1Jo','2Jo','3Jo','Ju','Ap'];
const state={publications:[],books:[],chapters:[],sections:[],bookInfo:{},publication:'',book:'',chapter:'',pickBook:'',section:'',screen:'empty',epoch:0,busy:false,font:19.36,hasReading:false,readingScroll:0,data:null,pubInfo:null,documentReturn:null,documentHistory:[]};
let worker,serial=0,pending=new Map(),noteEpoch=0,noteHistory=[],currentNote=null,noteTrigger=null;
const mediaURLs=new Map();
let textActions,bibleAudio,readAlong,toastTimer,bookmarksFromReading=false;
const OPENING_VIEW_KEY='sentinela-bible-view-v1';
const OPENING_VIEW_VERSION=1;
let openingRestored=false,openingStudyHandled=false;
let articleStudyContext=null,studyReferenceData=null,studyReferenceReturn=null;
let searchReturn=null;
const articleStudyParams=new URLSearchParams(location.search);
const articleStudyRequested=articleStudyParams.get('studyView')==='reference'&&articleStudyParams.get('from')==='article';
const articleStudyRoutes=articleStudyRequested?import(new URL('legacy-routes.js',document.currentScript.src).href).catch(()=>null):Promise.resolve(null);
function toast(message){let node=document.getElementById('action-status');if(!node){node=document.createElement('div');node.id='action-status';node.setAttribute('role','status');document.body.append(node);}node.textContent=message;node.hidden=!message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,3500);}
function audioContext(verse=1){return {publication:state.publication,...state.pubInfo,book:Number(state.book),chapter:Number(state.chapter),verse:Number(verse)||1,chapters:state.chapters.length,verses:(state.data?.verses||[]).map(v=>Number(v.number)),title:`${nameOf(state.book)} ${state.chapter}`};}
function bookmarkSelection(selection){const marks=savedMarks();const found=marks.some(m=>m.publication===state.publication&&m.book===state.book&&m.chapter===state.chapter&&m.verse===selection.startVerse&&m.endVerse===selection.endVerse);if(!found){marks.unshift({publication:state.publication,book:state.book,chapter:state.chapter,verse:selection.startVerse,endVerse:selection.endVerse,title:selection.reference,edition:editionName()});save('jwpub-bookmarks',marks);}toast(found?'Este trecho já está nos marcadores.':'Trecho salvo nos marcadores.');}

function notice(message='',error=false){ui.status.textContent=message;ui.status.hidden=!message;ui.status.classList.toggle('error',error);}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function rpc(action,args={}){return new Promise((resolve,reject)=>{if(!worker)return reject(new Error('Reabra a página no Safari para iniciar o leitor.'));const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,action,args});});}
function openingRoute(){
 const params=new URLSearchParams(location.search),book=Number(params.get('book')),chapter=Number(params.get('chapter')),verse=Number(params.get('verse')),endVerse=Number(params.get('endVerse')),endChapter=Number(params.get('endChapter')),studyVerse=Number(params.get('studyVerse'));
 return {book:book>=1&&book<=66?book:null,chapter:chapter>0?chapter:null,verse:verse>0?verse:null,endVerse:Number.isInteger(endVerse)&&endVerse>0&&endVerse<=176?endVerse:null,endChapter:Number.isInteger(endChapter)&&endChapter>=chapter&&endChapter<=150?endChapter:null,studyVerse:Number.isInteger(studyVerse)&&studyVerse>0&&studyVerse<=176?studyVerse:null,grid:params.get('from')==='navbar'||params.get('resume')==='0'};
}
function referenceEnd(reference){
 const crosses=(reference.endChapter&&Number(reference.endChapter)!==Number(reference.chapter))||(reference.endBook&&Number(reference.endBook)!==Number(reference.book));
 return crosses?Infinity:reference.endVerse??reference.verse;
}
function clearPassageHighlight(){ui.verses.querySelectorAll('.highlight').forEach(element=>element.classList.remove('highlight'));}
function highlightPassage(verse,endVerse=verse){
 const start=Number(verse),last=endVerse==null?start:Number(endVerse),end=last>=start?last:start;
 for(const element of ui.verses.querySelectorAll('[data-verse]')){
  const number=Number(element.dataset.verse);
  element.classList.toggle('highlight',Number.isInteger(start)&&start>0&&number>=start&&number<=end);
 }
 const target=document.getElementById(`verse-${start}`);
 if(target&&ui.verses.contains(target))target.scrollIntoView({block:'center'});
}
function saveOpeningView(){
 if(!state.publication||!state.books.length)return;
 const view={version:OPENING_VIEW_VERSION,publication:state.publication,publications:state.publications,books:state.books,sections:state.sections,bookInfo:state.bookInfo,pubInfo:state.pubInfo};
 if(state.hasReading&&state.data)view.reading={book:state.book,chapter:state.chapter,chapters:state.chapters,data:state.data,scroll:state.screen==='reading'?window.scrollY:state.readingScroll};
 try{const json=JSON.stringify(view);if(json.length<=900000)localStorage.setItem(OPENING_VIEW_KEY,json);}catch{/* Reading and saved marks remain usable when browser storage is full. */}
}
function chapterNumbers(book){
 const count=Number(state.books.find(item=>Number(item.number)===Number(book))?.chapters);
 return Number.isInteger(count)&&count>0&&count<=150?Array.from({length:count},(_,i)=>i+1):null;
}
function paintChapters(book,chapters){
 for(const n of chapters){const b=button(String(n),'chapter-tile',()=>loadChapter(book,n,chapters,true));b.dataset.chapter=n;b.setAttribute('aria-label',`${nameOf(book)}, capítulo ${n}`);ui['chapter-grid'].append(b);}
 for(const item of state.bookInfo[book]||[])ui['book-info'].append(button(item.title,'',()=>openDocument(item.documentId??item.id)));
}
function restoreOpeningView(){
 try{
  const view=read(OPENING_VIEW_KEY,null),route=openingRoute(),saved=read('jwpub-reading',{});
  if(view?.version!==OPENING_VIEW_VERSION||!/^[a-f0-9]{24}$/.test(view.publication)||!Array.isArray(view.publications)||!Array.isArray(view.books)||!view.books.length||!Array.isArray(view.sections)||!view.pubInfo)return false;
  const pub=view.publications.find(p=>p.id===view.publication);
  if(!pub||((route.book||route.grid)&&!pub.bundled)||(!route.book&&!route.grid&&saved.publication&&saved.publication!==view.publication))return false;
  Object.assign(state,{publication:view.publication,publications:view.publications,books:view.books,sections:view.sections,bookInfo:view.bookInfo||{},pubInfo:view.pubInfo});
  ui.publication.replaceChildren();for(const item of state.publications)ui.publication.add(new Option(item.title,item.id));ui.publication.value=state.publication;renderTabs();
  const last=view.reading;
  if(last?.data?.verses?.length&&Array.isArray(last.chapters)&&last.book&&last.chapter){
   state.book=String(last.book);state.chapter=String(last.chapter);state.chapters=last.chapters;state.data=last.data;state.hasReading=true;state.readingScroll=Number(last.scroll)||0;
   renderVerses(last.data);ui.position.textContent=`${state.chapter} de ${last.chapters.length}`;
  }
  const wantsReading=route.book?route.chapter&&String(route.book)===state.book&&String(route.chapter)===state.chapter:!route.grid&&saved.book&&String(saved.book)===state.book&&String(saved.chapter)===state.chapter;
  if(state.hasReading&&wantsReading){
   showReading(true);
   if(route.verse)highlightPassage(route.verse,referenceEnd(route));
  }else if(route.book)showChapters(route.book);else showBooks();
  performance.mark('bible-local-view');
  return true;
 }catch{return false;}
 finally{document.documentElement.classList.remove('bible-restoring');}
}
window.addEventListener('pagehide',saveOpeningView);
function button(text,cls,fn){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.onclick=fn;return b;}
function nameOf(n){const pub=state.publications.find(p=>p.id===state.publication);return String(pub?.language)==='5'?names[n-1]:state.books.find(b=>Number(b.number)===Number(n))?.name||names[n-1];}
function editionName(){return /estudo/i.test(state.publications.find(p=>p.id===state.publication)?.title||'')?'Bíblia de Estudo':'Tradução do Novo Mundo';}
function currentSaved(){save('jwpub-reading',{publication:state.publication,book:state.book,chapter:state.chapter});}
function savedMarks(){return read('jwpub-bookmarks',[]);}
function updateButtons(){const i=state.chapters.findIndex(n=>String(n)===state.chapter);ui.previous.disabled=state.busy||i<=0;ui.next.disabled=state.busy||i<0||i>=state.chapters.length-1;ui.smaller.disabled=state.font<=(window.GlobalFontScale?.minSize??17.35);ui.larger.disabled=state.font>=(window.GlobalFontScale?.maxSize??30);ui.search.disabled=state.busy||!state.books.length;ui.bookmark.hidden=state.screen!=='reading';ui['listen-chapter'].hidden=state.screen!=='reading';}
function setBusy(value){state.busy=value;ui['add-file'].disabled=value;ui['empty-add'].disabled=value;ui.publication.disabled=value;updateButtons();}
function screen(which,title,subtitle='',back=false){
 textActions?.clear();
 if(state.screen==='reading'&&which!=='reading')state.readingScroll=window.scrollY;
 state.screen=which;for(const id of ['empty','navigator','section-list','reader','document','bookmarks','library','study-reference','search-dialog'])ui[id].hidden=true;
 ui[({books:'navigator',chapters:'navigator',section:'section-list',reading:'reader',search:'search-dialog'})[which]||which].hidden=false;
 document.body.classList.toggle('bible-search-open',which==='search');
 document.body.classList.toggle('reading',which==='reading'||which==='document'||which==='study-reference');
 const reference=which==='study-reference';document.body.classList.toggle('reference-reading',reference);ui['study-article-header'].hidden=!reference;if(reference)document.documentElement.classList.remove('article-study-opening');setArticleReferenceContext(reference||document.documentElement.classList.contains('article-study-opening'));
 ui['screen-title'].textContent=title;ui['screen-subtitle'].textContent=subtitle;ui['screen-subtitle'].hidden=!subtitle;ui.back.hidden=!back;
 ui['section-tabs'].hidden=!['books','section'].includes(which);
 const active=which==='reading'?'reading':which==='bookmarks'?'bookmarks':which==='library'?'library':'bible';
 document.querySelectorAll('[data-destination]').forEach(b=>{if(b.dataset.destination===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 notice('');updateButtons();readAlong?.refresh();
}
function colorOf(n){return n<=5?'#3d3548':n<=17?'#766d85':n<=22?'#574d67':n<=43?'#3d3548':n===44?'#766d85':n<=65?'#574d67':'#3d3548';}
function renderBooks(){for(const id of ['hebrew-books','greek-books'])ui[id].replaceChildren();for(const book of state.books){const n=Number(book.number),b=button(abbreviations[n-1]||book.name,'book-tile',()=>showChapters(n));b.dataset.book=n;b.style.setProperty('--tile',colorOf(n));b.setAttribute('aria-label',nameOf(n));if(String(n)===state.book)b.setAttribute('aria-current','true');ui[n<=39?'hebrew-books':'greek-books'].append(b);}}
function renderTabs(){ui['section-tabs'].replaceChildren();for(const section of state.sections){const b=button(section.title,'',()=>showSection(section.id));b.setAttribute('role','tab');b.dataset.section=section.id;b.setAttribute('aria-selected',String(String(section.id)===String(state.section)));ui['section-tabs'].append(b);}ui['section-tabs'].setAttribute('role','tablist');}
function selectTab(id){state.section=String(id);ui['section-tabs'].querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.section===String(id))));const selected=ui['section-tabs'].querySelector('[aria-selected=true]');if(selected)ui['section-tabs'].scrollTo({left:Math.max(0,selected.offsetLeft-125),behavior:'auto'});}
function showBooks(scroll=true){if(!state.books.length)return;const direction=['chapters','reading','document'].includes(state.screen)?'back':'replace';++state.epoch;state.documentHistory=[];const sec=state.sections.find(s=>s.kind==='books');selectTab(sec?.id??'books');screen('books',editionName(),'Português (Brasil)');ui['book-grids'].hidden=false;ui['chapter-panel'].hidden=true;renderBooks();if(scroll)window.scrollTo(0,0);window.BibleMotion?.transition(ui['book-grids'],direction);}
async function showChapters(book,direction='forward'){
 if(state.busy)return;const epoch=++state.epoch;state.pickBook=String(book);screen('chapters',nameOf(book),'',true);ui['book-grids'].hidden=true;ui['chapter-panel'].hidden=false;ui['chapter-grid'].replaceChildren();ui['book-info'].replaceChildren();
 try{const chapters=chapterNumbers(book)||await rpc('chapters',{publication:state.publication,book:Number(book)});if(epoch!==state.epoch)return;paintChapters(book,chapters);window.scrollTo(0,0);window.BibleMotion?.transition(ui['chapter-panel'],direction);}catch(e){notice(e.message,true);}
}
function showReading(restore=false,direction='forward'){screen('reading',`${nameOf(state.book)} ${state.chapter}`,editionName(),true);if(restore)window.scrollTo(0,state.readingScroll);readAlong?.refresh();window.BibleMotion?.transition(ui.reader,restore?'back':direction);}
function noteButton(note,verse,text){
 const activate=e=>{e.preventDefault();openNote(note.id,e.currentTarget,verse);};
 // Buttons remain atomic inline boxes even with display:inline in WebKit.
 // A study phrase must wrap with its sentence, including adjacent punctuation.
 const b=note.kind==='study'?document.createElement('a'):button(text??note.label??'*','note-marker '+note.kind,activate);
 if(note.kind==='study'){b.href='#note-dialog';b.className='study-word';b.textContent=text??note.label;b.addEventListener('click',activate);b.setAttribute('aria-haspopup','dialog');}
 b.dataset.noteId=note.id;b.setAttribute('aria-label',`${note.title||'Nota'} — ${nameOf(state.book)} ${state.chapter}:${verse}`);return b;
}
function renderVerses(data){
 const f=document.createDocumentFragment(),seen=new Set();
 if(data.blocks?.length){for(const block of data.blocks){const p=document.createElement(block.type==='heading'?'h3':'p');p.className=block.type==='heading'?'bible-heading':'bible-paragraph';if(block.type==='poetry')p.classList.add('poetry');if(block.indent)p.classList.add('indented');if(block.superscription)p.classList.add('superscription');
 for(const part of block.parts){let el;if(part.number){el=document.createElement('span');el.className='verse-number'+(part.chapter?' chapter-number':'');el.textContent=part.text;el.setAttribute('aria-label',`Versículo ${part.verse}`);}
 else if(part.note){el=noteButton(part.note,part.verse,part.text);if(part.note.kind==='study'){if(part.sourceStrong)el.classList.add('source-strong');if(part.emphasis)el.classList.add('source-emphasis');}}
 else{el=document.createElement(part.strong?'strong':part.emphasis?'em':'span');el.textContent=part.text;el.classList.add('verse-text');}
 if(part.verse!=null&&!part.detached)el.dataset.verse=String(part.verse);
 if(part.verse!=null&&!part.detached&&(part.number||String(part.text).trim())&&!seen.has(part.verse)){el.id=`verse-${part.verse}`;seen.add(part.verse);}p.append(el);}f.append(p);}}
 else{for(const verse of data.verses){const p=document.createElement('p');p.className='bible-paragraph';p.id=`verse-${verse.number}`;p.dataset.verse=String(verse.number);const n=document.createElement('span');n.className='verse-number';n.textContent=verse.number;p.append(n,document.createTextNode(verse.text));for(const note of verse.notes||[])p.append(noteButton(note,verse.number));f.append(p);}}
 ui.verses.replaceChildren(f);textActions?.refresh();readAlong?.refresh();
}
async function loadChapter(book,chapter,chapters,scroll=false,verse=null,endVerse=null){const direction=state.screen==='reading'&&(Number(book)<Number(state.book)||(Number(book)===Number(state.book)&&Number(chapter)<Number(state.chapter)))?'back':'forward';if(state.screen==='study-reference'&&studyReferenceData)studyReferenceReturn={data:studyReferenceData,scroll:window.scrollY};const epoch=++state.epoch;try{const list=chapters||chapterNumbers(book)||await rpc('chapters',{publication:state.publication,book:Number(book)});if(epoch!==state.epoch)return;const data=await rpc('chapter',{publication:state.publication,book:Number(book),chapter:Number(chapter)});if(epoch!==state.epoch)return;if(verse!=null&&!data.verses.some(v=>Number(v.number)===Number(verse)))throw new Error('Este versículo não existe no capítulo selecionado.');state.book=String(book);state.chapter=String(chapter);state.chapters=list;state.data=data;state.hasReading=true;renderVerses(data);ui.position.textContent=`${chapter} de ${list.length}`;showReading(false,direction);currentSaved();updateButtons();bibleAudio?.prepare(audioContext()).catch(()=>{});if(verse!=null)highlightPassage(verse,endVerse);else if(scroll)window.scrollTo(0,0);saveOpeningView();}catch(e){if(epoch===state.epoch)notice(e.message,true);}}
async function selectPublication(preferred){const epoch=++state.epoch;for(const url of mediaURLs.values())if(typeof url==='string')URL.revokeObjectURL(url);mediaURLs.clear();state.publication=ui.publication.value;state.books=[];state.hasReading=false;state.book='';state.chapter='';state.documentHistory=[];notice('Abrindo a Bíblia…');try{const [books,catalog,info]=await Promise.all([rpc('books',{publication:state.publication}),rpc('sections',{publication:state.publication}),rpc('publication-info',{publication:state.publication})]);if(epoch!==state.epoch)return;state.books=books;state.pubInfo=info;state.sections=catalog.sections?.length?catalog.sections:[{id:'books',title:'Livros',kind:'books'}];state.bookInfo=catalog.bookInfo||{};renderTabs();if(preferred?.book&&preferred?.chapter)await loadChapter(preferred.book,preferred.chapter,null,true);else showBooks();saveOpeningView();}catch(e){notice(e.message,true);}}
async function refresh(preferred){const list=await rpc('publications');state.publications=list;ui.publication.replaceChildren();for(const p of list)ui.publication.add(new Option(p.title,p.id));if(!list.length){screen('empty','Bíblia','Sua biblioteca pessoal');return;}const chosen=preferred||read('jwpub-reading',{});ui.publication.value=list.find(p=>p.id===chosen.publication)?.id??list[0].id;await selectPublication(chosen);}
async function importFile(file){if(!file||state.busy)return;if(!/\.jwpub$/i.test(file.name))return notice('Escolha um arquivo .jwpub no app Arquivos.',true);if(file.size>250*1024*1024)return notice('O arquivo ultrapassa o limite de 250 MB.',true);setBusy(true);notice('Abrindo o JWPUB neste iPhone…');try{const saved=read('jwpub-reading',{}),pub=await rpc('import',{file});navigator.storage?.persist?.().catch(()=>{});await refresh(pub.id===saved.publication?saved:{publication:pub.id});}catch(e){notice(e.message,true);}finally{setBusy(false);ui['file-input'].value='';}}
function applyGlobalFont(){state.font=window.GlobalFontScale?.getSize()??19.36;document.documentElement.style.setProperty('--read-size',`${state.font}px`);updateButtons();}
function changeFont(delta){const scale=window.GlobalFontScale;if(scale?.setLevel)scale.setLevel(scale.getLevel()+delta);applyGlobalFont();}
window.addEventListener('globalfont:changed',applyGlobalFont);
function nextChapter(delta){const i=state.chapters.findIndex(n=>String(n)===state.chapter);if(state.chapters[i+delta]!=null)loadChapter(state.book,state.chapters[i+delta],state.chapters,true);}
async function mediaURL(file){const key=state.publication+':'+file;if(mediaURLs.has(key))return mediaURLs.get(key);const promise=rpc('media',{publication:state.publication,file}).then(blob=>{const url=blob?URL.createObjectURL(blob):null;mediaURLs.set(key,url);return url;}).catch(()=>null);mediaURLs.set(key,promise);return promise;}
async function setImage(img,file,container){const url=await mediaURL(file);if(!img.isConnected)return;if(url){img.src=url;img.hidden=false;}else{img.remove();if(container){const p=document.createElement('p');p.className='media-missing';p.textContent='Não foi possível carregar esta imagem.';container.append(p);}}}
function showSection(id){const section=state.sections.find(s=>String(s.id)===String(id));if(!section)return;if(section.kind==='books')return showBooks();++state.epoch;state.documentHistory=[];selectTab(id);screen('section',editionName(),'Português (Brasil)');ui['section-list'].replaceChildren();for(const item of section.items||[]){if(item.heading){const h=document.createElement('h2');h.textContent=typeof item.heading==='string'?item.heading:item.title;ui['section-list'].append(h);if(item.documentId==null)continue;}const b=button('','section-row',()=>openDocument(item.documentId??item.id));b.dataset.documentId=item.documentId??item.id;const file=typeof item.thumbnail==='string'?item.thumbnail:item.thumbnail?.file;const showThumbnails=/INTRODUÇÃO|APÊNDICE C/i.test(section.title);if(showThumbnails){const thumb=document.createElement('span');thumb.className='row-thumbnail';if(file){const img=document.createElement('img');img.alt='';img.hidden=true;thumb.append(img);queueMicrotask(()=>setImage(img,file));}b.append(thumb);}const wrap=document.createElement('span');wrap.className='row-text';if(item.label){const label=document.createElement('span');label.className='row-label';label.textContent=item.label;wrap.append(label);}wrap.append(document.createTextNode(item.title));const arrow=document.createElement('span');arrow.className='row-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');b.append(wrap,arrow);ui['section-list'].append(b);}window.scrollTo(0,0);window.BibleMotion?.transition(ui['section-list'],'replace');}
function addParts(container,parts){for(const part of parts||[]){let el;if(part.link)el=button(part.text||part.link.label,'inline-reference',e=>followLink(part.link,e.currentTarget));else{el=document.createElement(part.bold?'strong':part.italic?'em':part.sup?'sup':'span');el.textContent=part.text||'';}container.append(el);}}
async function followLink(link,trigger){if(link.documentId!=null){if(ui['note-dialog'].open&&!await closeNotes())return;openDocument(link.documentId,link.paragraph);}else if(link.noteId)openNote(link.noteId,trigger);else if(link.book){noteTrigger=trigger;noteHistory=[];currentNote=null;document.body.classList.add('sheet-open');showDialog(ui['note-dialog']);openPassage(link);}}
function renderDocumentBlocks(container,blocks){for(const block of blocks||[]){if(block.type==='image'){const fig=document.createElement('figure'),img=document.createElement('img');if(block.half&&!container.closest('td,th')&&['left','right'].includes(block.placement))fig.classList.add('media-half',block.placement);img.alt=block.alt||'';img.hidden=true;fig.append(img);container.append(fig);queueMicrotask(()=>setImage(img,block.file,fig));continue;}if(block.type==='video'){const a=document.createElement('a');a.className='video-link';if(/^https:\/\/www\.jw\.org\//.test(block.url||'')){a.href=block.url;a.target='_blank';a.rel='noopener noreferrer';if(block.poster){const img=document.createElement('img');img.alt='';img.hidden=true;a.append(img);queueMicrotask(()=>setImage(img,block.poster));}const label=document.createElement('span');label.textContent='▶︎  '+(block.title||'Assistir no JW.ORG');a.append(label);container.append(a);}continue;}if(block.type==='table'){const outer=document.createElement('div');outer.className='table-scroll';const table=document.createElement('table');for(const row of block.rows||[]){const tr=document.createElement('tr');for(const cell of row){const td=document.createElement(cell.header?'th':'td');if(cell.colspan)td.colSpan=cell.colspan;if(cell.blocks?.length)renderDocumentBlocks(td,cell.blocks);else addParts(td,cell.parts);tr.append(td);}table.append(tr);}outer.append(table);container.append(outer);continue;}if(block.type==='details'){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=block.title;details.append(summary);renderDocumentBlocks(details,block.blocks);container.append(details);continue;}const el=document.createElement(block.type==='heading'?'h3':'p');if(block.id)el.id='doc-'+block.id;if(block.caption)el.classList.add('caption');if(block.bullet)el.append(document.createTextNode('• '));addParts(el,block.parts);container.append(el);}}
function revealDocumentTarget(id){
 const target=document.getElementById(id);if(!target)return;
 for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 target.scrollIntoView({block:'start'});
}
async function openDocument(id,paragraph,fromBack=false){const epoch=++state.epoch;if(!fromBack){if(state.screen==='document')state.documentHistory.push({id:state.documentId,scroll:window.scrollY});else{state.documentReturn={screen:state.screen,book:state.pickBook,section:state.section,scroll:window.scrollY};state.documentHistory=[];}}try{const data=await rpc('document',{publication:state.publication,id});if(epoch!==state.epoch)return;state.documentId=data.id;screen('document',data.title,'',true);ui['document-title'].textContent=data.title;ui['document-body'].replaceChildren();const blocks=[...(data.blocks||[])];const first=blocks[0];if(first?.type==='heading'&&(first.parts||[]).map(p=>p.text||'').join('').trim().toLocaleLowerCase('pt-BR')===String(data.title).trim().toLocaleLowerCase('pt-BR'))blocks.shift();renderDocumentBlocks(ui['document-body'],blocks);window.scrollTo(0,0);window.BibleMotion?.transition(ui.document,fromBack?'back':'forward');if(paragraph)requestAnimationFrame(()=>revealDocumentTarget('doc-p'+String(paragraph).replace(/^p/,'')));}catch(e){if(epoch===state.epoch)notice(e.message,true);}}
function showLibrary(){++state.epoch;screen('library','Biblioteca','',true);window.scrollTo(0,0);}
function showBookmarks(){if(state.screen!=='bookmarks')bookmarksFromReading=state.screen==='reading';++state.epoch;screen('bookmarks','Marcadores','',true);ui['bookmark-list'].replaceChildren();const marks=savedMarks();if(!marks.length){const p=document.createElement('p');p.className='page-hint';p.textContent='Durante a leitura, toque em um versículo e use o marcador no menu do texto para salvá-lo aqui.';ui['bookmark-list'].append(p);}for(const mark of marks){const row=document.createElement('div');row.className='saved-row';const open=button(mark.title,'',async()=>{if(mark.publication!==state.publication){ui.publication.value=mark.publication;await selectPublication(mark);if(mark.verse)document.getElementById(`verse-${mark.verse}`)?.scrollIntoView({block:'center'});}else await loadChapter(mark.book,mark.chapter,null,true,mark.verse??null);});const small=document.createElement('small');small.textContent=mark.edition;open.append(small);const remove=button('×','',()=>{save('jwpub-bookmarks',savedMarks().filter(m=>JSON.stringify(m)!==JSON.stringify(mark)));showBookmarks();});remove.setAttribute('aria-label','Remover '+mark.title);row.append(open,remove);ui['bookmark-list'].append(row);}window.scrollTo(0,0);}
async function back(){if(state.screen==='search')return bibleSearch.close();if(state.screen==='study-reference')return returnToStudyArticle();if(state.screen==='reading'&&studyReferenceReturn){++state.epoch;const previous=studyReferenceReturn;studyReferenceReturn=null;showStudyReference(previous.data,'back');window.scrollTo(0,previous.scroll);return;}if(state.screen==='bookmarks'&&bookmarksFromReading){++state.epoch;return showReading(true);}if(state.screen==='reading')return showChapters(state.book,'back');if(state.screen==='chapters')return showBooks();if(state.screen==='document'){const previous=state.documentHistory.pop();if(previous){await openDocument(previous.id,null,true);window.scrollTo(0,previous.scroll);return;}const r=state.documentReturn;if(r?.screen==='chapters')await showChapters(r.book,'back');else if(r?.screen==='section')showSection(r.section);else if(r?.screen==='study-reference'&&studyReferenceData)showStudyReference(studyReferenceData);else showBooks();window.scrollTo(0,r?.scroll||0);return;}showBooks();}
async function openSearchResult(item){
 const target=item.target||{};
 if(target.showChapters&&target.book)return showChapters(target.book);
 if(target.noteId){
  if(target.book&&target.chapter)await loadChapter(target.book,target.chapter,null,true,target.verse||null);
  return openNote(target.noteId,ui.search);
 }
 if(target.documentId!=null){
  await openDocument(target.documentId,target.paragraph);
  if(target.blockId)requestAnimationFrame(()=>revealDocumentTarget('doc-'+target.blockId));
  return;
 }
 if(target.book&&target.chapter){
  await loadChapter(target.book,target.chapter,null,true,target.verse||1,referenceEnd(target));
  return;
 }
 throw new Error('Não foi possível localizar o texto deste resultado.');
}

function closeNotes(){++noteEpoch;return closeDialog(ui['note-dialog']);}
function referenceOrigin(id,verse){
 // Read clean publication text, not the chapter DOM with its note markers.
 const number=verse??state.data?.blocks?.flatMap(block=>block.parts).find(part=>part.note?.id===id)?.verse;
 const source=state.data?.verses?.find(item=>number!=null?Number(item.number)===Number(number):item.notes?.some(note=>note.id===id));
 return source?.text?{verse:source.number,text:source.text}:null;
}
function showNoteOrigin(origin){ui['note-origin'].textContent=origin?`${origin.verse} ${origin.text}`:'';ui['note-origin'].hidden=!origin;}
function noteLoading(title){showNoteOrigin(null);ui['note-title'].textContent=title;ui['note-kind'].textContent='';ui['note-kind'].hidden=true;ui['note-body'].textContent='Carregando…';ui['note-links'].replaceChildren();ui['open-reference'].hidden=true;ui['note-back'].hidden=!noteHistory.length;}
function pushNote(){if(currentNote)noteHistory.push({...currentNote,scroll:ui['note-dialog'].scrollTop});}
function noteLabel(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();}
function appendPassage(container,data){
 for(const verse of data.verses){const p=document.createElement('p');if(verse.number){const n=document.createElement('span');n.className='reference-number';n.textContent=String(verse.number);p.append(n);}p.append(document.createTextNode(verse.text));container.append(p);}
 if(data.rangeHint){const hint=document.createElement('p');hint.className='note-empty';hint.textContent=data.rangeHint;container.append(hint);}
}
async function readPassage(link,publication=state.publication){
 const data=await rpc('chapter',{publication,book:Number(link.book),chapter:Number(link.chapter)});
 const start=Number(link.verse)||1,end=Number(link.endVerse)||start,cross=(link.endChapter&&Number(link.endChapter)!==Number(link.chapter))||(link.endBook&&Number(link.endBook)!==Number(link.book));
 const verses=data.verses.filter(v=>v.number>=start&&(cross||v.number<=end));
 if(!verses.length)throw new Error('Esta passagem não está disponível nesta edição.');
 return {verses,rangeHint:cross?'Exibindo o início da passagem neste capítulo. Abra o capítulo para continuar a leitura.':''};
}
function renderReferences(note,epoch){
 const publication=state.publication;
 // Keep resolved passages in the note history so returning never flashes loaders.
 const previews=note.previews||(note.previews=(note.links||[]).map(link=>({link,data:null})));
 const rows=previews.map(preview=>{
  const {link}=preview,section=document.createElement('section');section.className='reference-preview';
  const title=document.createElement('h3');title.className='reference-preview-title';title.textContent=link.label||`${nameOf(link.book)} ${link.chapter}:${link.verse||1}`;
  const body=document.createElement('div');body.className='reference-preview-body';
  const open=button('Abrir capítulo','reference-preview-open',async()=>{if(await closeNotes())loadChapter(link.book,link.chapter,null,false,link.verse,referenceEnd(link));});open.setAttribute('aria-label',`Abrir capítulo de ${title.textContent}`);
  section.append(title,body,open);ui['note-body'].append(section);
  if(preview.data)appendPassage(body,preview.data);else{body.textContent='Carregando…';body.setAttribute('aria-busy','true');}
  return {preview,body};
 });
 const active=()=>epoch===noteEpoch&&ui['note-dialog'].open;
 async function fill({preview,body}){
  if(!active()||preview.data)return;
  body.textContent='Carregando…';body.setAttribute('aria-busy','true');
  try{const data=await readPassage(preview.link,publication);preview.data=data;if(!active())return;body.replaceChildren();appendPassage(body,data);window.BibleMotion?.content(body);}
  catch(error){if(!active())return;const message=document.createElement('p');message.className='note-empty';message.textContent=error.message;const retry=button('Tentar novamente','reference-preview-open',()=>fill({preview,body}));body.replaceChildren(message,retry);}
  finally{if(active())body.removeAttribute('aria-busy');}
 }
 // Do not queue seven full chapters after the reader has already closed the sheet.
 (async()=>{for(const row of rows){if(!active())break;await fill(row);}})();
}
function renderNote(note){
 const epoch=++noteEpoch;
 const update=()=>{
  currentNote=note;
  showNoteOrigin(note.kind==='reference'?note.origin:null);
  const title=note.kind==='study'&&/^\d+:\d+(?:[-–]\d+)?$/.test(note.title||'')?`${nameOf(state.book)} ${note.title}`:note.title||'Nota';
  const kind=({footnote:'Nota de rodapé',study:'Nota de estudo',reference:'Referências cruzadas',extract:'Glossário',passage:'Passagem bíblica'})[note.kind]||'Nota';
  ui['note-title'].textContent=title;ui['note-kind'].textContent=kind;ui['note-kind'].hidden=noteLabel(kind)===noteLabel(title);
  ui['note-body'].replaceChildren();ui['note-links'].replaceChildren();ui['note-back'].hidden=!noteHistory.length;ui['open-reference'].hidden=!note.target;
  if(note.kind==='reference')renderReferences(note,epoch);
  else{
   if(note.verses)appendPassage(ui['note-body'],note);
   else if(note.parts?.length)appendStudyParts(ui['note-body'],note.parts,(link,trigger)=>link.documentId!=null?followLink(link,trigger):link.noteId?openNestedNote(link.noteId):openPassage(link));
   else ui['note-body'].textContent=note.text||'';
   for(const link of note.parts?.length?[]:note.links||[]){const b=button(link.label||'Ler referência','reference-link',()=>link.documentId!=null?followLink(link):link.noteId?openNestedNote(link.noteId):openPassage(link));ui['note-links'].append(b);}
  }
  ui['note-dialog'].scrollTop=note.scroll||0;
 };
 if(window.BibleDialogs?.resize)window.BibleDialogs.resize(ui['note-dialog'],update);else update();
 window.BibleMotion?.content(ui['note-body']);
}
async function openNote(id,trigger,verse){const origin=referenceOrigin(id,verse);noteTrigger=trigger;noteHistory=[];currentNote=null;document.body.classList.add('sheet-open');showDialog(ui['note-dialog']);await fetchNote(id,origin);}
async function fetchNote(id,origin=referenceOrigin(id)){const epoch=++noteEpoch;noteLoading('Nota');try{const note=await rpc('note',{publication:state.publication,id});if(epoch!==noteEpoch||!ui['note-dialog'].open)return;renderNote({...note,origin:note.kind==='reference'?origin:null});}catch(e){if(epoch===noteEpoch&&ui['note-dialog'].open){ui['note-body'].textContent=e.message;ui['note-title'].textContent='Não foi possível abrir a nota';}}}
async function openNestedNote(id){pushNote();await fetchNote(id);}
async function openPassage(link){
 pushNote();const epoch=++noteEpoch;noteLoading(link.label||'Passagem bíblica');
 try{const data=await readPassage(link);if(epoch!==noteEpoch||!ui['note-dialog'].open)return;
 renderNote({title:link.label||`${nameOf(link.book)} ${link.chapter}:${Number(link.verse)||1}`,kind:'passage',...data,links:[],target:link});
 }catch(e){if(epoch===noteEpoch&&ui['note-dialog'].open)ui['note-body'].textContent=e.message;}
}
function openVerseStudies(notes,verse,trigger){if(notes.length===1)return openNote(notes[0].id,trigger);noteTrigger=trigger;noteHistory=[];currentNote=null;document.body.classList.add('sheet-open');showDialog(ui['note-dialog']);renderNote({title:`${nameOf(state.book)} ${state.chapter}:${verse}`,kind:'study',text:'Notas de estudo deste versículo',links:notes.map(n=>({noteId:n.id,label:n.title}))});}
function setArticleReferenceContext(active){
 if(active&&articleStudyContext)document.body.dataset.studyReferenceContext='article';else delete document.body.dataset.studyReferenceContext;
 document.dispatchEvent(new CustomEvent('sentinela:reference-context',{detail:{active:active&&!!articleStudyContext}}));
}
function returnToStudyArticle(){
 if(!articleStudyContext)return;
 let previous;
 try{previous=new URL(document.referrer);}catch{}
 if(previous?.href===articleStudyContext.returnURL.href&&history.length>1)history.back();
 else location.assign(articleStudyContext.returnURL.href);
}
function configureArticleReference(context){
 articleStudyContext=context;
 if(!context){document.documentElement.classList.remove('article-study-opening');return;}
 document.documentElement.classList.add('article-study-opening');
 ui['study-reference-body'].textContent='Abrindo a nota de estudo…';
 ui['study-article-title'].textContent=context.returnTitle||'Voltar ao artigo';
 for(const id of ['study-article-back','study-reference-back'])ui[id].onclick=returnToStudyArticle;
 setArticleReferenceContext(true);
}
document.addEventListener('sentinela:return-to-article',returnToStudyArticle);
function appendStudyParts(container,parts,onFollow){
 for(const part of parts||[]){
  let content;
  if(part.link){
   const label=part.text||part.link.label||'Referência',leading=label.match(/^\s+/u)?.[0]||'',trailing=label.match(/\s+$/u)?.[0]||'';
   // Inline anchors let the citation and surrounding punctuation wrap like
   // ordinary text, while preserving the source's surrounding whitespace.
   if(!label.trim())content=document.createTextNode(label);
   else{
    const link=document.createElement('a');link.className='inline-reference';link.href='#';link.setAttribute('role','button');link.tabIndex=0;link.textContent=label.slice(leading.length,label.length-trailing.length);
    link.onclick=event=>{event.preventDefault();onFollow(part.link,event.currentTarget);};
    link.onkeydown=event=>{if(!['Enter',' '].includes(event.key))return;event.preventDefault();if(!event.repeat)onFollow(part.link,event.currentTarget);};
    content=document.createDocumentFragment();content.append(document.createTextNode(leading),link,document.createTextNode(trailing));
   }
  }else content=document.createTextNode(part.text||'');
  if(part.emphasis||part.italic){const em=document.createElement('em');em.append(content);content=em;}
  if(part.strong||part.bold){const strong=document.createElement('strong');strong.append(content);content=strong;}
  container.append(content);
 }
}
function showStudyReference(data,direction='replace'){
 studyReferenceData=data;
 screen('study-reference','Referências','',true);
 ui['study-publication-title'].textContent=editionName();
 ui['study-publication-book'].textContent=nameOf(data.book);
 ui['study-publication'].disabled=false;
 ui['study-publication'].setAttribute('aria-label',`Abrir ${nameOf(data.book)} ${data.chapter} na Bíblia`);
 ui['study-publication'].onclick=()=>loadChapter(data.book,data.chapter,null,true,data.verse.number);
 const body=ui['study-reference-body'];body.replaceChildren();
 const excerpt=document.createElement('p');excerpt.className='study-reference-verse';
 const number=document.createElement('strong');number.className='study-reference-number';number.textContent=String(data.verse.number);
 excerpt.append(number,document.createTextNode(' '+data.verse.text));body.append(excerpt);
 for(const note of data.notes){
  const section=document.createElement('section');section.className='study-reference-note';
  if(note.parts?.length)appendStudyParts(section,note.parts,(link,trigger)=>followLink(link,trigger));
  else{section.textContent=note.text||'';for(const link of note.links||[])section.append(button(link.label||'Ler referência','reference-link',event=>followLink(link,event.currentTarget)));}
  body.append(section);
 }
 window.scrollTo(0,0);window.BibleMotion?.transition(ui['study-reference'],direction);
}
function studyReferenceError(message,retry){
 screen('study-reference','Referências','',true);
 const body=ui['study-reference-body'],text=document.createElement('p');text.className='study-reference-status';text.textContent=message;
 body.replaceChildren(text);if(retry)body.append(button('Tentar novamente','button',retry));
}
async function openOpeningStudy(route){
 if(openingStudyHandled||!route.studyVerse)return;
 if(!['reading','study-reference'].includes(state.screen)||Number(state.book)!==route.book||Number(state.chapter)!==route.chapter||document.querySelector('dialog[open]'))return;
 openingStudyHandled=true;
 const verse=state.data?.verses.find(item=>Number(item.number)===route.studyVerse);
 const notes=(verse?.notes||[]).filter(note=>note.kind==='study');
 if(articleStudyContext){
  const target={book:Number(state.book),chapter:Number(state.chapter),verse};
  if(!verse||!notes.length){studyReferenceError('Esta edição não tem nota de estudo para este versículo.');return;}
  screen('study-reference','Referências','',true);ui['study-publication'].disabled=true;ui['study-publication-book'].textContent=nameOf(target.book);
  ui['study-reference-body'].textContent='Abrindo a nota de estudo…';
  const epoch=state.epoch;
  try{const content=await Promise.all(notes.map(note=>rpc('note',{publication:state.publication,id:note.id})));if(epoch!==state.epoch||state.screen!=='study-reference')return;showStudyReference({...target,notes:content});}
  catch(error){if(epoch===state.epoch)studyReferenceError(error.message,()=>{openingStudyHandled=false;if(worker)openOpeningStudy(route);else start();});}
  return;
 }
 if(!notes.length){toast('Esta edição não tem nota de estudo para este versículo.');return;}
 await openVerseStudies(notes,route.studyVerse,document.getElementById(`verse-${route.studyVerse}`));
}
ui['note-back'].onclick=()=>{++noteEpoch;const note=noteHistory.pop();if(note)renderNote(note);};
ui['note-close'].onclick=closeNotes;
ui['note-dialog'].addEventListener('close',()=>{if(ui['note-dialog'].open)return;++noteEpoch;if(!document.querySelector('dialog[open]'))document.body.classList.remove('sheet-open');if(noteTrigger?.isConnected&&!document.querySelector('dialog[open]'))noteTrigger.focus({preventScroll:true});});
function showDialog(dialog){if(window.BibleDialogs)window.BibleDialogs.show(dialog);else{document.body.classList.add('sheet-open');dialog.showModal();}}
function closeDialog(dialog){if(window.BibleDialogs)return window.BibleDialogs.close(dialog);dialog.close();return Promise.resolve(true);}
function openDialog(id){showDialog(ui[id]);}
ui['open-reference'].onclick=async()=>{const ref=currentNote?.target;if(ref&&await closeNotes())loadChapter(ref.book,ref.chapter,null,false,ref.verse,referenceEnd(ref));};
ui['add-file'].onclick=ui['empty-add'].onclick=()=>ui['file-input'].click();ui['file-input'].onchange=e=>importFile(e.target.files[0]);ui.publication.onchange=()=>selectPublication();ui.back.onclick=back;ui.previous.onclick=()=>nextChapter(-1);ui.next.onclick=()=>nextChapter(1);ui.smaller.onclick=()=>changeFont(-1);ui.larger.onclick=()=>changeFont(1);ui.bookmark.onclick=showBookmarks;
ui.menu.onclick=()=>openDialog('options-dialog');
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeDialog(ui[b.dataset.close]));
ui['options-bookmarks'].onclick=async()=>{if(await closeDialog(ui['options-dialog']))showBookmarks();};
document.querySelectorAll('[data-destination]').forEach(b=>b.onclick=async()=>{if(!await closeDialog(ui['options-dialog']))return;const d=b.dataset.destination;if(d==='bible')showBooks();else if(d==='reading'&&state.hasReading){++state.epoch;showReading(true);}else if(d==='library')showLibrary();else if(d==='bookmarks')showBookmarks();});
async function prepareIncludedBible(){
 const visible=openingRestored&&state.screen!=='empty'&&state.books.length>0,openingEpoch=state.epoch;
 if(!visible){setBusy(true);notice('Preparando a Bíblia incluída…');}
 ui['retry-bundle'].hidden=true;
 try{
  const bundled=await rpc('ensure-bundled'),route=openingRoute();
  const canOpenStudy=!visible||state.epoch===openingEpoch;
  // A cached view is already interactive. Never reset it after a user's tap.
  if(!visible){
   await refresh(route.book||route.grid?{publication:bundled.id}:undefined);setBusy(false);
   if(route.book){if(route.chapter)await loadChapter(route.book,route.chapter,null,true,route.verse,referenceEnd(route));else await showChapters(route.book);}
  }else if(state.epoch===openingEpoch){
   if(route.book&&route.chapter&&(state.book!==String(route.book)||state.chapter!==String(route.chapter)))await loadChapter(route.book,route.chapter,null,true,route.verse,referenceEnd(route));
   else if(!route.book&&!route.grid){const saved=read('jwpub-reading',{});if(saved.book&&saved.chapter&&(state.book!==String(saved.book)||state.chapter!==String(saved.chapter)))await loadChapter(saved.book,saved.chapter,null,true);}
  }
  openingRestored=true;saveOpeningView();
  if(canOpenStudy&&articleStudyContext&&(!['reading','study-reference'].includes(state.screen)||Number(state.book)!==route.book||Number(state.chapter)!==route.chapter||!state.data?.verses?.some(verse=>Number(verse.number)===route.studyVerse)))throw new Error(ui.status.textContent||'Não foi possível carregar o versículo desta nota.');
  if(canOpenStudy)await openOpeningStudy(route);
  window.prepareSentinelaBibleOffline?.({textReady:true,fresh:!bundled.reused});
  if(state.hasReading)bibleAudio?.prepare(audioContext()).catch(()=>{});
 }catch(e){notice(e.message,true);ui['retry-bundle'].hidden=false;if(articleStudyContext)studyReferenceError(e.message,()=>{openingStudyHandled=false;if(worker)prepareIncludedBible();else start();});}
 finally{if(!visible)setBusy(false);}
}
async function start(){
 const routes=await articleStudyRoutes;configureArticleReference(routes?.studyReferenceContext(location.search)||null);
 applyGlobalFont();
 openingRestored=restoreOpeningView();
 if(!window.Worker||!window.indexedDB||!window.crypto?.subtle||!window.WebAssembly){const message='Abra o link seguro no Safari atualizado.';notice(message,true);if(articleStudyContext)studyReferenceError(message);return;}
 try{
  worker=new Worker('reader-worker.js');
  worker.onmessage=({data})=>{if(data.progress){if(state.busy&&!openingRestored)notice(data.progress);return;}const call=pending.get(data.id);if(!call)return;pending.delete(data.id);data.error?call.reject(new Error(data.error)):call.resolve(data.result);};
  worker.onerror=()=>{const error=new Error('O leitor não conseguiu iniciar. Reabra a página e tente novamente.');for(const call of pending.values())call.reject(error);pending.clear();worker.terminate();worker=null;notice(error.message,true);ui['retry-bundle'].hidden=false;if(articleStudyContext)studyReferenceError(error.message,()=>{openingStudyHandled=false;start();});};
  await prepareIncludedBible();
 }catch(e){notice(e.message,true);ui['retry-bundle'].hidden=false;if(articleStudyContext)studyReferenceError(e.message,()=>{openingStudyHandled=false;start();});}
}
ui['retry-bundle'].onclick=()=>worker?prepareIncludedBible():start();

readAlong=initReadAlong({root:ui.verses,getCurrent:()=>({...audioContext(),screen:state.screen}),onReturn:async(context,verse)=>{if(context.publication!==state.publication){ui.publication.value=context.publication;await selectPublication({book:context.book,chapter:context.chapter});}else await loadChapter(context.book,context.chapter,null,false,verse);}});
bibleAudio=initBibleAudio({onProgress:info=>readAlong.update(info),resolveSource:resolveBibleAudio,getCurrent:()=>audioContext(),onNotice:toast,onNavigate:async context=>{if(context.publication!==state.publication){ui.publication.value=context.publication;await selectPublication({book:context.book,chapter:context.chapter});}else await loadChapter(context.book,context.chapter,null,true);return audioContext(context.verse);}});
textActions=initTextActions({root:ui.verses,getChapter:()=>({...state.data,book:Number(state.book),chapter:Number(state.chapter)}),getName:()=>nameOf(state.book),onListen:selection=>bibleAudio.listen(audioContext(selection.startVerse)),onBookmark:bookmarkSelection,onStudy:selection=>openVerseStudies(selection.notes,selection.startVerse,document.getElementById(`verse-${selection.startVerse}`)),onNotice:toast,onSelect:clearPassageHighlight,onDismiss:clearPassageHighlight});
ui['listen-chapter'].onclick=()=>{textActions.clear();bibleAudio.listen(audioContext());};
const bibleSearchProvider=createBibleSearchProvider({
 getPublication:()=>state.publication,
 getBooks:()=>state.books.map(book=>({...book,name:nameOf(book.number),aliases:[abbreviations[book.number-1]]})),
 readChapter:(book,chapter)=>rpc('chapter',{publication:state.publication,book,chapter})
});
const bibleSearch=initBibleSearch({view:ui['search-dialog'],getPublication:()=>state.publication,search:options=>bibleSearchProvider.search(options),onOpen:openSearchResult,
 onEnter:()=>{
  searchReturn={screen:state.screen,title:ui['screen-title'].textContent,subtitle:ui['screen-subtitle'].textContent,back:!ui.back.hidden,scroll:window.scrollY};
  ++state.epoch;
  screen('search','Buscar na Bíblia','',true);
 },
 onLeave:()=>{
  const previous=searchReturn;searchReturn=null;
  if(!previous)return;
  screen(previous.screen,previous.title,previous.subtitle,previous.back);
  // Result navigation may record this screen as its Back destination.
  window.scrollTo({top:previous.scroll,left:0,behavior:'instant'});
 }
});
ui.search.onclick=()=>bibleSearch.open(ui.search);
start();
