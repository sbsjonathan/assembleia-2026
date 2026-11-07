'use strict';
// Native dialogs retain their focus/keyboard behavior throughout the sheet motion.
(() => {
  const records=new WeakMap();
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easing='cubic-bezier(.4,0,.2,1)';

  function stop(record,completed=false){
    ++record.epoch;clearTimeout(record.timer);
    record.animation?.cancel();record.animation=null;
    record.resizeAnimation?.cancel();record.resizeAnimation=null;
    record.dialog.classList.remove('is-opening','is-closing');
    record.closing=false;
    if(record.resolve){const resolve=record.resolve;record.resolve=null;record.promise=null;resolve(completed);}
  }

  function bind(dialog){
    if(records.has(dialog))return records.get(dialog);
    const record={dialog,epoch:0,timer:0,animation:null,resizeAnimation:null,closing:false,promise:null,resolve:null};
    records.set(dialog,record);dialog.classList.add('bible-modal-motion');
    if(typeof dialog.animate!=='function')dialog.classList.add('dialog-css-motion');
    dialog.addEventListener('cancel',event=>{event.preventDefault();close(dialog);});
    dialog.addEventListener('click',event=>{
      if(event.target!==dialog)return;
      const rect=dialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close(dialog);
    });
    dialog.addEventListener('close',()=>{
      // A close event can be queued just before the same dialog is reopened.
      if(dialog.open)return;
      stop(record,true);
      if(!document.querySelector('dialog[open]'))document.body.classList.remove('sheet-open');
    });
    return record;
  }

  function animate(record,from,to,duration,finish){
    const epoch=record.epoch;
    let finished=false;
    const done=()=>{
      if(finished||epoch!==record.epoch)return;
      finished=true;clearTimeout(record.timer);finish();
    };
    if(!duration){done();return;}
    if(typeof record.dialog.animate==='function'){
      record.animation=record.dialog.animate([from,to],{duration,easing,fill:'both'});
      record.animation.finished.then(done).catch(()=>{});
    }
    record.timer=setTimeout(done,duration+80);
  }

  function backdropOpacity(dialog,fallback){
    try{const value=Number.parseFloat(getComputedStyle(dialog,'::backdrop').opacity);return Number.isFinite(value)?value:fallback;}
    catch{return fallback;}
  }

  function show(dialog){
    const record=bind(dialog);
    if(dialog.open&&!record.closing)return;
    const reversing=dialog.open&&record.closing;
    const style=reversing?getComputedStyle(dialog):null;
    const previous=reversing?{opacity:style.opacity,transform:style.transform}:null;
    const backdrop=reversing?backdropOpacity(dialog,0):0;
    stop(record);
    document.body.classList.add('sheet-open');
    if(!dialog.open)dialog.showModal();
    const heading=dialog.querySelector('h2');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    if(reduced())return;
    const distance=Math.min(64,Math.max(24,dialog.getBoundingClientRect().height*.16));
    dialog.style.setProperty('--bible-sheet-enter-y',`${distance}px`);
    dialog.style.setProperty('--bible-backdrop-from',String(backdrop));
    dialog.classList.add('is-opening');
    animate(record,previous||{opacity:0,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'},250,()=>{
      record.animation?.cancel();record.animation=null;
      dialog.classList.remove('is-opening');
    });
  }

  function close(dialog,returnValue=''){
    const record=bind(dialog);
    if(!dialog.open)return Promise.resolve(true);
    if(record.closing)return record.promise;
    const style=getComputedStyle(dialog),from={opacity:style.opacity,transform:style.transform};
    const backdrop=backdropOpacity(dialog,1);
    const distance=Math.min(48,Math.max(20,dialog.getBoundingClientRect().height*.12));
    stop(record);record.closing=true;
    record.promise=new Promise(resolve=>{record.resolve=resolve;});
    const promise=record.promise;
    dialog.style.setProperty('--bible-sheet-exit-y',`${distance}px`);
    dialog.style.setProperty('--bible-backdrop-from',String(backdrop));
    dialog.classList.add('is-closing');
    animate(record,from,{opacity:0,transform:`translateY(${distance}px)`},reduced()?0:200,()=>{
      if(dialog.open)dialog.close(returnValue);
    });
    return promise;
  }

  function resize(dialog,update){
    const record=bind(dialog),before=dialog.open?dialog.getBoundingClientRect().height:0;
    record.resizeAnimation?.cancel();record.resizeAnimation=null;
    const result=update();
    if(!before||!dialog.open||record.closing||reduced()||typeof dialog.animate!=='function')return result;
    const after=dialog.getBoundingClientRect().height;
    if(Math.abs(after-before)<1)return result;
    const animation=dialog.animate([{height:`${before}px`},{height:`${after}px`}],{duration:200,easing});
    record.resizeAnimation=animation;
    animation.finished.then(()=>{if(record.resizeAnimation===animation)record.resizeAnimation=null;}).catch(()=>{});
    return result;
  }

  window.BibleDialogs={show,close,bind,resize,isClosing:dialog=>!!records.get(dialog)?.closing};
  document.querySelectorAll('dialog').forEach(bind);
})();
