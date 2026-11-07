/* Run with Node; only synthetic cache responses are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const scope = 'https://example.test/assembleia-2026/';
const cacheStore = new Map();
const caches = {
  async open(name) {
    if (!cacheStore.has(name)) cacheStore.set(name, new Map());
    const records = cacheStore.get(name), key = request => String(request.url || request);
    return { async match(request) { return records.get(key(request))?.clone(); },
      async put(request, response) { records.set(key(request), response.clone()); },
      async keys() { return [...records.keys()].map(url => new Request(url)); } };
  },
  async keys() { return [...cacheStore.keys()]; },
  async delete(name) { return cacheStore.delete(name); }
};
const ctx = { URL, Request, Response, Headers, Map, Set, Promise, Number, Object, Array, String,
  AbortController, setTimeout, clearTimeout, caches, console, crypto:crypto.webcrypto,
  importScripts() {}, self:{registration:{scope},addEventListener(){},SentinelaArticleRuntime:{
    CACHE_NAME:'ass26-artigos-v1', isArticle: text => text.startsWith('<!doctype html>')
  }} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8') + '\nself.testMigration=migrateAssemblyDownloads;',ctx);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const root = scope+'biblia/bundled/';
const manifestURL = root+'manifest.json';
(async () => {
  const source = await caches.open('assembleia-2026-integrado-bible-v1');
  const sibling = await caches.open('sentinela-integrado-bible-v1');
  await sibling.put(root+'foreign',new Response('untouched'));
  const good = Buffer.from('trusted Bible bytes'), bad = Buffer.from('expected second chunk');
  const media = Buffer.from('image bytes');
  const manifest={database:{chunks:[
    {path:'good.bin',bytes:good.length,sha256:digest(good)},
    {path:'bad.bin',bytes:bad.length,sha256:digest(bad)}]},
    media:[{path:'image.png',bytes:media.length,sha256:digest(media)}]};
  await source.put(manifestURL,new Response(JSON.stringify(manifest)));
  await source.put(root+'good.bin',new Response(good));
  await source.put(root+'bad.bin',new Response('corrupted'));
  await source.put(root+'image.png',new Response(media));
  const oldArticle=await caches.open('assembleia-2026-artigo-offline-v1');
  const articleURL='https://hope2.momentaneo2021.workers.dev/?semana=2026-11-07';
  await oldArticle.put(articleURL,new Response('<!doctype html><article>saved study</article>'));
  // No legacy shell exists: downloaded Bible/articles must still be found.
  assert.equal(await ctx.self.testMigration(await caches.keys()),false);
  const target=await caches.open('ass26-bible-v1');
  assert.equal(await (await target.match(root+'good.bin')).text(),good.toString());
  assert.equal(await target.match(root+'bad.bin'),undefined);
  assert.equal(await (await (await caches.open('ass26-artigos-v1')).match(articleURL)).text(),'<!doctype html><article>saved study</article>');
  assert.equal(await (await source.match(root+'bad.bin')).text(),'corrupted');
  assert.equal(await (await sibling.match(root+'foreign')).text(),'untouched');
  // A repair can retry the skipped asset; existing new downloads are preserved.
  await source.put(root+'bad.bin',new Response(bad));
  assert.equal(await ctx.self.testMigration(await caches.keys()),true);
  assert.equal(await (await target.match(root+'bad.bin')).text(),bad.toString());
  await caches.delete('ass26-bible-v1');
  assert.equal(await ctx.self.testMigration(await caches.keys()),true);
  assert.equal(cacheStore.has('ass26-bible-v1'),false,'a completed migration must not resurrect intentionally cleared downloads');
  console.log('PASS cache identity, verified downloads, damaged source, no legacy shell, original preservation and one-time migration');
})().catch(error=>{console.error(error);process.exitCode=1;});
