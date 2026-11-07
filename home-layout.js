'use strict';
// Opt-in measurements run in the installed app, without sending local data anywhere.
(() => {
  if (!new URLSearchParams(location.search).has('diagnostico')) return;
  const settle = () => new Promise(resolve => setTimeout(resolve, 350));
  async function settleInitialLayout() {
    const animations = document.querySelector('.dock')?.getAnimations?.() || [];
    // Only the finite entrance animation affects the card's measured position.
    await Promise.all(animations.filter(animation => animation.animationName === 'dockUp')
      .map(animation => animation.finished.catch(() => {})));
    await settle();
  }
  const viewport = document.querySelector('meta[name="viewport"]');
  const originalViewport = viewport?.content;
  const originalStyle = Object.fromEntries(['position','inset','height'].map(name => [name,{value:document.body.style.getPropertyValue(name),priority:document.body.style.getPropertyPriority(name)}]));
  const rectangle = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect(), s = getComputedStyle(element);
    return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,position:s.position,
      paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,transform:s.transform,overflow:s.overflow};
  };
  function probeHeight(value, edges = false) {
    const element = document.createElement('div');
    element.style.cssText = 'position:fixed;left:0;width:1px;visibility:hidden;pointer-events:none;';
    if (edges) element.style.cssText += 'top:0;bottom:0;height:auto;';
    else element.style.height = value;
    document.body.append(element);
    const height = element.getBoundingClientRect().height;
    element.remove(); return height;
  }
  function sample(name) {
    const visual = window.visualViewport;
    return {name,viewportMeta:viewport?.content,
      statusBarStyle:document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      innerHeight,innerWidth,outerHeight,outerWidth,
      screen:{height:screen.height,width:screen.width,availHeight:screen.availHeight,availWidth:screen.availWidth,orientation:screen.orientation?.type},
      visualViewport:visual?{height:visual.height,width:visual.width,offsetTop:visual.offsetTop,offsetLeft:visual.offsetLeft,scale:visual.scale}:null,
      clientHeight:document.documentElement.clientHeight,scrollHeight:document.documentElement.scrollHeight,
      safeTop:probeHeight('env(safe-area-inset-top, 0px)'),safeBottom:probeHeight('env(safe-area-inset-bottom, 0px)'),
      units:{vh:probeHeight('100vh'),svh:probeHeight('100svh'),lvh:probeHeight('100lvh'),dvh:probeHeight('100dvh'),fixed:probeHeight('',true),
        home:probeHeight('min(100vh, calc(100dvh + env(safe-area-inset-top, 0px)))')},
      body:rectangle('body'),nav:rectangle('.bottom-navbar'),dock:rectangle('.dock'),status:rectangle('.home-statusbar')};
  }
  function restore() {
    if (viewport && originalViewport != null) viewport.content = originalViewport;
    for (const [name,old] of Object.entries(originalStyle)) {
      if (old.value) document.body.style.setProperty(name,old.value,old.priority);
      else document.body.style.removeProperty(name);
    }
  }
  async function diagnose() {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','layout-title');
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:calc(100% - 32px);max-width:520px;max-height:80%;overflow:auto;border:0;border-radius:18px;padding:22px;background:#fff;color:#222;font:15px/1.5 system-ui;';
    const heading = document.createElement('h2');heading.id='layout-title';heading.textContent='Medir a tela do iPhone';heading.style.fontSize='20px';
    const message = document.createElement('p');message.textContent='Conferindo a área disponível no aplicativo…';
    dialog.append(heading,message);document.body.append(dialog);dialog.showModal();
    const report = {version:document.querySelector('meta[name="app-version"]')?.content,
      standalone:navigator.standalone===true||matchMedia('(display-mode: standalone)').matches,
      platform:navigator.platform,userAgent:navigator.userAgent,devicePixelRatio,samples:[]};
    try {
      await settleInitialLayout(); report.samples.push(sample('atual'));
      document.body.style.setProperty('position','relative','important');
      document.body.style.setProperty('inset','auto','important');
      document.body.style.setProperty('height','100vh','important');
      await settle();report.samples.push(sample('fluxo-100vh'));
      document.body.style.setProperty('height',screen.height+'px','important');
      await settle();report.samples.push(sample('fluxo-screen'));
      restore();
      if (viewport && originalViewport) {
        viewport.content=originalViewport.replace(/viewport-fit\s*=\s*cover/i,'viewport-fit=contain');
        await settle();report.samples.push(sample('viewport-contain'));
        viewport.content=originalViewport.replace(/,?\s*viewport-fit\s*=\s*cover/i,'');
        await settle();report.samples.push(sample('viewport-auto'));
      }
    } catch (error) {report.error=String(error.message||error);}
    finally {restore();}
    const output = JSON.stringify(report,null,2);
    message.textContent=report.standalone
      ? 'Medição concluída. Copie o diagnóstico e cole na conversa para analisar a faixa com os dados do seu iPhone.'
      : 'Esta medição foi aberta no navegador. Para medir o aplicativo instalado, abra-o pela Tela de Início e vá a Salvar → Diagnóstico da tela inicial.';
    const copy = document.createElement('button');copy.type='button';copy.textContent='Copiar diagnóstico';
    copy.style.cssText='display:block;width:100%;min-height:46px;margin:18px 0 12px;border:0;border-radius:10px;background:#5d4284;color:#fff;font:600 16px system-ui;';
    const details = document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('textarea');
    summary.textContent='Ver os dados medidos';text.readOnly=true;text.value=output;
    text.style.cssText='width:100%;height:170px;font:11px/1.4 monospace;margin-top:10px;color:#222;background:#f4f4f4;';
    details.append(summary,text);
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(output);copy.textContent='Copiado — cole na conversa';}catch(_){details.open=true;text.select();if(document.execCommand('copy'))copy.textContent='Copiado — cole na conversa';}};
    const close=document.createElement('button');close.type='button';close.textContent='Fechar';close.style.cssText='min-height:44px;background:none;border:0;color:#5d4284;font:16px system-ui;';
    close.onclick=()=>{dialog.close();dialog.remove();const url=new URL(location.href);url.searchParams.delete('diagnostico');history.replaceState(null,'',url);};
    dialog.append(copy,details,close);
  }
  if(document.readyState==='complete')diagnose();else addEventListener('load',diagnose,{once:true});
})();
