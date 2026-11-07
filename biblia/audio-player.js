'use strict';

// Official timings may describe groups of verses, so highlight the entire group.
function bibleAudioVerseRange(source, context, position) {
  const time=Number(position);
  if(!source || !Number.isFinite(time) || time<0)return {verse:null,endVerse:null};
  const markers=(source.markers||[]).filter(m=>Number.isInteger(Number(m.verse))&&Number(m.verse)>=0&&Number.isFinite(Number(m.start))&&Number(m.start)>=0).sort((a,b)=>Number(a.start)-Number(b.start)||Number(a.verse)-Number(b.verse));
  let at=-1;
  for(let i=0;i<markers.length;i++){if(Number(markers[i].start)>time)break;at=i;}
  if(at<0 || Number(markers[at].verse)===0)return {verse:null,endVerse:null};
  const verse=Number(markers[at].verse),next=markers.slice(at+1).find(m=>Number(m.verse)>verse);
  const values=Array.isArray(context?.verses)?context.verses.map(v=>Number(typeof v==='object'?v?.number:v)).filter(n=>Number.isInteger(n)&&n>0):[];
  const count=Number(context?.verseCount),limit=values.length?Math.max(...values):Number.isInteger(count)&&count>0?count:null;
  if(limit!=null&&verse>limit)return {verse:null,endVerse:null};
  const endVerse=Math.min(next?Number(next.verse)-1:limit??verse,limit??Number.MAX_SAFE_INTEGER);
  return {verse,endVerse:Math.max(verse,endVerse)};
}

// Stream the official recording with native media controls and iPhone media-session support.
function initBibleAudio({resolveSource,getCurrent,onNotice=()=>{},onNavigate=()=>{},onProgress=()=>{}}) {
  const existing=document.getElementById('audio-player');
  if(existing)throw new Error('O reprodutor já foi iniciado.');
  const icons={
    play:'<path d="m8 4 12 8-12 8Z"/>',
    pause:'<path d="M8 4v16M16 4v16"/>',
    back:'<path d="M7 5H2V0M2 5a10 10 0 1 1-1 11"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-size="10">5</text>',
    forward:'<path d="M17 5h5V0M22 5a10 10 0 1 0 1 11"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-size="10">15</text>',
    previous:'<path d="M5 4v16M19 4 7 12l12 8Z"/>',
    next:'<path d="M19 4v16M5 4l12 8-12 8Z"/>',
    close:'<path d="m5 5 14 14M19 5 5 19"/>',
    speaker:'<path d="M2 9h4l5-5v16l-5-5H2Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>'
  };
  const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  const root=document.createElement('section');root.id='audio-player';root.className='audio-player';root.hidden=true;root.setAttribute('aria-label','Reprodutor de áudio da Bíblia');
  root.innerHTML=`<div class="audio-info"><span class="audio-track-icon">${svg('speaker')}</span><span id="audio-title" class="audio-title"></span><span id="audio-time" class="audio-time">0:00 / 0:00</span></div><input id="audio-seek" class="audio-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Posição do áudio"><div class="audio-controls"><button id="audio-play" type="button" aria-label="Reproduzir">${svg('play')}</button><button id="audio-back" type="button" aria-label="Voltar 5 segundos">${svg('back')}</button><button id="audio-forward" type="button" aria-label="Avançar 15 segundos">${svg('forward')}</button><button id="audio-previous" type="button" aria-label="Capítulo anterior">${svg('previous')}</button><button id="audio-next" type="button" aria-label="Próximo capítulo">${svg('next')}</button><button id="audio-rate" type="button" aria-label="Velocidade de reprodução: 1 vez">1×</button><button id="audio-close" type="button" aria-label="Fechar áudio">${svg('close')}</button></div><p id="audio-status" class="audio-status" role="status" hidden></p>`;
  const audio=document.createElement('audio');audio.id='bible-audio';audio.preload='none';audio.setAttribute('playsinline','');root.append(audio);document.body.append(root);
  const byId=id=>root.querySelector('#audio-'+id);
  const controls=Object.fromEntries(['play','back','forward','previous','next','rate','close','seek','title','time','status'].map(id=>[id,byId(id)]));
  const resolved=new Map(),pending=new Map();
  let context=null,source=null,epoch=0,seekTo=null,dragging=false,rate=1,busy=false,lastProgress=null;
  const keyOf=c=>[c.symbol,c.language,c.book,c.chapter].join(':');
  const duration=()=>Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:Number(source?.duration)||0;
  const timeText=seconds=>{const value=Math.max(0,Math.floor(Number(seconds)||0)),minutes=Math.floor(value/60);return `${minutes}:${String(value%60).padStart(2,'0')}`;};
  function status(message=''){controls.status.textContent=message;controls.status.hidden=!message;}
  function show(){root.hidden=false;document.body.classList.add('audio-open');}
  function update(event){
    const total=duration(),time=dragging?Number(controls.seek.value):Number(audio.currentTime)||0;
    controls.time.textContent=`${timeText(time)} / ${timeText(total)}`;
    controls.seek.max=String(total||1);if(!dragging)controls.seek.value=String(Math.min(total||1,time));
    controls.seek.disabled=!source||!total;controls.seek.setAttribute('aria-valuetext',`${timeText(time)} de ${timeText(total)}`);
    controls.play.innerHTML=svg(audio.paused?'play':'pause');controls.play.setAttribute('aria-label',audio.paused?'Reproduzir':'Pausar');controls.play.disabled=busy;
    controls.back.disabled=controls.forward.disabled=!source;
    controls.previous.disabled=busy||!context||Number(context.chapter)<=1;
    controls.next.disabled=busy||!context||Number(context.chapter)>=(Number(context.chapters)||150);
    if('mediaSession' in navigator){try{navigator.mediaSession.playbackState=source?(audio.paused?'paused':'playing'):'none';if(source&&total&&time<=total&&navigator.mediaSession.setPositionState)navigator.mediaSession.setPositionState({duration:total,playbackRate:audio.playbackRate,position:Math.max(0,time)});}catch{}}
    const active=!!context&&!!source&&!root.hidden&&!busy&&!audio.error;
    const range=active?bibleAudioVerseRange(source,context,time):{verse:null,endVerse:null};
    lastProgress={context:context?{...context}:null,source:active?source:null,time,duration:total,playing:active&&!audio.paused&&!audio.ended,active,seeking:!!audio.seeking||dragging||seekTo!=null,reason:event?.type||'update',...range};
    onProgress(lastProgress);
  }
  function mediaMetadata(){
    if(!('mediaSession' in navigator))return;
    try{if('MediaMetadata' in window)navigator.mediaSession.metadata=new MediaMetadata({title:controls.title.textContent,artist:'Tradução do Novo Mundo',album:'Bíblia em áudio'});}catch{}
  }
  function prepare(candidate){
    if(!candidate)return Promise.resolve(null);
    const copy={...candidate},key=keyOf(copy);
    if(resolved.has(key))return Promise.resolve(resolved.get(key));
    if(pending.has(key))return pending.get(key);
    const request=Promise.resolve().then(()=>resolveSource(copy)).then(value=>{resolved.set(key,value);pending.delete(key);return value;},error=>{pending.delete(key);throw error;});
    pending.set(key,request);request.catch(()=>{});return request;
  }
  function seekPosition(seconds){
    const total=duration();const target=Math.max(0,Math.min(total||Number.MAX_SAFE_INTEGER,Number(seconds)||0));
    seekTo={epoch,time:target};
    try{audio.currentTime=target;if(audio.readyState>=1)seekTo=null;}catch{}
    update();
  }
  function play(){
    if(!source)return Promise.resolve(false);
    status('');
    const playEpoch=epoch;let result;try{result=audio.play();}catch(error){return playbackFailure(error);}
    return Promise.resolve(result).then(()=>{if(playEpoch!==epoch)return false;status('');update();return true;},error=>playEpoch===epoch?playbackFailure(error):false);
  }
  function playbackFailure(error){
    if(!context)return Promise.resolve(false);
    if(error?.name==='NotAllowedError'){
      status('Pronto para ouvir. Toque em reproduzir.');
      onNotice('Áudio pronto. Toque em Reproduzir para ouvir.');
    }else if(error?.name!=='AbortError'){
      status('Não foi possível reproduzir. Confira a conexão e toque em reproduzir.');
      onNotice('Não foi possível reproduzir o áudio. Confira a conexão e tente novamente.',true);
    }
    update();return Promise.resolve(false);
  }
  function selectedPosition(value,candidate){
    const verse=Number(candidate.verse)||1,markers=(value.markers||[]).filter(m=>Number.isFinite(Number(m.start))&&Number(m.verse)<=verse).sort((a,b)=>Number(a.verse)-Number(b.verse));
    const mark=markers[markers.length-1];
    return {time:mark?Number(mark.start):0,exact:!!mark&&Number(mark.verse)===verse};
  }
  function begin(value,candidate,requestEpoch){
    if(requestEpoch!==epoch||!context)return Promise.resolve(false);
    if(!value?.url||!/^https:\/\//i.test(value.url))throw new Error('A gravação deste capítulo não está disponível.');
    const changed=source?.url!==value.url||!!audio.error||!audio.hasAttribute('src');source=value;context={...candidate};busy=true;
    controls.title.textContent=candidate.title||`${value.bookTitle||'Bíblia'} ${candidate.chapter}`;
    if(changed){audio.pause();audio.src=value.url;audio.playbackRate=rate;}
    const position=selectedPosition(value,candidate);seekPosition(position.time);busy=false;mediaMetadata();update();
    if(Number(candidate.verse)>1&&!position.exact)onNotice('O áudio começa no trecho que inclui o versículo escolhido.');
    return play();
  }
  function listen(candidate=getCurrent?.()){
    if(!candidate)return Promise.resolve(false);
    const copy={...candidate},requestEpoch=++epoch,key=keyOf(copy);if(context&&keyOf(context)!==key){source=null;audio.pause();audio.removeAttribute('src');audio.load();}context=copy;busy=true;show();controls.title.textContent=copy.title||`Capítulo ${copy.chapter}`;status('Carregando áudio…');update();
    if(resolved.has(key)){
      try{return begin(resolved.get(key),copy,requestEpoch);}catch(error){busy=false;status(error.message);onNotice(error.message,true);update();return Promise.resolve(false);}
    }
    return prepare(copy).then(value=>begin(value,copy,requestEpoch)).catch(error=>{
      if(requestEpoch!==epoch)return false;
      busy=false;status(error?.message||'Não foi possível carregar o áudio.');onNotice(error?.message||'Não foi possível carregar o áudio.',true);update();return false;
    });
  }
  async function navigate(delta){
    if(!context||busy)return;
    const target={...context,chapter:Number(context.chapter)+delta,verse:1};
    if(target.chapter<1||target.chapter>(Number(context.chapters)||150))return;
    // A new title must be resolved from the new chapter rather than carrying the old title.
    target.title=source?.bookTitle?`${source.bookTitle} ${target.chapter}`:undefined;
    const activeEpoch=epoch;
    try{const returned=await onNavigate(target);if(activeEpoch!==epoch||returned===false)return;await listen(returned&&typeof returned==='object'?returned:target);}catch(error){onNotice(error?.message||'Não foi possível abrir o capítulo.',true);}
  }
  function close(){
    ++epoch;busy=false;context=null;source=null;seekTo=null;dragging=false;
    audio.pause();audio.removeAttribute('src');audio.load();root.hidden=true;document.body.classList.remove('audio-open');status('');
    if('mediaSession' in navigator){try{navigator.mediaSession.playbackState='none';navigator.mediaSession.metadata=null;}catch{}}
    update();
  }
  controls.play.onclick=()=>{if(!source||audio.error){if(context)listen(context);return;}if(audio.paused)play();else audio.pause();};
  controls.back.onclick=()=>seekPosition((Number(audio.currentTime)||0)-5);
  controls.forward.onclick=()=>seekPosition((Number(audio.currentTime)||0)+15);
  controls.previous.onclick=()=>navigate(-1);controls.next.onclick=()=>navigate(1);controls.close.onclick=close;
  controls.rate.onclick=()=>{const rates=[1,1.25,1.5,2];rate=rates[(rates.indexOf(rate)+1)%rates.length];audio.playbackRate=rate;controls.rate.textContent=String(rate).replace('.',',')+'×';controls.rate.setAttribute('aria-label',`Velocidade de reprodução: ${String(rate).replace('.',',')} vezes`);update();};
  controls.seek.addEventListener('input',()=>{dragging=true;update();});controls.seek.addEventListener('change',()=>{const time=Number(controls.seek.value);dragging=false;seekPosition(time);});
  audio.addEventListener('loadedmetadata',()=>{if(seekTo?.epoch===epoch){const target=seekTo.time;seekTo=null;try{audio.currentTime=target;}catch{}}update();});
  for(const event of ['timeupdate','durationchange','play','pause','ratechange','seeked','ended'])audio.addEventListener(event,update);
  audio.addEventListener('waiting',()=>{if(context&&!audio.paused)status('Carregando áudio…');});
  audio.addEventListener('playing',()=>{status('');update();});
  audio.addEventListener('error',()=>{if(!context||!source)return;status('Áudio indisponível. Confira a conexão e tente novamente.');busy=false;update();});
  if('mediaSession' in navigator){
    const actions={play:()=>play(),pause:()=>audio.pause(),seekbackward:event=>seekPosition(audio.currentTime-(event.seekOffset||5)),seekforward:event=>seekPosition(audio.currentTime+(event.seekOffset||15)),seekto:event=>seekPosition(event.seekTime),previoustrack:()=>navigate(-1),nexttrack:()=>navigate(1),stop:close};
    for(const [name,handler] of Object.entries(actions)){try{navigator.mediaSession.setActionHandler(name,handler);}catch{}}
  }
  update();
  return {prepare,listen,close,isOpen:()=>!root.hidden,getProgress:()=>lastProgress};
}
