/* Assembleia has its own release and offline stores on the shared Pages origin. */
const PREFIX = 'ass26-';
const APP_VERSION = 'ass26-2026.11.07.4';
importScripts('./sentinela/artigos/article-runtime.js?appVersion=' + APP_VERSION);
// Bump the shell version when application code changes. The large Bible cache is independent.
const SHELL_CACHE = PREFIX + 'shell-v4';
const BIBLE_CACHE = PREFIX + 'bible-v1';
const RUNTIME_CACHE = PREFIX + 'runtime-v1';
const ARTICLE_CACHE = self.SentinelaArticleRuntime.CACHE_NAME;
const OWN_CACHES = [SHELL_CACHE, BIBLE_CACHE, RUNTIME_CACHE, ARTICLE_CACHE];
const SCOPE = self.registration.scope;
const absolute = path => new URL(path, SCOPE).href;
const ASSET_URL = absolute('offline-assets.json');
const BUNDLE_URL = absolute('biblia/bundled/manifest.json');
const BUNDLE_ROOT = new URL('./', BUNDLE_URL).href;
const RECEIPT_URL = new URL('.offline-receipt-v1', BUNDLE_ROOT).href;
const VERIFIED = 'x-sentinela-sha256';
const VERIFIED_BYTES = 'x-sentinela-bytes';
let assetMemo, manifestMemo, bibleJob, fullJob, refreshJob, generation = 0;
const validResponse = r => r && r.ok && !r.redirected && r.status !== 206;
const errorMessage = e => e && e.message || 'Não foi possível preparar os arquivos offline.';
function reporter(event) {
  return payload => {
    const message = { ...payload, requestId: event.data.requestId };
    try { if (event.ports && event.ports[0]) event.ports[0].postMessage(message); } catch (_) {}
    try { if (event.source) event.source.postMessage(message); } catch (_) {}
  };
}
function releaseURL(path) {
  const url = new URL(path, SCOPE); url.searchParams.set('appVersion', APP_VERSION); return url.href;
}
async function fetchWithTimeout(url, options = {}, timeout = 20000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, {...options,signal:controller.signal}); }
  finally { clearTimeout(timer); }
}
function validateAssets(data) {
  if (data?.version !== APP_VERSION || !Array.isArray(data.shell) || !Array.isArray(data.app) || !data.shell.length || !data.revisions) throw new Error('A lista de arquivos ainda não corresponde à atualização '+APP_VERSION+'.');
  for (const path of [...data.shell,...data.app]) {
    if (typeof path !== 'string' || !absolute(path).startsWith(SCOPE) || !/^[a-f0-9]{64}$/.test(data.revisions[path]||'')) throw new Error('Arquivo de atualização sem verificação.');
  }
  return data;
}
async function readManifest(url, cacheName, refresh = false) {
  const cache = await caches.open(cacheName);
  let response = await cache.match(url);
  if (!refresh && validResponse(response)) return {cache,response,data:await response.clone().json()};
  try {
    const fresh = await fetchWithTimeout(url === ASSET_URL ? releaseURL(url) : url, {cache:'no-store'}, 15000);
    if (!validResponse(fresh)) throw new Error('Pacote offline indisponível.');
    response = fresh;
  } catch (error) { if (!validResponse(response)) throw error; }
  return {cache,response,data:await response.clone().json()};
}
async function assetManifest(refresh = false) {
  if (assetMemo && !refresh) return assetMemo;
  const {cache,response,data} = await readManifest(ASSET_URL, SHELL_CACHE, refresh);
  validateAssets(data);
  await cache.put(ASSET_URL,response); assetMemo=data; return data;
}
function parseBundle(data) {
  const chunks = data && data.database && data.database.chunks;
  if (!Array.isArray(chunks) || !chunks.length || !Array.isArray(data.media) || !data.media.length) throw new Error('Pacote da Bíblia inválido.');
  const entries = [...chunks,...data.media].map(entry => {
    const url = new URL(entry.path,BUNDLE_ROOT).href;
    if (!url.startsWith(BUNDLE_ROOT) || !Number.isSafeInteger(entry.bytes) || entry.bytes<=0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Arquivo da Bíblia inválido.');
    return {...entry,url};
  });
  if (new Set(entries.map(e=>e.url)).size !== entries.length) throw new Error('Arquivos duplicados no pacote.');
  return {...data,entries,byURL:new Map(entries.map(e=>[e.url,e]))};
}
async function bundleManifest(network = false) {
  if (manifestMemo && !network) return manifestMemo;
  const {cache,response,data} = await readManifest(BUNDLE_URL,BIBLE_CACHE,network);
  const parsed=parseBundle(data); await cache.put(BUNDLE_URL,response); manifestMemo=parsed; return parsed;
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyAndStore(cache,entry,response) {
  if (!validResponse(response)) throw new Error('Falha ao baixar '+entry.path);
  const bytes=await response.arrayBuffer();
  if (bytes.byteLength!==entry.bytes || await sha256(bytes)!==entry.sha256) throw new Error('Arquivo incompleto ou inválido: '+entry.path);
  const headers=new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  headers.set(VERIFIED,entry.sha256); headers.set(VERIFIED_BYTES,String(entry.bytes));
  const verified=new Response(bytes,{status:200,headers});
  await cache.put(entry.url,verified.clone()); return verified;
}
function verifiedHit(response,entry) {
  return validResponse(response) && response.headers.get(VERIFIED)===entry.sha256 && response.headers.get(VERIFIED_BYTES)===String(entry.bytes);
}
async function ensureBundleEntry(cache,entry,token) {
  if (token!==generation) throw new Error('Download cancelado.');
  const cached=await cache.match(entry.url);
  if (verifiedHit(cached,entry)) return;
  if (cached) { try { await verifyAndStore(cache,entry,cached); return; } catch (_) {} }
  let lastError;
  for (let attempt=0;attempt<2;attempt++) {
    if (token!==generation) throw new Error('Download cancelado.');
    try {
      const response=await fetch(entry.url,{cache:'reload'});
      if (token!==generation) throw new Error('Download cancelado.');
      await verifyAndStore(cache,entry,response); return;
    } catch (error) {lastError=error;}
  }
  throw lastError;
}
function verifiedStatic(response,path,assets) {
  return validResponse(response) && response.headers.get(VERIFIED)===assets.revisions[path];
}
async function verifyStatic(cache,path,assets,response) {
  if (!validResponse(response)) throw new Error('Arquivo indisponível: '+path);
  const bytes=await response.arrayBuffer();
  if (await sha256(bytes)!==assets.revisions[path]) throw new Error('O servidor ainda está entregando uma versão antiga ou incompleta de '+path+'.');
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
  headers.set(VERIFIED,assets.revisions[path]);headers.set(VERIFIED_BYTES,String(bytes.byteLength));headers.set('x-sentinela-app-version',APP_VERSION);
  const result=new Response(bytes,{status:200,headers});await cache.put(absolute(path),result.clone());return result;
}
async function ensureStaticFiles(paths,progress=()=>{},token=generation,refresh=false) {
  const assets=await assetManifest(),cache=await caches.open(SHELL_CACHE),failed=[],files=[...new Set(paths)];
  let loaded=0,cursor=0;
  async function worker(){
    while(cursor<files.length){
      if(token!==generation)throw new Error('Download cancelado.');
      const path=files[cursor++];
      try{
        let response=await cache.match(absolute(path));
        if(!refresh&&!verifiedStatic(response,path,assets)&&validResponse(response)){
          try{response=await verifyStatic(cache,path,assets,response);}catch(_){response=null;}
        }
        if(refresh||!verifiedStatic(response,path,assets)){
          response=await fetchWithTimeout(releaseURL(path),{cache:'no-store'});
          if(token!==generation)throw new Error('Download cancelado.');
          await verifyStatic(cache,path,assets,response);
        }
        loaded++;
      }catch(_){failed.push(path);}
      progress({loaded,total:files.length,failed:failed.length});
    }
  }
  await Promise.allSettled(Array.from({length:Math.min(4,files.length)},()=>worker()));
  if(token!==generation)throw new Error('Download cancelado.');
  if(failed.length)throw Object.assign(new Error('Alguns arquivos do aplicativo ainda não puderam ser atualizados.'),{failed});
}
async function staticComplete(paths,cache,assets) {
  const hits=await Promise.all(paths.map(path=>cache.match(absolute(path))));
  return hits.every((response,index)=>verifiedStatic(response,paths[index],assets));
}
async function migratePreviousShells(names) {
  const assets=await assetManifest(),cache=await caches.open(SHELL_CACHE);
  for(const name of names){
    const previous=await caches.open(name);
    for(const path of assets.app){
      if(validResponse(await cache.match(absolute(path))))continue;
      const old=await previous.match(absolute(path));if(!validResponse(old))continue;
      try{await verifyStatic(cache,path,assets,old.clone());}
      catch(_){/* Changed assets must be downloaded for this release, never reused blindly. */}
    }
  }
}
async function migrateAssemblyDownloads(names) {
  // Only the previous Assembly app is eligible. Sentinela's caches are untouched.
  const articles=await caches.open(ARTICLE_CACHE), receipt=absolute('.ass26-downloads-migrated-v1');
  if(validResponse(await articles.match(receipt))) return true;
  let complete=true;
  const oldBibleName='assembleia-2026-integrado-bible-v1';
  if(names.includes(oldBibleName)) {
    const previous=await caches.open(oldBibleName), next=await caches.open(BIBLE_CACHE);
    const oldManifest=await previous.match(BUNDLE_URL);
    if(validResponse(oldManifest)) {
      try {
        const currentManifest=await next.match(BUNDLE_URL);
        const manifest=parseBundle(await (validResponse(currentManifest)?currentManifest:oldManifest).clone().json());
        for(const entry of manifest.entries) {
          if(validResponse(await next.match(entry.url))) continue;
          const response=await previous.match(entry.url);
          if(validResponse(response)) {
            try { await verifyAndStore(next,entry,response); }
            catch(_) { complete=false; /* A damaged old download must not stop the new app opening. */ }
          }
        }
        if(!validResponse(currentManifest)) await next.put(BUNDLE_URL,oldManifest);
      } catch(_) { complete=false; }
    }
  }
  const oldArticles='assembleia-2026-artigo-offline-v1';
  if(names.includes(oldArticles)) {
    const previous=await caches.open(oldArticles), next=articles;
    for(const request of await previous.keys()) {
      if(validResponse(await next.match(request))) continue;
      const response=await previous.match(request);
      if(validResponse(response)&&self.SentinelaArticleRuntime.isArticle(await response.clone().text())) await next.put(request,response);
    }
  }
  // Article cache survives "clear application offline files", so old downloads
  // are not resurrected repeatedly after a successful migration.
  if(complete) await articles.put(receipt,new Response('complete'));
  return complete;
}
function refreshApp(send=()=>{}) {
  if(refreshJob){refreshJob.listeners.add(send);if(refreshJob.last)send(refreshJob.last);return refreshJob.promise;}
  const token=generation,job={listeners:new Set([send]),last:null};
  const emit=message=>{job.last=message;for(const listener of job.listeners)listener(message);};
  refreshJob=job;
  job.promise=(async()=>{
    const assets=await assetManifest();
    await ensureStaticFiles(assets.app,p=>emit({type:'APP_REFRESH_PROGRESS',version:APP_VERSION,...p}),token);
    emit({type:'APP_REFRESH_COMPLETE',version:APP_VERSION,complete:true});
  })().catch(error=>{emit({type:'APP_REFRESH_ERROR',version:APP_VERSION,message:errorMessage(error),failed:error.failed||[]});throw error;})
  .finally(()=>{if(refreshJob===job)refreshJob=null;});return job.promise;
}

function prepareBible(send) {
  if (bibleJob) {bibleJob.listeners.add(send);if(bibleJob.last)send(bibleJob.last);return bibleJob.promise;}
  const job={listeners:new Set([send]),last:null},token=generation;
  const emit=payload=>{job.last=payload;for(const listener of job.listeners)listener(payload);};
  bibleJob=job;
  job.promise=(async()=>{
    const assets=await assetManifest(); await ensureStaticFiles(assets.shell,()=>{},token);
    // A missing auxiliary page must not label already saved Bible text as unsaved.
    try { await ensureStaticFiles(assets.app,()=>{},token); } catch(error) { if(token!==generation)throw error; }
    const manifest=await bundleManifest(),cache=await caches.open(BIBLE_CACHE),failed=[];
    let loaded=0,bytesLoaded=0,cursor=0;
    const total=manifest.entries.length,bytesTotal=manifest.entries.reduce((n,e)=>n+e.bytes,0);
    emit({type:'BIBLE_OFFLINE_PROGRESS',loaded,total,bytesLoaded,bytesTotal});
    async function worker(){
      while(cursor<total){
        const entry=manifest.entries[cursor++];
        try{await ensureBundleEntry(cache,entry,token);loaded++;bytesLoaded+=entry.bytes;}
        catch(error){if(token!==generation)throw error;failed.push(entry.path);}
        emit({type:'BIBLE_OFFLINE_PROGRESS',loaded,total,bytesLoaded,bytesTotal,failed:failed.length});
      }
    }
    // Two requests bound digest memory while downloading 8 MiB database parts on iPhone.
    await Promise.allSettled([worker(),worker()]);
    if(token!==generation)throw new Error('Download cancelado.');
    if(failed.length)throw Object.assign(new Error('Download incompleto. Conecte-se e tente novamente para continuar de onde parou.'),{failed});
    if(!(await getCacheStatus()).bibleComplete)throw new Error('Não foi possível confirmar todos os arquivos da Bíblia.');
    const result={type:'BIBLE_OFFLINE_COMPLETE',complete:true,loaded,total,bytesLoaded,bytesTotal};emit(result);return result;
  })().catch(error=>{emit({type:'BIBLE_OFFLINE_ERROR',complete:false,message:errorMessage(error),failed:error.failed||[]});throw error;})
  .finally(()=>{if(bibleJob===job)bibleJob=null;});
  return job.promise;
}

async function manifestFingerprint(manifest) {
  return sha256(new TextEncoder().encode(manifest.entries.map(entry=>`${entry.url}|${entry.bytes}|${entry.sha256}`).join('\n')));
}
async function getCacheStatus({fast=false}={}){
  const names=await caches.keys(),hasCache=OWN_CACHES.some(name=>names.includes(name));
  const shellCache=await caches.open(SHELL_CACHE),bibleCache=await caches.open(BIBLE_CACHE);
  let assets,shellComplete=false,appComplete=false,loaded=0,total=0,bytesLoaded=0,bytesTotal=0;
  try{const response=await shellCache.match(ASSET_URL);assets=response&&await response.json();}catch(_){}
  if(assets?.version===APP_VERSION&&Array.isArray(assets.app)&&Array.isArray(assets.shell)&&assets.revisions){
    shellComplete=await staticComplete(assets.shell,shellCache,assets);
    appComplete=await staticComplete(assets.app,shellCache,assets);
  }
  try{
    const response=await bibleCache.match(BUNDLE_URL),manifest=response&&parseBundle(await response.json());
    if(manifest){
      total=manifest.entries.length;
      const fingerprint=await manifestFingerprint(manifest);
      let receipt;
      if(fast){try{const saved=await bibleCache.match(RECEIPT_URL);receipt=saved&&await saved.json();}catch(_){}}
      // The receipt is written only after inspecting verified headers for every file.
      // Cache.keys detects eviction or removal without reopening 731 response bodies.
      const trusted=fast&&receipt?.version===1&&receipt.fingerprint===fingerprint;
      const keys=trusted?new Set((await bibleCache.keys()).map(request=>request.url)):null;
      for(const entry of manifest.entries){
        bytesTotal+=entry.bytes;
        if(trusted?keys.has(entry.url):verifiedHit(await bibleCache.match(entry.url),entry)){loaded++;bytesLoaded+=entry.bytes;}
      }
      if(loaded===total&&!trusted)await bibleCache.put(RECEIPT_URL,new Response(JSON.stringify({version:1,fingerprint}),{headers:{'Content-Type':'application/json'}}));
    }
  }catch(_){}
  const bibleComplete=shellComplete&&total>0&&loaded===total;
  return {version:APP_VERSION,hasCache,complete:appComplete&&bibleComplete,appComplete,shellComplete,bibleComplete,loaded,total,bytesLoaded,bytesTotal};
}
function downloadApp(send){
  if(fullJob){fullJob.listeners.add(send);if(fullJob.last)send(fullJob.last);return fullJob.promise;}
  const job={listeners:new Set([send]),last:null},token=generation;
  const emit=payload=>{job.last=payload;for(const listener of job.listeners)listener(payload);};fullJob=job;
  job.promise=(async()=>{
    const assets=await assetManifest(true),manifest=await bundleManifest(true),total=assets.app.length+manifest.entries.length;
    await ensureStaticFiles(assets.app,p=>emit({type:'DOWNLOAD_PROGRESS',loaded:p.loaded,total,phase:'app'}),token);
    await prepareBible(p=>{if(p.type==='BIBLE_OFFLINE_PROGRESS')emit({...p,type:'DOWNLOAD_PROGRESS',loaded:assets.app.length+p.loaded,total,phase:'bible'});});
    if(token!==generation||!(await getCacheStatus()).complete)throw new Error('O aplicativo ainda não está completo para uso offline.');
    emit({type:'DOWNLOAD_COMPLETE',complete:true});
  })().catch(error=>{emit({type:'DOWNLOAD_ERROR',complete:false,message:errorMessage(error),failed:error.failed||[]});throw error;})
  .finally(()=>{if(fullJob===job)fullJob=null;});return job.promise;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const assets=await assetManifest(true);
  // Only the verified reading/application core can block activation. Auxiliary
  // pages refresh afterwards; one old image or editor asset cannot freeze updates.
  await ensureStaticFiles(assets.shell,()=>{},generation,true);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  const oldShells=names.filter(name=>name.startsWith(PREFIX+'shell-')&&name!==SHELL_CACHE);
  const legacyShells=names.filter(name=>/^assembleia-2026-integrado-shell-v\d+$/.test(name));
  const upgrading=oldShells.length>0||legacyShells.length>0;
  await migratePreviousShells([...oldShells,...legacyShells]);
  let downloadsMigrated=true;
  try { downloadsMigrated=await migrateAssemblyDownloads(names); }
  catch(_) { downloadsMigrated=false; /* Keep the legacy caches for a retry; the verified new UI can still open. */ }
  // Bible, article caches, personal data and unrelated applications survive.
  for(const name of names)if(name.startsWith(PREFIX)&&!OWN_CACHES.includes(name))await caches.delete(name);
  // Leaving the old personal stores intact does not require retaining their old UI.
  if(downloadsMigrated) for(const name of legacyShells) await caches.delete(name);
  await self.clients.claim();
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const rootPath=new URL(SCOPE).pathname,indexPath=new URL('index.html',SCOPE).pathname;
  for(const client of clients){
    if(!client.url.startsWith(SCOPE))continue;
    client.postMessage({type:'APP_VERSION',version:APP_VERSION,shell:SHELL_CACHE,ready:true,installedVersion:APP_VERSION});
    if(!upgrading)continue;
    const url=new URL(client.url);
    if(![rootPath,indexPath].includes(url.pathname)||url.searchParams.get('atualizado')===APP_VERSION)continue;
    url.searchParams.set('atualizado',APP_VERSION);
    // Awaiting navigation here deadlocks its fetch against worker activation.
    client.navigate(url.href).catch(()=>{});
  }
})()));
async function appVersion() {
  let ready=false;
  try{const assets=await assetManifest(),cache=await caches.open(SHELL_CACHE);ready=await staticComplete(assets.shell,cache,assets);}catch(_){}
  return {type:'APP_VERSION',version:APP_VERSION,shell:SHELL_CACHE,ready,installedVersion:ready?APP_VERSION:null};
}
self.addEventListener('message',event=>{
  if(!event.data||!event.data.action)return;
  const send=reporter(event),action=event.data.action;
  if(action==='GET_APP_VERSION')event.waitUntil(appVersion().then(send));
  else if(action==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
  else if(action==='REFRESH_APP')event.waitUntil(refreshApp(send).catch(()=>{}));
  else if(action==='PREPARE_BIBLE_OFFLINE')event.waitUntil(prepareBible(send).catch(()=>{}));
  else if(action==='START_DOWNLOAD')event.waitUntil(downloadApp(send).catch(()=>{}));
  else if(action==='CACHE_STATUS')event.waitUntil(getCacheStatus({fast:event.data.fast===true}).then(status=>send({type:'CACHE_STATUS',...status})).catch(error=>send({type:'CACHE_STATUS',complete:false,bibleComplete:false,message:errorMessage(error)})));
  else if(action==='CLEAR_CACHE')event.waitUntil((async()=>{
    generation++;await Promise.allSettled([bibleJob&&bibleJob.promise,fullJob&&fullJob.promise,refreshJob&&refreshJob.promise].filter(Boolean));
    for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==ARTICLE_CACHE)await caches.delete(name);
    assetMemo=undefined;manifestMemo=undefined;send({type:'CACHE_CLEARED'});
  })());
});
async function serveBundle(request){
  const url=new URL(request.url);url.search='';const cache=await caches.open(BIBLE_CACHE);
  if(url.href===BUNDLE_URL){const saved=await cache.match(BUNDLE_URL);if(validResponse(saved))return saved;try{await bundleManifest();}catch(_){}return await cache.match(BUNDLE_URL)||new Response('Bíblia indisponível offline.',{status:503});}
  let manifest;try{manifest=await bundleManifest();}catch(_){}
  const entry=manifest&&manifest.byURL.get(url.href),cached=await cache.match(url.href);
  if(entry&&verifiedHit(cached,entry))return cached;
  try{const response=await fetch(request);return entry?await verifyAndStore(cache,entry,response):response;}
  catch(_){return new Response('Este arquivo ainda não está disponível offline.',{status:503});}
}
async function serveRecovery(request) {
  const cache=await caches.open(SHELL_CACHE),url=absolute('atualizar.html');
  try{
    const response=await fetchWithTimeout(request.url,{cache:'no-store'});
    if(!validResponse(response))throw new Error('Atualização indisponível.');
    return response;
  }catch(error){const saved=await cache.match(url);if(saved)return saved;throw error;}
}
function isStudyURL(value) {
  try {
    const url = new URL(value);
    return url.origin === self.location.origin && url.pathname === new URL('sentinela/artigos/estudo.html', SCOPE).pathname;
  } catch (_) { return false; }
}
async function downloadedStudy(request) {
  try {
    const runtime = self.SentinelaArticleRuntime, date = runtime.resolveDate(request.url);
    const cache = await caches.open(runtime.CACHE_NAME), response = await cache.match(runtime.cacheKey(date));
    if (!validResponse(response)) return null;
    const html = await response.text();
    if (!runtime.isArticle(html)) return null;
    return new Response(runtime.prepareHTML(html, {date, rootURL:SCOPE}), {headers:{
      'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
      'X-Sentinela-Article-Cache':'hit', 'X-Sentinela-App-Version':APP_VERSION
    }});
  } catch (_) { return null; }
}
async function isStudyAsset(event) {
  if (!['style','script','image','font'].includes(event.request.destination)) return false;
  if (isStudyURL(event.request.referrer)) return true;
  if (!event.clientId) return false;
  try { return isStudyURL((await self.clients.get(event.clientId))?.url); }
  catch (_) { return false; }
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||!url.protocol.startsWith('http')||request.headers.has('range'))return;
  if(url.hostname.endsWith('supabase.co')||url.hostname.endsWith('workers.dev'))return;
  // Do not cache streamed audio/video. Packaged illustrations are handled below.
  if(/\.(?:mp3|mp4|m4a|m3u8)$/i.test(url.pathname))return;
  if(url.origin===self.location.origin&&url.pathname===new URL('atualizar.html',SCOPE).pathname){event.respondWith(serveRecovery(request));return;}
  if(url.href.startsWith(BUNDLE_ROOT)){event.respondWith(serveBundle(request));return;}
  event.respondWith((async()=>{
    // A saved article is the navigation response itself: never display the
    // loading page or contact the publication proxy just to reopen a download.
    if(request.mode==='navigate'&&isStudyURL(request.url)){
      const article=await downloadedStudy(request);if(article)return article;
    }
    const local=url.href.startsWith(SCOPE),canonical=new URL(url.href);canonical.search='';
    if(local&&canonical.pathname.endsWith('/'))canonical.pathname+='index.html';
    const fallback=async()=>{
      const shell=await caches.open(SHELL_CACHE),runtime=await caches.open(RUNTIME_CACHE);
      if(local)return await shell.match(canonical.href)||await shell.match(request)||await runtime.match(request)||await runtime.match(canonical.href);
      return await runtime.match(request);
    };
    // Static application files are immutable for this shell version. Read locally
    // first, even when the network is connected but slow or unresponsive.
    const forceNetwork=request.cache==='reload'||request.cache==='no-store';
    if(local&&!forceNetwork){const cached=await(await caches.open(SHELL_CACHE)).match(canonical.href);if(validResponse(cached))return cached;}
    try{
      let assets=assetMemo;try{if(local&&!assets)assets=await assetManifest();}catch(_){}
      const path=local?decodeURIComponent(canonical.pathname.slice(new URL(SCOPE).pathname.length)):null;
      const known=assets&&path&&assets.revisions[path];
      // Reader styles, fonts, illustrations and CDN scripts must not wait for a
      // slow connection when already downloaded. Keep app-version integrity for
      // local code; unrelated pages retain their existing runtime strategy.
      if(!forceNetwork&&await isStudyAsset(event)){
        const saved=await(await caches.open(RUNTIME_CACHE)).match(request)||await(await caches.open(self.SentinelaArticleRuntime.CACHE_NAME)).match(request);
        if(saved){
          if(!known&&(saved.ok||saved.type==='opaque'))return saved;
          if(known){try{return await verifyStatic(await caches.open(SHELL_CACHE),path,assets,saved.clone());}catch(_){}}
        }
      }
      const response=known?await fetchWithTimeout(releaseURL(path),{cache:'no-store'}):await fetch(request);
      if(!response.ok&&response.type!=='opaque')return await fallback()||response;
      if(known)return await verifyStatic(await caches.open(SHELL_CACHE),path,assets,response);
      if(!response.redirected&&response.status!==206){
        try{await(await caches.open(RUNTIME_CACHE)).put(request,response.clone());}catch(_){}
      }
      return response;
    }catch(_){return await fallback()||new Response('Conecte-se para carregar este conteúdo.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  })());
});
