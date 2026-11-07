importScripts('../shared/app-scope.js');
'use strict';
importScripts('vendor/fflate.js','search-core.js');
// Bump with corpus extraction/token semantics; never reuse an old derived index.
const SEARCH_SCHEMA=1;
const SEARCH_BUILTIN='5f4988c7fd170de4e85d3108';
let searchStoragePromise,searchIndexPromise,searchPublication,searchReaderLoaded=false;
let searchBuildQueue=Promise.resolve();
function searchStorage(){
  if(!searchStoragePromise)searchStoragePromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('sentinela-search-index',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('corpora',{keyPath:'key'}).createIndex('created','created');
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();searchStoragePromise=null;};resolve(request.result);};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Índice temporariamente indisponível.'));
  }).catch(error=>{searchStoragePromise=null;throw error;});
  return searchStoragePromise;
}
async function searchCached(publication){
  try{const database=await searchStorage();return await new Promise((resolve,reject)=>{
    const request=database.transaction('corpora').objectStore('corpora').get(`${SEARCH_SCHEMA}:${publication}`);
    request.onsuccess=()=>resolve(request.result?.records||null);request.onerror=()=>reject(request.error);
  });}catch{return null;}
}
async function searchSave(publication,records){
  try{const database=await searchStorage();await new Promise((resolve,reject)=>{
    const tx=database.transaction('corpora','readwrite'),store=tx.objectStore('corpora'),key=`${SEARCH_SCHEMA}:${publication}`;
    store.put({key,publication,schema:SEARCH_SCHEMA,records,created:Date.now()});
    const count=store.count();
    count.onsuccess=()=>{
      let remaining=count.result;if(remaining<=3)return;
      // Retain at most three editions. Keys-only eviction avoids loading large corpora.
      const cursor=(store.indexNames.contains('created')?store.index('created'):store).openKeyCursor();
      cursor.onsuccess=()=>{const row=cursor.result;if(!row||remaining<=3)return;if(row.primaryKey!==key){store.delete(row.primaryKey);remaining--;}row.continue();};
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}catch{/* Derived search data is disposable; storage failure cannot block a search. */}
}
async function searchLoad(publication,notify){
  if(typeof publication!=='string'||!/^[a-f0-9]{24}$/.test(publication))throw new Error('Selecione uma Bíblia para pesquisar.');
  let records=await searchCached(publication);
  if(!records){
    if(publication===SEARCH_BUILTIN){
      notify('Preparando a busca na Bíblia e nos textos de estudo…');
      let response;
      try{response=await fetch('search/builtin.json.gz');}catch{throw new Error('O índice de busca ainda não está salvo. Conecte-se uma vez para preparar a pesquisa offline.');}
      if(!response.ok)throw new Error('Não foi possível carregar o índice de busca. Tente novamente com internet.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      const data=JSON.parse(new TextDecoder().decode(bytes[0]===31&&bytes[1]===139?self.fflate.gunzipSync(bytes):bytes));
      if(data.schema!==SEARCH_SCHEMA||data.publication!==publication||!Array.isArray(data.records))throw new Error('O índice não corresponde a esta Bíblia. Atualize o aplicativo.');
      records=data.records;
    }else{
      notify('Preparando o índice desta Bíblia importada. Isso é feito uma vez…');
      if(!searchReaderLoaded){
        const handler=self.onmessage;
        try{importScripts('reader-worker.js','search-extract.js');searchReaderLoaded=true;}finally{self.onmessage=handler;}
      }
      records=await self.buildImportedSearchCorpus(publication,notify);
    }
    await searchSave(publication,records);
  }
  notify('Organizando o índice de pesquisa…');
  return SentinelaSearchCore.createIndex(records,percent=>notify(`Organizando o índice: ${percent}%`));
}
async function searchGetIndex(publication,notify){
  if(searchPublication!==publication||!searchIndexPromise){
    searchPublication=publication;
    const promise=searchBuildQueue.then(()=>searchLoad(publication,notify));
    searchBuildQueue=promise.catch(()=>{});
    searchIndexPromise=promise;
    promise.catch(()=>{if(searchIndexPromise===promise)searchIndexPromise=null;});
  }
  return searchIndexPromise;
}
self.onmessage=async({data})=>{
  const id=data?.id;
  try{
    if(data?.action!=='search')throw new Error('Operação de busca não reconhecida.');
    const args=data.args||{},index=await searchGetIndex(args.publication,message=>self.postMessage({id,progress:message}));
    self.postMessage({id,result:SentinelaSearchCore.search(index,args)});
  }catch(error){self.postMessage({id,error:error?.message||'Não foi possível pesquisar. Tente novamente.'});}
};
