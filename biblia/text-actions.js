'use strict';
// Whole-verse actions use publication text, so notes and reference labels never leak into a copy.
function initTextActions({root,getChapter,getName,onListen,onBookmark,onStudy,onNotice,onSelect,onDismiss}) {
  if(!root || typeof getChapter!=='function')throw new Error('O menu precisa do texto do capítulo.');
  const icons={
    study:'<path d="M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 1-3-1-5-2-9-1Z"/><path d="M12 5v15M6 9h3M15 9h3M6 13h3M15 13h3"/>',
    bookmark:'<path d="M6 2h12v20l-6-5-6 5Z"/>',
    share:'<path d="M4 19c1-7 5-10 12-10V4l6 8-6 7v-5c-6 0-9 1-12 5Z"/>',
    copy:'<path d="M8 6H3v16h13v-5M8 2h9l4 4v11H8Z"/><path d="M17 2v5h4"/>',
    listen:'<path d="M3 14v-3a9 9 0 0 1 18 0v3M3 12h4v9H3zM17 12h4v9h-4z"/>',
    clear:'<path d="m6 6 12 12M18 6 6 18"/>'
  };
  const toolbar=document.createElement('div');toolbar.id='text-actions';toolbar.className='text-actions';toolbar.hidden=true;
  toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Opções do texto selecionado');
  const buttons={},labels={study:'Notas de estudo',bookmark:'Marcar passagem',share:'Compartilhar',copy:'Copiar',listen:'Ouvir áudio',clear:'Fechar opções'};
  for(const name of ['study','bookmark','share','copy','listen','clear']) {
    const b=document.createElement('button');b.type='button';b.id='action-'+name;b.setAttribute('aria-label',labels[name]);b.title=labels[name];
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[name]+'</svg>';buttons[name]=b;toolbar.append(b);
  }
  document.body.append(toolbar);
  const events=new AbortController(),signal=events.signal;
  let selected=[],anchorElement=null,chapterKey='',frame=0;
  let gesture=null,holdTimer=0,suppressUntil=0;
  const nativeControl='.note-marker,.study-word,a,.inline-reference';
  const tell=(message,error=false)=>{if(typeof onNotice==='function')onNotice(message,error);};
  const numericVerse=e=>{const value=Number(e?.dataset.verse);return Number.isInteger(value)&&value>0?value:null;};
  const verseNumber=n=>Array.from(root.querySelectorAll('.verse-number'))
    .find(number=>numericVerse(number.closest('[data-verse]'))===n);
  const chapterId=data=>data?`${data.book}:${data.chapter}`:'';
  function hasNativeSelection() {
    const value=window.getSelection();if(!value || value.isCollapsed || !value.rangeCount)return false;
    for(let i=0;i<value.rangeCount;i++)if(value.getRangeAt(i).intersectsNode(root))return true;
    return false;
  }
  function clear() {
    selected=[];anchorElement=null;chapterKey='';toolbar.hidden=true;
    root.classList.remove('has-text-selection');root.removeAttribute('data-selected-reference');
    root.querySelectorAll('.text-selected,.text-unselected').forEach(e=>e.classList.remove('text-selected','text-unselected'));
    root.querySelectorAll('.verse-number[role="button"]').forEach(e=>e.setAttribute('aria-pressed','false'));
  }
  function dismiss() {
    clear();
    if(typeof onDismiss==='function')onDismiss();
  }
  function refresh() {
    clear();
    for(const number of root.querySelectorAll('.verse-number')){
      const n=numericVerse(number.closest('[data-verse]'));if(n==null)continue;
      number.setAttribute('role','button');number.tabIndex=0;number.setAttribute('aria-label',`Opções do versículo ${n}`);
      number.setAttribute('aria-controls',toolbar.id);number.setAttribute('aria-pressed','false');
    }
  }
  function selection() {
    const data=getChapter();if(!data || chapterId(data)!==chapterKey || !selected.length)return null;
    const verses=(data.verses||[]).filter(v=>selected.includes(Number(v.number))).sort((a,b)=>Number(a.number)-Number(b.number));
    if(!verses.length)return null;
    const first=Number(verses[0].number),last=Number(verses[verses.length-1].number),bookName=typeof getName==='function'?getName(data.book):data.book;
    const reference=`${bookName} ${data.chapter}:${first}${last!==first?'–'+last:''}`;
    const body=verses.map(v=>`${v.number} ${String(v.text||'').trim()}`).join(' ');
    const notes=[],seen=new Set();
    for(const v of verses)for(const note of v.notes||[])if(note.kind==='study'&&!seen.has(note.id)){seen.add(note.id);notes.push(note);}
    return {book:Number(data.book),chapter:Number(data.chapter),startVerse:first,endVerse:last,verses:verses.map(v=>Number(v.number)),text:reference+'\n'+body,reference,notes};
  }
  function paint() {
    const value=selection();if(!value){clear();return;}
    root.classList.add('has-text-selection');root.dataset.selectedReference=value.reference;
    root.querySelectorAll('[data-verse]').forEach(el=>{const n=numericVerse(el);el.classList.toggle('text-selected',selected.includes(n));el.classList.toggle('text-unselected',n!=null&&!selected.includes(n));});
    root.querySelectorAll('.verse-number[role="button"]').forEach(el=>el.setAttribute('aria-pressed',String(selected.includes(numericVerse(el.closest('[data-verse]'))))));
    buttons.study.hidden=typeof onStudy!=='function'||!value.notes.length;
    buttons.bookmark.hidden=typeof onBookmark!=='function';buttons.listen.hidden=typeof onListen!=='function';
    // A verse can span many inline fragments/paragraphs. Its number is the only
    // stable anchor, independent of where in that text the reader tapped.
    anchorElement=verseNumber(value.startVerse);
    if(!anchorElement){clear();return;}
    toolbar.hidden=false;position(true);
  }
  function position(reveal=false) {
    frame=0;if(toolbar.hidden || !anchorElement)return;
    if(!anchorElement.isConnected || !root.getClientRects().length){clear();return;}
    let rect=anchorElement.getBoundingClientRect();const view=window.visualViewport;
    const viewLeft=view?.offsetLeft||0,viewTop=view?.offsetTop||0,viewWidth=view?.width||innerWidth,viewBottom=viewTop+(view?.height||innerHeight);
    const header=document.querySelector('.app-header')?.getBoundingClientRect();
    const player=document.querySelector('#audio-player:not([hidden])');const footer=(player||document.querySelector('.bottom-navbar'))?.getBoundingClientRect();
    // Keep clear of the header without wasting the space above the first,
    // enlarged chapter number (including at the largest reading font).
    const topEdge=Math.max(viewTop+8,header?.bottom+2||0),bottomEdge=Math.min(viewBottom-8,footer?.top-8||viewBottom-8);
    const menuRect=toolbar.getBoundingClientRect(),gap=12;
    const preferred=reveal?null:toolbar.dataset.placement;
    const placement=()=>{
      if(rect.top<topEdge-1 || rect.bottom>bottomEdge+1)return null;
      if(preferred!=='below'&&rect.top-menuRect.height-gap>=topEdge-1)return 'above';
      if(preferred!=='above'&&rect.bottom+gap+menuRect.height<=bottomEdge+1)return 'below';
      return null;
    };
    let side=placement();
    if(!side&&reveal){
      // Make room once when opening, including when a long verse starts above
      // the screen. At the start of a chapter, use the space below its number
      // instead of trying to scroll above the beginning of the document.
      const firstTop=topEdge+menuRect.height+gap,lastTop=bottomEdge-rect.height;
      if(lastTop<firstTop){clear();return;}
      const targetTop=Math.max(firstTop,Math.min(lastTop,rect.top));
      if(Math.abs(rect.top-targetTop)>0.5){
        window.scrollBy({top:rect.top-targetTop,behavior:'instant'});
        rect=anchorElement.getBoundingClientRect();
      }
      side=placement();
    }
    const top=side==='below'?rect.bottom+gap:rect.top-menuRect.height-gap;
    // Do not clamp the menu onto the selected text or detach it from its number.
    // WebKit can round scroll offsets to whole pixels while text rects remain fractional.
    if(!side){clear();return;}
    const middle=(rect.left+rect.right)/2;
    const left=Math.max(viewLeft+8,Math.min(viewLeft+viewWidth-menuRect.width-8,middle-menuRect.width/2));
    toolbar.dataset.placement=side;
    toolbar.style.left=left+'px';toolbar.style.top=top+'px';toolbar.style.setProperty('--arrow-x',Math.max(13,Math.min(menuRect.width-13,middle-left))+'px');
  }
  function queuePosition(){if(!frame)frame=requestAnimationFrame(()=>position());}
  function choose(event) {
    const target=event.target instanceof Element?event.target:null;
    if(!target || target.closest(nativeControl))return;
    // A native range belongs to Safari: never replace it or compete with its handles/menu.
    if(hasNativeSelection() || performance.now()<suppressUntil || event.detail>1 || event.button>0 || event.metaKey || event.ctrlKey || event.altKey){clear();return;}
    const el=target.closest('[data-verse]');if(!el || !root.contains(el))return;
    const n=numericVerse(el),data=getChapter();if(n==null || !(data?.verses||[]).some(v=>Number(v.number)===n))return;
    event.stopPropagation();
    const key=chapterId(data);if(key!==chapterKey)clear();chapterKey=key;
    if(selected.length===1&&selected[0]===n){dismiss();return;}
    // A tap chooses one verse. Safari's native range handles remain available
    // for copying a freely selected passage by pressing and dragging.
    selected=[n];
    if(typeof onSelect==='function')onSelect();
    paint();
  }
  function leaveToNative() {
    suppressUntil=Math.max(suppressUntil,performance.now()+700);clear();
  }
  function startGesture(event) {
    clearTimeout(holdTimer);
    if(event.isPrimary===false || event.button>0 || event.touches?.length>1){gesture=null;leaveToNative();return;}
    const point=event.touches?.[0]||event;
    gesture={id:event.pointerId,x:point.clientX,y:point.clientY,start:performance.now(),moved:false,native:hasNativeSelection()};
    if(gesture.native)leaveToNative();
    holdTimer=setTimeout(()=>{if(gesture){gesture.native=true;leaveToNative();}},400);
  }
  function moveGesture(event) {
    if(!gesture || event.pointerId!=null&&gesture.id!==event.pointerId)return;
    const point=event.touches?.[0]||event;
    if(Math.hypot(point.clientX-gesture.x,point.clientY-gesture.y)>8){gesture.moved=true;clearTimeout(holdTimer);leaveToNative();}
  }
  function endGesture(event) {
    if(!gesture || event.pointerId!=null&&gesture.id!==event.pointerId)return;
    clearTimeout(holdTimer);
    if(gesture.native || gesture.moved || performance.now()-gesture.start>=400 || event.type.endsWith('cancel'))leaveToNative();
    gesture=null;
  }
  // Pointer Events cover current iPhones; touch events keep older WebKit on the same contract.
  if('PointerEvent' in window){
    root.addEventListener('pointerdown',startGesture,{passive:true,signal});
    document.addEventListener('pointermove',moveGesture,{passive:true,signal});
    document.addEventListener('pointerup',endGesture,{passive:true,signal});
    document.addEventListener('pointercancel',endGesture,{passive:true,signal});
  }else{
    root.addEventListener('touchstart',startGesture,{passive:true,signal});
    document.addEventListener('touchmove',moveGesture,{passive:true,signal});
    document.addEventListener('touchend',endGesture,{passive:true,signal});
    document.addEventListener('touchcancel',endGesture,{passive:true,signal});
  }
  root.addEventListener('click',choose,{capture:true,signal});
  root.addEventListener('contextmenu',leaveToNative,{signal});
  root.addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key) || !event.target.matches?.('.verse-number[role="button"]'))return;event.preventDefault();choose(event);},{signal});
  document.addEventListener('selectionchange',()=>{if(hasNativeSelection())leaveToNative();},{signal});
  document.addEventListener('pointerdown',event=>{if(toolbar.hidden)return;const el=event.target instanceof Element?event.target:null;if(el && (toolbar.contains(el)||root.contains(el)&&!el.closest(nativeControl)))return;clear();},{capture:true,signal});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!toolbar.hidden)dismiss();},{signal});
  window.addEventListener('scroll',queuePosition,{passive:true,signal});window.addEventListener('resize',queuePosition,{passive:true,signal});
  document.fonts?.addEventListener('loadingdone',queuePosition,{signal});
  window.visualViewport?.addEventListener('resize',queuePosition,{passive:true,signal});window.visualViewport?.addEventListener('scroll',queuePosition,{passive:true,signal});
  function callback(fn,value){clear();try{Promise.resolve(fn(value)).catch(e=>tell(e?.message||'Não foi possível concluir esta ação.',true));}catch(e){tell(e?.message||'Não foi possível concluir esta ação.',true);}}
  function legacyCopy(text){
    const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.style.cssText='position:fixed;left:0;top:0;opacity:0;font-size:16px;pointer-events:none';
    document.body.append(field);field.focus();field.select();field.setSelectionRange(0,text.length);
    let copied=false;try{copied=document.execCommand('copy');}finally{field.remove();}return copied;
  }
  async function copy(value){
    try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value.text);else if(!legacyCopy(value.text))throw new Error();clear();tell('Texto copiado.');}
    catch{if(legacyCopy(value.text)){clear();tell('Texto copiado.');}else tell('Não foi possível copiar. Tente novamente no Safari.',true);}
  }
  buttons.clear.onclick=dismiss;buttons.copy.onclick=()=>{const value=selection();if(value)copy(value);};
  buttons.share.onclick=()=>{const value=selection();if(!value)return;if(!navigator.share){copy(value);return;}navigator.share({title:value.reference,text:value.text}).then(clear).catch(error=>{if(error?.name!=='AbortError')tell('Não foi possível compartilhar esta passagem.',true);});};
  buttons.bookmark.onclick=()=>{const value=selection();if(value&&typeof onBookmark==='function')callback(onBookmark,value);};
  buttons.listen.onclick=()=>{const value=selection();if(value&&typeof onListen==='function')callback(onListen,value);};
  buttons.study.onclick=()=>{const value=selection();if(value&&typeof onStudy==='function')callback(onStudy,value);};
  refresh();
  return {clear,refresh,getSelection:selection,destroy(){clear();events.abort();clearTimeout(holdTimer);if(frame)cancelAnimationFrame(frame);toolbar.remove();}};
}
