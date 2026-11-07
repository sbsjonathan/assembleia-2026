'use strict';
// Parsed pages are disposable: the verified publication database remains authoritative.
// Bump this when chapter/catalog parsing changes, independently of the user's library.
const READER_CACHE_VERSION = 'layout-1';
const READER_CACHE_BYTES = 16 * 1024 * 1024;
const READER_CACHE_ENTRIES = 192;
const READER_CACHE_ITEM_BYTES = 1024 * 1024;
const readerCacheActions = new Set(['books','chapters','chapter','sections','publication-info']);
let readerCachePromise;
function readerCacheStorage() {
  if (!readerCachePromise) readerCachePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('jwpub-reader-cache', 1);
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', {keyPath:'key'});
      entries.createIndex('touched','touched');
      entries.createIndex('publication','publication');
      request.result.createObjectStore('meta', {keyPath:'key'});
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); readerCachePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cache de leitura indisponível.'));
  }).catch(error => { readerCachePromise = null; throw error; });
  return readerCachePromise;
}
function readerCacheKey(action,args) {
  if (!readerCacheActions.has(action) || !/^[a-f0-9]{24}$/.test(args.publication||'')) return null;
  if (['chapters','chapter'].includes(action) && (!Number.isInteger(Number(args.book)) || Number(args.book)<1 || Number(args.book)>200)) return null;
  if (action==='chapter' && (!Number.isInteger(Number(args.chapter)) || Number(args.chapter)<1 || Number(args.chapter)>200)) return null;
  return `${READER_CACHE_VERSION}:${args.publication}:${action}:${args.book==null?'':Number(args.book)}:${args.chapter==null?'':Number(args.chapter)}`;
}
async function hasStoredPublication(id) {
  const database = await storage();
  return new Promise((resolve,reject) => {
    const tx = database.transaction(['publications','databases']);
    const meta = tx.objectStore('publications').getKey(id);
    const data = tx.objectStore('databases').getKey(id);
    tx.oncomplete = () => resolve(meta.result===id && data.result===id);
    tx.onerror = () => reject(tx.error);
  });
}
async function readerCacheGet(key,publication) {
  if (!key) return null;
  try {
    const database = await readerCacheStorage();
    const record = await new Promise((resolve,reject) => {
      const request = database.transaction('entries').objectStore('entries').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record || record.publication!==publication || !(await hasStoredPublication(publication))) return null;
    // Touch in the same small store; no SQL database bytes are read on this path.
    const tx=database.transaction('entries','readwrite'),store=tx.objectStore('entries');
    const latest=store.get(key);
    latest.onsuccess=()=>{if(latest.result)store.put({...latest.result,touched:Date.now()});};
    tx.onerror=()=>{};
    return {value:record.value};
  } catch { return null; } // A cache failure must never prevent reading the source.
}
async function readerCachePut(key,publication,action,value) {
  if (!key) return;
  try {
    const bytes=JSON.stringify(value).length*2;
    if (bytes>READER_CACHE_ITEM_BYTES) return;
    const database=await readerCacheStorage();
    await new Promise((resolve,reject) => {
      const tx=database.transaction(['entries','meta'],'readwrite'),entries=tx.objectStore('entries'),meta=tx.objectStore('meta');
      const previous=entries.get(key),budgetRequest=meta.get('budget');
      let budget,old,seen=0;
      function insert(){
        if(++seen!==2)return;
        budget={key:'budget',bytes:Math.max(0,(budget?.bytes||0)-(old?.bytes||0))+bytes,count:(budget?.count||0)+(old?0:1)};
        entries.put({key,publication,action,value,bytes,touched:Date.now(),pinned:action!=='chapter'});
        function evict(includePinned=false){
          const cursor=entries.index('touched').openCursor();
          cursor.onsuccess=()=>{
            const row=cursor.result;
            if(budget.bytes<=READER_CACHE_BYTES && budget.count<=READER_CACHE_ENTRIES){meta.put(budget);return;}
            if(!row){if(!includePinned)evict(true);else meta.put(budget);return;}
            const item=row.value;
            if(item.key!==key && (includePinned || !item.pinned)){
              budget.bytes=Math.max(0,budget.bytes-item.bytes);budget.count=Math.max(0,budget.count-1);row.delete();
            }
            row.continue();
          };
        }
        if(budget.bytes>READER_CACHE_BYTES||budget.count>READER_CACHE_ENTRIES)evict();else meta.put(budget);
      }
      previous.onsuccess=()=>{old=previous.result;insert();};
      budgetRequest.onsuccess=()=>{budget=budgetRequest.result;insert();};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  } catch { /* Quota and private-mode restrictions only disable the acceleration. */ }
}
async function readerCacheForget(publication) {
  try {
    const database=await readerCacheStorage();
    await new Promise((resolve,reject)=>{
      const tx=database.transaction(['entries','meta'],'readwrite'),entries=tx.objectStore('entries'),meta=tx.objectStore('meta');
      const budgetRequest=meta.get('budget');
      budgetRequest.onsuccess=()=>{
        const budget=budgetRequest.result||{key:'budget',bytes:0,count:0};
        const cursor=entries.index('publication').openCursor(IDBKeyRange.only(publication));
        cursor.onsuccess=()=>{
          const row=cursor.result;
          if(!row){meta.put(budget);return;}
          budget.bytes=Math.max(0,budget.bytes-row.value.bytes);budget.count=Math.max(0,budget.count-1);row.delete();row.continue();
        };
      };
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  } catch {}
}
