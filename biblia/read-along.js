'use strict';
// Follow official verse timings without estimating word-level timing.
function initReadAlong({root,getCurrent,onReturn}) {
  const resume=document.createElement('button');resume.id='audio-follow';resume.type='button';resume.textContent='Acompanhar áudio';resume.hidden=true;document.body.append(resume);
  let latest=null,following=true,identity='',painted='',anchor=null,touchY=null,scrollAt=0,frame=0;
  const key=c=>c?`${c.publication||''}:${c.book}:${c.chapter}`:'';
  function sameReading(){const current=getCurrent();return latest?.active&&current.screen==='reading'&&key(current)===key(latest.context);}
  function hasNativeSelection(){const value=window.getSelection();if(!value||value.isCollapsed)return false;for(let i=0;i<value.rangeCount;i++)if(value.getRangeAt(i).intersectsNode(root))return true;return false;}
  function erase(){root.querySelectorAll('.audio-current').forEach(el=>{el.classList.remove('audio-current');el.removeAttribute('data-audio-current');});root.classList.remove('audio-following');root.removeAttribute('data-audio-verse');painted='';anchor=null;}
  function buttonState(){resume.hidden=!latest?.active||!(latest.verse>0)||!!document.querySelector('dialog[open]')||(!sameReading()&&getCurrent().screen==='empty')||(following&&sameReading());resume.textContent=sameReading()?'Acompanhar áudio':'Voltar ao áudio';}
  function inView(force=false){
    if(!anchor||!sameReading()||!following||(!force&&!latest.playing)||document.hidden||document.querySelector('dialog[open]')||root.classList.contains('has-text-selection')||hasNativeSelection())return;
    const top=(document.querySelector('.app-header')?.getBoundingClientRect().bottom||0)+24;
    const bottom=(document.querySelector('#audio-player:not([hidden])')||document.querySelector('.bottom-navbar'))?.getBoundingClientRect().top||innerHeight;
    const rect=anchor.getBoundingClientRect();
    const nodes=[...root.querySelectorAll('.audio-current')];const last=nodes.at(-1)?.getBoundingClientRect()||rect;
    if(!force&&rect.top>=top&&last.bottom<bottom-30)return;
    // A long verse is positioned at its beginning rather than repeatedly jumping.
    if(!force&&rect.top>=top&&rect.top<top+50&&last.bottom>=bottom-30)return;
    const target=Math.max(0,window.scrollY+rect.top-top-Math.min(70,Math.max(0,(bottom-top)/5)));
    if(Math.abs(target-window.scrollY)<6)return;
    scrollAt=performance.now();window.scrollTo({top:target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function paint(force=false){
    buttonState();
    if(!sameReading()||!(latest.verse>0)){erase();return;}
    const token=`${key(latest.context)}:${latest.verse}:${latest.endVerse}`;
    if(force||painted!==token){
      erase();painted=token;root.classList.add('audio-following');root.dataset.audioVerse=latest.endVerse>latest.verse?`${latest.verse}-${latest.endVerse}`:String(latest.verse);
      for(const el of root.querySelectorAll('[data-verse]')){const n=Number(el.dataset.verse);if(n>=latest.verse&&n<=latest.endVerse){el.classList.add('audio-current');el.dataset.audioCurrent='true';}}
      anchor=root.querySelector(`#verse-${latest.verse}`)||root.querySelector('.audio-current');
      inView();
    }else if(latest.playing&&performance.now()-scrollAt>800)inView();
  }
  function update(info){
    latest=info;const next=info?.active?key(info.context):'';
    if(next!==identity){identity=next;following=true;painted='';}
    if(!info?.active){erase();resume.hidden=true;return;}
    paint();
  }
  function suspend(){if(!latest?.active||!sameReading()||document.querySelector('dialog[open]'))return;following=false;buttonState();}
  root.addEventListener('touchstart',event=>{touchY=event.touches[0]?.clientY??null;},{passive:true});
  root.addEventListener('touchmove',event=>{if(touchY!=null&&Math.abs((event.touches[0]?.clientY??touchY)-touchY)>8)suspend();},{passive:true});
  root.addEventListener('touchend',()=>{touchY=null;},{passive:true});
  document.addEventListener('wheel',event=>{if(!event.target.closest?.('#audio-player,dialog'))suspend();},{passive:true});
  document.addEventListener('keydown',event=>{if(['PageDown','PageUp','ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!event.target.matches?.('input,textarea,select'))suspend();});
  // Dialogs and both native/whole-verse selections temporarily suspend movement only.
  const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;buttonState();});});
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  resume.onclick=async()=>{try{if(!latest?.active)return;const info=latest;if(!sameReading())await onReturn(info.context,info.verse);following=true;paint(true);inView(true);}catch(e){resume.textContent='Tentar acompanhar novamente';}};
  window.addEventListener('resize',()=>{if(following)inView();},{passive:true});
  document.fonts?.ready.then(()=>{if(following)inView();});
  return {update,refresh(){painted='';if(latest)paint(true);},clear(){erase();resume.hidden=true;},getState:()=>({following,verse:latest?.verse??null,endVerse:latest?.endVerse??null})};
}
