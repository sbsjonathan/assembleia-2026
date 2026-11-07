'use strict';
// Short, interruptible feedback on the selected control and the new reading pane.
(() => {
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animations=new WeakMap(),pending=new WeakMap();
  const choices='.book-tile,.chapter-tile,.section-tabs button,.section-row,.menu-row,.book-info button,.chapter-nav button,.reference-preview-open';
  let pressed=null;

  function release(){
    if(!pressed)return;
    pressed.classList.remove('bible-choice-pressed');pressed=null;
  }
  document.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const target=event.target instanceof Element?event.target.closest(choices):null;
    release();
    if(target&&!target.disabled){pressed=target;target.classList.add('bible-choice-pressed');}
  },{passive:true});
  for(const type of ['pointerup','pointercancel','dragstart'])document.addEventListener(type,release,{passive:true});
  window.addEventListener('blur',release);
  document.addEventListener('keydown',event=>{
    if(event.repeat||!['Enter',' '].includes(event.key))return;
    const target=event.target instanceof Element?event.target.closest(choices):null;
    release();
    if(target&&!target.disabled){pressed=target;target.classList.add('bible-choice-pressed');}
  });
  document.addEventListener('keyup',event=>{if(['Enter',' '].includes(event.key))release();});

  function enter(element,direction='forward',duration=250){
    if(!element)return;
    const old=pending.get(element);if(old)cancelAnimationFrame(old);pending.delete(element);
    animations.get(element)?.cancel();animations.delete(element);
    if(reduced()||typeof element.animate!=='function')return;
    const frame=requestAnimationFrame(()=>{
      pending.delete(element);
      if(!element.isConnected||element.hidden||!element.getClientRects().length)return;
      const distance=direction==='back'?-8:direction==='replace'?5:12;
      const animation=element.animate([
        {opacity:0,transform:`translateY(${distance}px)`},
        {opacity:1,transform:'translateY(0)'}
      ],{duration,easing:'cubic-bezier(.4,0,.2,1)'});
      animations.set(element,animation);
      animation.finished.then(()=>{if(animations.get(element)===animation)animations.delete(element);}).catch(()=>{});
    });
    pending.set(element,frame);
  }

  window.BibleMotion={transition:enter,content:element=>enter(element,'replace',200)};
})();
