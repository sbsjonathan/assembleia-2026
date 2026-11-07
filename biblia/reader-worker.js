importScripts('../shared/app-scope.js');
'use strict';
// JWPUB interoperability: meeting-schedules-parser (MIT), see THIRD_PARTY.md.
importScripts('vendor/fflate.js', 'chapter-layout.js', 'publication-sections.js', 'publication-media.js', 'reader-cache.js', 'bundled-bible.js');

const MAX_FILE = 250 * 1024 * 1024;
const MAX_DB = 250 * 1024 * 1024;
const MAX_INNER = 500 * 1024 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const mask = Uint8Array.from('11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7'.match(/../g), x => parseInt(x, 16));
let sqlPromise, storagePromise, current = null;
const progress = message => self.postMessage({ progress: message });
const fail = message => { throw new Error(message); };
const u32 = (view, offset) => view.getUint32(offset, true);
const u16 = (view, offset) => view.getUint16(offset, true);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function bytesAt(blob, start, length) {
  if (start < 0 || length < 0 || start + length > blob.size) fail('Arquivo JWPUB incompleto ou danificado.');
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}
async function zipIndex(blob) {
  if (!(blob instanceof Blob) || blob.size < 22) fail('O arquivo não é um JWPUB válido.');
  const tail = await bytesAt(blob, Math.max(0, blob.size - 65557), Math.min(65557, blob.size));
  const t = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let p = tail.length - 22; p >= 0; p--) {
    if (u32(t, p) === 0x06054b50 && p + 22 + u16(t, p + 20) === tail.length) { end = p; break; }
  }
  if (end < 0 || u16(t, end + 4) || u16(t, end + 6)) fail('Formato JWPUB não compatível.');
  const count = u16(t, end + 10), size = u32(t, end + 12), offset = u32(t, end + 16);
  if (!count || count === 65535 || count > 20000 || size > 16 * 1024 * 1024 || offset === 0xffffffff) fail('Arquivo JWPUB grande demais ou formato não compatível.');
  const directory = await bytesAt(blob, offset, size);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > directory.length || u32(view, p) !== 0x02014b50) fail('Índice do arquivo JWPUB danificado.');
    const flags = u16(view, p + 8), method = u16(view, p + 10);
    const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32);
    if (p + 46 + nameLen + extraLen + commentLen > directory.length) fail('Índice do arquivo JWPUB incompleto.');
    const name = textDecoder.decode(directory.subarray(p + 46, p + 46 + nameLen));
    const entry = { name, flags, method, crc: u32(view, p + 16), packed: u32(view, p + 20), size: u32(view, p + 24), offset: u32(view, p + 42) };
    if (entries.has(name)) fail('O arquivo contém entradas duplicadas.');
    entries.set(name, entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function entryBlob(archive, entry, limit) {
  if (!entry) fail('O arquivo não contém os dados necessários da publicação.');
  if (entry.flags & 1) fail('Este pacote JWPUB não é compatível.');
  if (entry.size > limit || entry.packed > MAX_INNER || entry.size === 0xffffffff) fail('O conteúdo é grande demais para este leitor.');
  const header = await bytesAt(archive, entry.offset, 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (u32(view, 0) !== 0x04034b50) fail('Estrutura do arquivo JWPUB inválida.');
  const start = entry.offset + 30 + u16(view, 26) + u16(view, 28);
  if (start + entry.packed > archive.size) fail('Arquivo JWPUB incompleto.');
  const packed = archive.slice(start, start + entry.packed);
  if (entry.method === 0) {
    if (entry.size !== entry.packed) fail('Estrutura do arquivo JWPUB inválida.');
    return packed;
  }
  if (entry.method !== 8) fail('Compactação não compatível neste JWPUB.');
  const compressed = new Uint8Array(await packed.arrayBuffer());
  const data = self.fflate.inflateSync(compressed, { out: new Uint8Array(entry.size) });
  if (data.length !== entry.size || crc32(data) !== entry.crc) fail('Arquivo JWPUB danificado.');
  return new Blob([data]);
}
async function entryBytes(archive, entry, limit) {
  const result = new Uint8Array(await (await entryBlob(archive, entry, limit)).arrayBuffer());
  if (result.length !== entry.size || crc32(result) !== entry.crc) fail('Arquivo JWPUB danificado.');
  return result;
}
function storage() {
  if (!storagePromise) storagePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('jwpub-iphone-library', 2);
    request.onupgradeneeded = () => {
      for (const name of ['publications','databases','packages']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name,{keyPath:'id'});
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento do iPhone. Use o Safari fora da navegação privada.'));
    request.onblocked = () => reject(new Error('Feche outras abas deste leitor e tente novamente.'));
  });
  return storagePromise;
}
async function getStored(store, id) {
  const database = await storage();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível ler a biblioteca salva.'));
  });
}
async function listPublications() {
  const database = await storage();
  return new Promise((resolve, reject) => {
    const request = database.transaction('publications').objectStore('publications').getAll();
    request.onsuccess = () => resolve(request.result.sort((a,b) => a.title.localeCompare(b.title)));
    request.onerror = () => reject(new Error('Não foi possível abrir a biblioteca salva.'));
  });
}
async function savePublication(meta, bytes, archive) {
  const database = await storage();
  const previous = await getStored('databases', meta.id);
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['publications', 'databases', 'packages'], 'readwrite');
    tx.objectStore('publications').put(meta);
    if (archive) tx.objectStore('packages').put({id:meta.id,data:archive});
    tx.objectStore('databases').put({ ...previous, id: meta.id, data: new Blob([bytes], { type: 'application/octet-stream' }) });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error('Não foi possível salvar a Bíblia. Verifique o espaço disponível no iPhone e tente novamente.'));
    tx.onabort = () => reject(new Error('A importação não foi salva. Verifique o espaço disponível no iPhone.'));
  });
}
async function openSql(bytes) {
  if (!sqlPromise) {
    if (typeof self.initSqlJs !== 'function') importScripts('vendor/sql-wasm.js');
    sqlPromise = self.initSqlJs({ locateFile: name => new URL('vendor/' + name, self.location.href).href }).catch(error => { sqlPromise = null; throw error; });
  }
  const SQL = await sqlPromise;
  const database = new SQL.Database(bytes);
  database.run('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
  return database;
}
function query(db, sql, values = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(values);
    const rows = [];
    while (statement.step()) rows.push(statement.get());
    return rows;
  } finally { statement.free(); }
}
async function cipher(db) {
  const row = query(db, 'SELECT MepsLanguageIndex, Symbol, Year, IssueTagNumber FROM Publication LIMIT 1')[0];
  if (!row) fail('Publicação sem identificação.');
  let card = `${row[0]}_${row[1]}_${row[2]}`;
  if (Number(row[3])) card += `_${Number(row[3])}`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(card)));
  const material = digest.map((v,i) => v ^ mask[i]);
  return { key: await crypto.subtle.importKey('raw', material.slice(0,16), { name: 'AES-CBC' }, false, ['decrypt']), iv: material.slice(16) };
}
async function decode(blob, cipherInfo) {
  if (!blob || !blob.length || blob.length % 16) fail('Texto incompatível nesta Bíblia.');
  try {
    // WebCrypto removes PKCS#7 padding after AES-CBC decryption.
    const compressed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: cipherInfo.iv }, cipherInfo.key, blob));
    return textDecoder.decode(self.fflate.unzlibSync(compressed));
  } catch { fail('Não foi possível ler o texto desta publicação.'); }
}
const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0', ndash:'–', mdash:'—', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', hellip:'…', shy:'\u00ad' };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, value) => {
    if (value[0] !== '#') return entities[value] ?? whole;
    const cp = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2),16) : Number(value.slice(1));
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
  });
}
function plain(html) {
  return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
}
function verseReference(html) {
  const match = html.match(/\bid\s*=\s*["']v(\d+)-(\d+)-(\d+)["']/i);
  return match ? match.slice(1).map(Number) : null;
}
async function validate(db) {
  const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r[0]));
  if (!['Publication','BibleBook','BibleChapter','BibleVerse'].every(t => tables.has(t))) fail('Este JWPUB não contém uma Bíblia compatível.');
  const pub = query(db, 'SELECT Title, MepsLanguageIndex FROM Publication LIMIT 1')[0];
  const first = query(db, 'SELECT FirstVerseId FROM BibleChapter ORDER BY BookNumber, ChapterNumber LIMIT 1')[0];
  if (!pub || !first) fail('Esta publicação não contém capítulos bíblicos.');
  const info = await cipher(db);
  const content = query(db, 'SELECT Content FROM BibleVerse WHERE BibleVerseId=?', [first[0]])[0];
  if (!content) fail('Texto bíblico não encontrado.');
  const html = await decode(content[0], info);
  if (!plain(html) || !verseReference(html)) fail('O texto desta Bíblia não é compatível com o leitor.');
  return { title: plain(pub[0]) || 'Bíblia', language: String(pub[1]), cipher: info };
}
function closeCurrent() {
  if (current) { current.db.close(); current = null; }
}
async function selected(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) fail('Selecione uma Bíblia.');
  if (current?.id === id) return current;
  closeCurrent();
  const stored = await getStored('databases', id);
  if (!stored) fail('Esta Bíblia não está salva. Importe o JWPUB novamente.');
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  const db = await openSql(bytes);
  try {
    const info = await cipher(db);
    current = { id, db, cipher: info, bundledManifest: stored.bundledManifest };
    return current;
  } catch (error) { db.close(); throw error; }
}
async function importFile(file) {
  if (!(file instanceof Blob) || !file.size || file.size > MAX_FILE) fail('Escolha um JWPUB de até 250 MB.');
  if (file.name && !file.name.toLowerCase().endsWith('.jwpub')) fail('Escolha um arquivo com extensão .jwpub.');
  if (!crypto.subtle) fail('Abra este leitor pelo link seguro no Safari.');
  progress('Abrindo o arquivo…');
  const outer = await zipIndex(file);
  const manifest = JSON.parse(textDecoder.decode(await entryBytes(file, outer.get('manifest.json'), 1024*1024)));
  const name = manifest?.publication?.fileName;
  if (typeof name !== 'string' || !name.endsWith('.db') || /[\\/]/.test(name)) fail('Manifesto JWPUB inválido.');
  progress('Localizando o texto da Bíblia…');
  // Stored contents can be sliced without loading hundreds of images into memory.
  const inner = await entryBlob(file, outer.get('contents'), MAX_INNER);
  const directory = await zipIndex(inner);
  closeCurrent();
  let bytes = await entryBytes(inner, directory.get(name), MAX_DB);
  progress('Preparando a leitura…');
  let db;
  try {
    db = await openSql(bytes);
    const info = await validate(db);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const id = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').slice(0,24);
    const meta = { ...await getStored('publications', id), id, title: info.title, language: info.language };
    progress('Salvando a Bíblia neste iPhone…');
    await savePublication(meta, bytes, inner);
    await readerCacheForget(id);
    bytes = null;
    current = { id, db, cipher: info.cipher };
    return meta;
  } catch (error) { if (db) db.close(); throw error; }
}
// Optional JWPUB annotations stay in the already-imported database; no migration.
function tablesOf(active) {
  if (!active.tables) active.tables = new Set(query(active.db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row[0]));
  return active.tables;
}
function noteText(html) {
  return plain(html.replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function annotationMap(active, first, last) {
  const db = active.db, tables = tablesOf(active), map = new Map();
  const add = (verse, note) => { if (!map.has(verse)) map.set(verse, []); map.get(verse).push(note); };
  if (tables.has('Footnote')) {
    for (const [id, verse] of query(db, 'SELECT FootnoteId, BibleVerseId FROM Footnote WHERE BibleVerseId BETWEEN ? AND ? ORDER BY FootnoteId', [first,last])) {
      add(verse, {id:`fn:${id}`,kind:'footnote',label:'*',title:'Nota de rodapé'});
    }
  }
  if (tables.has('VerseCommentaryMap') && tables.has('VerseCommentary')) {
    for (const [verse,id,label] of query(db, `SELECT m.BibleVerseId,c.VerseCommentaryId,c.Label FROM VerseCommentaryMap m JOIN VerseCommentary c ON c.VerseCommentaryId=m.VerseCommentaryId WHERE m.BibleVerseId BETWEEN ? AND ? ORDER BY m.VerseCommentaryMapId`, [first,last])) {
      add(verse, {id:`study:${id}`,kind:'study',label:'Estudo',title:plain(label || '') || 'Nota de estudo'});
    }
  }
  if (tables.has('BibleCitation')) {
    for (const [verse] of query(db, 'SELECT DISTINCT BibleVerseId FROM BibleCitation WHERE BibleVerseId BETWEEN ? AND ? AND FirstBibleVerseId IS NOT NULL ORDER BY BibleVerseId', [first,last])) {
      add(verse, {id:`ref:${verse}`,kind:'reference',label:'+',title:'Referências cruzadas'});
    }
  }
  return map;
}
function bibleLink(href, label) {
  const match = href.match(/^jwpub:\/\/b\/[^/]+\/(\d+):(\d+):(\d+)(?:-(\d+):(\d+):(\d+))?\/?$/i);
  if (!match) return null;
  const [book,chapter,verse] = match.slice(1,4).map(Number);
  if (book < 1 || book > 66 || chapter < 1 || chapter > 150 || verse < 0 || verse > 200) return null;
  const target = {label:label || `${book} ${chapter}:${verse}`,book,chapter,verse:Math.max(1,verse)};
  if (match[4]) {
    target.endBook=Number(match[4]); target.endChapter=Number(match[5]);target.endVerse=Number(match[6]);
  }
  return target;
}
function extractTarget(active, href) {
  if (!tablesOf(active).has('Extract')) return null;
  const link = href.replace(/^jwpub:\/\//i, '');
  if (!/^p\/[A-Za-z-]+:\d+(?:\/.*)?$/.test(link)) return null;
  let rows = query(active.db, 'SELECT ExtractId FROM Extract WHERE Link=? AND Content IS NOT NULL', [link]);
  if (!rows.length) {
    // Unqualified publication links can identify a single bundled glossary extract.
    const match = link.match(/^p\/[A-Za-z-]+:(\d+)\/?$/);
    if (match) rows = query(active.db, 'SELECT ExtractId FROM Extract WHERE RefMepsDocumentId=? AND Content IS NOT NULL LIMIT 2', [Number(match[1])]);
  }
  return rows.length === 1 ? `extract:${rows[0][0]}` : null;
}
function noteLinks(active, html) {
  const links = [], seen = new Set();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);
  for (const [,attrs,body] of anchors) {
    const attr = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!attr) continue;
    const href = plain(attr[2]), label = plain(body);
    const bible = bibleLink(href,label);
    const noteId = !bible && extractTarget(active,href);
    const link = bible || (noteId ? {label:label || 'Glossário',noteId} : documentLink(active,href,label));
    const key = JSON.stringify(link);
    if (link && !seen.has(key)) {seen.add(key);links.push(link);}
  }
  return links;
}
// Structured text keeps actual anchor placement without returning HTML to the UI.
function noteParts(active, html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const raw = [], formatting = [];
  let anchor = null;
  const append = (text, blockBreak=false) => {
    if (!text) return;
    if (anchor) anchor.text += text;
    raw.push({text,anchor,
      strong:!blockBreak && formatting.some(tag => tag==='strong' || tag==='b'),
      emphasis:!blockBreak && formatting.some(tag => tag==='em' || tag==='i')});
  };
  const finishAnchor = () => {
    if (!anchor) return;
    const label = anchor.text.trim();
    const bible = bibleLink(anchor.href,label);
    const noteId = !bible && extractTarget(active,anchor.href);
    anchor.link = bible || (noteId ? {label:label || 'Glossário',noteId} : documentLink(active,anchor.href,label));
    anchor = null;
  };
  for (const token of source.match(/<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g) || []) {
    if (!token.startsWith('<')) { append(decodeEntities(token)); continue; }
    const tag = token.match(/^<\s*(\/?)\s*([a-z][a-z\d]*)\b/i);
    if (!tag) continue;
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (['strong','b','em','i'].includes(name)) {
      if (closing) {
        const index = formatting.lastIndexOf(name);
        if (index>=0) formatting.splice(index);
      } else if (!/\/\s*>$/.test(token)) formatting.push(name);
    } else if (name==='a' && !closing) {
      finishAnchor();
      const match = token.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
      anchor = {href:match ? decodeEntities(match[2]) : '',text:''};
    } else if (name==='a' && closing) finishAnchor();
    else if (name==='br' && !closing) append('\n',true);
    else if (closing && /^(?:p|div|li|h[1-6])$/.test(name)) append('\n\n',true);
  }
  finishAnchor();
  // Normalize exactly like noteText, retaining inline semantics on every character.
  const chars = [];
  for (const part of raw) {
    for (const char of part.text) {
      if (char === '\n') {
        while (chars.length && /[ \t]/.test(chars[chars.length-1].char)) chars.pop();
        if (chars.length >= 2 && chars[chars.length-1].char === '\n' && chars[chars.length-2].char === '\n') continue;
      }
      chars.push({char,link:part.anchor?.link,strong:part.strong,emphasis:part.emphasis});
    }
  }
  let first=0,last=chars.length;
  while (first<last && /\s/u.test(chars[first].char)) first++;
  while (last>first && /\s/u.test(chars[last-1].char)) last--;
  const parts=[];
  for (let i=first;i<last;i++) {
    const {char,link,strong,emphasis}=chars[i],previous=parts[parts.length-1];
    if (previous && previous.link===link && !!previous.strong===strong && !!previous.emphasis===emphasis) previous.text+=char;
    else parts.push({text:char,...(link ? {link} : {}),...(strong ? {strong:true} : {}),...(emphasis ? {emphasis:true} : {})});
  }
  return parts;
}

async function verseTarget(active, id) {
  const row = query(active.db, 'SELECT Content FROM BibleVerse WHERE BibleVerseId=?', [id])[0];
  if (!row) return null;
  const ref = verseReference(await decode(row[0],active.cipher));
  return ref ? {book:ref[0],chapter:ref[1],verse:Math.max(1,ref[2])} : null;
}
async function referenceNote(active,id) {
  if (!tablesOf(active).has('BibleCitation')) fail('Esta edição não contém referências cruzadas.');
  const rows = query(active.db, 'SELECT FirstBibleVerseId,LastBibleVerseId FROM BibleCitation WHERE BibleVerseId=? AND FirstBibleVerseId IS NOT NULL ORDER BY BlockNumber,SortPosition,BibleCitationId', [id]);
  if (!rows.length) fail('Referências não encontradas nesta edição.');
  const names = new Map(query(active.db,'SELECT BibleBookId,COALESCE(ChapterDisplayTitle,BookDisplayTitle) FROM BibleBook').map(([n,t])=>[n,plain(t)]));
  const links = [], seen = new Set();
  for (const [first,last] of rows) {
    const key = `${first}:${last}`;
    if (seen.has(key)) continue; seen.add(key);
    const begin = await verseTarget(active,first);
    if (!begin) continue;
    const end = last != null && last !== first ? await verseTarget(active,last) : null;
    let label = `${names.get(begin.book) || begin.book} ${begin.chapter}:${begin.verse}`;
    if (end) {
      label += end.book !== begin.book ? `–${names.get(end.book) || end.book} ${end.chapter}:${end.verse}` : end.chapter !== begin.chapter ? `–${end.chapter}:${end.verse}` : `–${end.verse}`;
    }
    links.push({...begin,label,...(end ? {endBook:end.book,endChapter:end.chapter,endVerse:end.verse} : {})});
  }
  return {title:'Referências cruzadas',kind:'reference',text:'Toque em uma referência para abrir a passagem bíblica.',links};
}
async function readNote(active, value) {
  const match = typeof value === 'string' && value.match(/^(fn|study|ref|extract):(\d+)$/);
  if (!match) fail('Nota inválida.');
  const id=Number(match[2]); if (!Number.isSafeInteger(id)) fail('Nota inválida.');
  if (match[1]==='ref') return referenceNote(active,id);
  const spec = {
    fn:{table:'Footnote',key:'FootnoteId',kind:'footnote',title:'Nota de rodapé',label:'NULL'},
    study:{table:'VerseCommentary',key:'VerseCommentaryId',kind:'study',title:'Nota de estudo',label:'Label'},
    extract:{table:'Extract',key:'ExtractId',kind:'extract',title:'Glossário',label:'Caption'}
  }[match[1]];
  if (!tablesOf(active).has(spec.table)) fail('Esta edição não contém esta nota.');
  const row=query(active.db,`SELECT Content,${spec.label} FROM ${spec.table} WHERE ${spec.key}=?`,[id])[0];
  if (!row || !row[0]) fail('Nota não encontrada nesta edição.');
  const html=await decode(row[0],active.cipher);
  return {title:plain(row[1] || '') || spec.title,kind:spec.kind,text:noteText(html),parts:noteParts(active,html),links:noteLinks(active,html)};
}

function positive(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) fail(`${label} inválido.`);
  return n;
}
async function executeUncached(action, args = {}) {
  if (action === 'publications') return listPublications();
  if (action === 'ensure-bundled') return ensureBundledBible();
  if (action === 'import') return importFile(args.file);
  if (!['books','chapters','chapter','note','sections','document','media','publication-info'].includes(action)) fail('Operação não reconhecida.');
  const active = await selected(args.publication), db = active.db;
  if (action === 'publication-info') {const info=query(db,'SELECT Symbol,MepsLanguageIndex FROM Publication LIMIT 1')[0];return {symbol:info?.[0]||'',language:String(info?.[1]||'')};}
  if (action === 'note') return String(args.id).startsWith('marginal:') ? readMarginalNote(active,args.id) : readNote(active,args.id);
  if (action === 'sections') return publicationSections(active);
  if (action === 'document') return readPublicationDocument(active,args.id);
  if (action === 'media') return readPublicationMedia(active,args.file);
  if (action === 'books') return query(db, `SELECT b.BibleBookId, COALESCE(b.ChapterDisplayTitle,b.BookDisplayTitle), COUNT(c.BibleChapterId)
    FROM BibleBook b JOIN BibleChapter c ON c.BookNumber=b.BibleBookId GROUP BY b.BibleBookId ORDER BY b.BibleBookId`)
    .map(r => ({number:r[0], name:plain(r[1] || `Livro ${r[0]}`), chapters:r[2]}));
  const book = positive(args.book, 'Livro');
  if (action === 'chapters') return query(db, 'SELECT ChapterNumber FROM BibleChapter WHERE BookNumber=? ORDER BY ChapterNumber', [book]).map(r=>r[0]);
  const number = positive(args.chapter, 'Capítulo');
  const limits = query(db, 'SELECT FirstVerseId, LastVerseId FROM BibleChapter WHERE BookNumber=? AND ChapterNumber=?', [book,number])[0];
  if (!limits) fail('Capítulo não encontrado.');
  const title = query(db, 'SELECT COALESCE(ChapterDisplayTitle,BookDisplayTitle) FROM BibleBook WHERE BibleBookId=?', [book])[0];
  const notes = annotationMap(active,limits[0],limits[1]);
  const rows = query(db, 'SELECT BibleVerseId,Content FROM BibleVerse WHERE BibleVerseId BETWEEN ? AND ? ORDER BY BibleVerseId', limits);
  const verses = [];
  for (const row of rows) {
    const html = await decode(row[1], active.cipher);
    const reference = verseReference(html);
    if (!reference || reference[0] !== book || reference[1] !== number) fail('Referência bíblica incompatível nesta edição.');
    verses.push({ number:reference[2], text:plain(html), notes:notes.get(row[0]) || [] });
  }
  if (!verses.length) fail('Capítulo sem texto.');
  return { book:plain(title?.[0] || String(book)), chapter:number, verses, blocks:await chapterLayout(active,book,number) };
}
async function execute(action,args={}) {
  const key=readerCacheKey(action,args);
  const cached=await readerCacheGet(key,args.publication);
  if(cached)return cached.value;
  const result=await executeUncached(action,args);
  await readerCachePut(key,args.publication,action,result);
  return result;
}
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.then(async () => {
    try { self.postMessage({id:data.id, result:await execute(data.action, data.args)}); }
    catch (error) {
      console.error('JWPUB:', error);
      let message = error?.message || 'Não foi possível ler este arquivo.';
      if (/out of memory|memory access|abort\(|allocation/i.test(message)) message = 'O iPhone não conseguiu abrir este arquivo. Feche outras abas e tente novamente com a edição de 2015.';
      if (/unexpected token|invalid zip|invalid distance|invalid block/i.test(message)) message = 'O arquivo JWPUB está danificado ou não é compatível.';
      self.postMessage({id:data.id,error:message});
    }
  });
};
