'use strict';
// The shipped Bible uses the same database and publication ID as an imported JWPUB.
// Only its text must finish downloading before reading; illustrations load separately.
const BUNDLED_MANIFEST_URL = new URL('bundled/manifest.json', self.location.href).href;
const BUNDLED_CHUNK_LIMIT = 8 * 1024 * 1024;
// Update with bundled/manifest.json when replacing the shipped publication.
const BUNDLED_PUBLICATION_ID = '5f4988c7fd170de4e85d3108';
let bundledManifestPromise;
const bundledMediaIndexes = new WeakMap();

async function bundledDigest(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
function bundledManifestValid(manifest) {
  const integer = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const path = (value, folder) => typeof value === 'string' && new RegExp(`^${folder}/[A-Za-z0-9_-][A-Za-z0-9_.-]*$`).test(value);
  const db = manifest?.database;
  if (manifest?.version !== 1 || typeof manifest.title !== 'string' || typeof manifest.language !== 'string' ||
      !db || db.encoding !== 'gzip' || !hash(db.sha256) || manifest.id !== db.sha256.slice(0, 24) ||
      !hash(db.packedSha256) || !integer(db.bytes, MAX_DB) || !integer(db.packedBytes, MAX_DB) ||
      !Array.isArray(db.chunks) || !db.chunks.length || db.chunks.length > 64 ||
      !Array.isArray(manifest.media) || manifest.media.length > 20000) fail('Os dados da Bíblia incluída estão incompletos.');
  const paths = new Set(), files = new Set();
  let packedBytes = 0;
  for (const chunk of db.chunks) {
    if (!path(chunk.path, 'db') || paths.has(chunk.path) || !integer(chunk.bytes, BUNDLED_CHUNK_LIMIT) || !hash(chunk.sha256)) fail('Uma parte da Bíblia incluída é inválida.');
    paths.add(chunk.path); packedBytes += chunk.bytes;
  }
  if (packedBytes !== db.packedBytes) fail('O tamanho da Bíblia incluída é inválido.');
  for (const item of manifest.media) {
    if (!item || !/^[\w.-]+\.(?:jpe?g|png|gif|webp|svg)$/i.test(item.file) || files.has(item.file) ||
        !path(item.path, 'media') || paths.has(item.path) || !['identity', 'gzip'].includes(item.encoding) ||
        !integer(item.bytes, MEDIA_IMAGE_LIMIT) || !integer(item.unpackedBytes, MEDIA_IMAGE_LIMIT) ||
        !hash(item.sha256) || !hash(item.contentSha256)) fail('O índice de imagens da Bíblia é inválido.');
    files.add(item.file); paths.add(item.path);
  }
  return manifest;
}
async function savedBundledManifest() {
  const publications = await listPublications();
  for (const meta of publications.filter(item => item.bundled && item.id === BUNDLED_PUBLICATION_ID)) {
    const stored = await getStored('databases', meta.id);
    if (stored?.bundledManifest) {
      try { return bundledManifestValid(stored.bundledManifest); } catch { /* Try another saved edition. */ }
    }
  }
  return null;
}
async function loadBundledManifest() {
  if (!bundledManifestPromise) bundledManifestPromise = (async () => {
    const saved = await savedBundledManifest();
    if (saved) return saved;
    try {
      const response = await fetch(BUNDLED_MANIFEST_URL);
      if (!response.ok) throw new Error('Manifesto indisponível.');
      const content = await response.text();
      if (content.length > 2 * 1024 * 1024) fail('O índice da Bíblia é grande demais.');
      const manifest = bundledManifestValid(JSON.parse(content));
      if (manifest.id !== BUNDLED_PUBLICATION_ID) fail('A edição incluída precisa ser atualizada. Reabra o aplicativo com internet.');
      return manifest;
    } catch (error) {
      throw new Error('Conecte o iPhone à internet para preparar a Bíblia incluída. Depois, a leitura estará disponível sem internet.');
    }
  })().catch(error => { bundledManifestPromise = null; throw error; });
  return bundledManifestPromise;
}
async function fetchBundledBytes(item, onProgress) {
  const response = await fetch(new URL(item.path, BUNDLED_MANIFEST_URL).href);
  if (!response.ok) fail('Não foi possível baixar uma parte da Bíblia. Verifique a conexão e tente novamente.');
  let bytes;
  if (response.body?.getReader) {
    bytes = new Uint8Array(item.bytes);
    const reader = response.body.getReader();
    let offset = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (offset + part.value.byteLength > bytes.byteLength) fail('Uma parte da Bíblia tem tamanho incorreto.');
        bytes.set(part.value, offset); offset += part.value.byteLength;
        onProgress?.(offset);
      }
      if (offset !== item.bytes) fail('O download da Bíblia foi interrompido. Tente novamente.');
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength);
  }
  if (bytes.byteLength !== item.bytes || await bundledDigest(bytes) !== item.sha256) fail('Uma parte da Bíblia não passou na verificação. Tente novamente.');
  return bytes;
}
async function saveBundledPublication(meta, bytes, manifest, previous) {
  const database = await storage();
  return new Promise((resolve, reject) => {
    // Leave every imported archive and all other publications untouched.
    const tx = database.transaction(['publications', 'databases'], 'readwrite');
    tx.objectStore('publications').put(meta);
    tx.objectStore('databases').put({ ...previous, id: meta.id,
      data: previous?.data || new Blob([bytes], { type: 'application/octet-stream' }), bundledManifest: manifest });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error('Não foi possível guardar a Bíblia. Verifique o espaço disponível no iPhone.'));
    tx.onabort = () => reject(new Error('A Bíblia não foi salva. Verifique o espaço disponível no iPhone e tente novamente.'));
  });
}
async function ensureBundledBible() {
  if (!crypto.subtle) fail('Abra este leitor pelo link seguro no Safari.');
  const manifest = await loadBundledManifest(), spec = manifest.database;
  let stored = await getStored('databases', manifest.id), bytes = null, reused = false, db = null;
  const oldMeta = await getStored('publications', manifest.id);
  // The old installer already verified the full hash/schema/counts before this
  // atomic record was saved. Trust that completed transaction, not a UI flag.
  if (oldMeta?.bundled && stored?.bundledManifest?.id === manifest.id &&
      stored.data instanceof Blob && stored.data.size === spec.bytes) {
    return { ...oldMeta, symbol:manifest.symbol, reused:true, textReady:true,
      counts:manifest.counts, textBytes:spec.bytes, downloadBytes:0, mediaCount:manifest.media.length };
  }
  progress('Preparando a Bíblia incluída…');
  if (stored?.data instanceof Blob && stored.data.size === spec.bytes) {
    progress('Verificando a Bíblia salva neste iPhone…');
    bytes = new Uint8Array(await stored.data.arrayBuffer());
    reused = await bundledDigest(bytes) === spec.sha256;
  }
  if (!reused) {
    stored = null;
    const packed = new Uint8Array(spec.packedBytes);
    let offset = 0, lastPercent = -1;
    for (const item of spec.chunks) {
      const part = await fetchBundledBytes(item, received => {
        const percent = Math.floor((offset + received) / spec.packedBytes * 100);
        if (percent !== lastPercent) { lastPercent = percent; progress(`Preparando a Bíblia para ler sem internet… ${percent}%`); }
      });
      packed.set(part, offset); offset += part.byteLength;
    }
    if (offset !== spec.packedBytes || await bundledDigest(packed) !== spec.packedSha256) fail('O download da Bíblia está incompleto. Tente novamente.');
    progress('Abrindo os 66 livros da Bíblia…');
    bytes = self.fflate.gunzipSync(packed, { out: new Uint8Array(spec.bytes) });
    if (bytes.byteLength !== spec.bytes || await bundledDigest(bytes) !== spec.sha256) fail('O texto da Bíblia não passou na verificação. Tente novamente.');
  }
  try {
    db = await openSql(bytes);
    const info = await validate(db);
    if (info.language !== manifest.language) fail('A edição da Bíblia incluída é inválida.');
    const counts = { books: query(db, 'SELECT COUNT(*) FROM BibleBook')[0][0], chapters: query(db, 'SELECT COUNT(*) FROM BibleChapter')[0][0], verses: query(db, 'SELECT COUNT(*) FROM BibleVerse')[0][0] };
    if (['books', 'chapters', 'verses'].some(key => counts[key] !== manifest.counts?.[key])) fail('A Bíblia incluída está incompleta.');
    const meta = { ...oldMeta, id: manifest.id, title: info.title, language: info.language, symbol: manifest.symbol, bundled: true };
    if (!reused || !oldMeta?.bundled || !stored?.bundledManifest) {
      progress('Guardando a Bíblia neste iPhone…');
      await saveBundledPublication(meta, bytes, manifest, stored);
      await readerCacheForget(meta.id);
    }
    closeCurrent();
    current = { id: meta.id, db, cipher: info.cipher, bundledManifest: manifest };
    db = null;
    progress('Bíblia pronta para ler sem internet.');
    return { ...meta, reused, textReady: true, counts, textBytes: spec.bytes, downloadBytes: reused ? 0 : spec.packedBytes, mediaCount: manifest.media.length };
  } finally { if (db) db.close(); }
}
async function bundledMediaArchive(active) {
  if (active.bundledMediaArchive !== undefined) return active.bundledMediaArchive;
  const stored = active.bundledManifest ? null : await getStored('databases', active.id);
  const manifest = active.bundledManifest || stored?.bundledManifest;
  if (!manifest || manifest.id !== active.id) { active.bundledMediaArchive = null; return null; }
  if (!bundledMediaIndexes.has(manifest)) bundledMediaIndexes.set(manifest, new Map(manifest.media.map(item => [item.file, item])));
  const index = bundledMediaIndexes.get(manifest);
  active.bundledMediaArchive = { index, async read(file, limit) {
    const item = index.get(file); if (!item) return null;
    if (item.unpackedBytes > limit) fail('A imagem é grande demais para abrir.');
    let bytes = await fetchBundledBytes(item);
    if (item.encoding === 'gzip') bytes = self.fflate.gunzipSync(bytes, { out: new Uint8Array(item.unpackedBytes) });
    if (bytes.byteLength !== item.unpackedBytes || await bundledDigest(bytes) !== item.contentSha256) fail('A imagem não passou na verificação.');
    return bytes;
  } };
  return active.bundledMediaArchive;
}
