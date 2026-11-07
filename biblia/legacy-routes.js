// URLs shared by legacy Bible pages and scripture previews in A Sentinela.
const bookSlugs = ["genesis", "exodo", "levitico", "numeros", "deuteronomio", "josue", "juizes", "rute", "1samuel", "2samuel", "1reis", "2reis", "1cronicas", "2cronicas", "esdras", "neemias", "ester", "jo", "salmos", "proverbios", "eclesiastes", "canticos", "isaias", "jeremias", "lamentacoes", "ezequiel", "daniel", "oseias", "joel", "amos", "obadias", "jonas", "miqueias", "naum", "habacuque", "sofonias", "ageu", "zacarias", "malaquias", "mateus", "marcos", "lucas", "joao", "atos", "romanos", "1corintios", "2corintios", "galatas", "efesios", "filipenses", "colossenses", "1tessalonicenses", "2tessalonicenses", "1timoteo", "2timoteo", "tito", "filemon", "hebreus", "tiago", "1pedro", "2pedro", "1joao", "2joao", "3joao", "judas", "apocalipse"];
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\s_-]/g, '');
const aliases = {filemom:'filemon', filemon:'filemon', filem:'filemon', cantico:'canticos', canticodesalomao:'canticos', canticodoscanticos:'canticos', deut:'deuteronomio', salmo:'salmos', sal:'salmos'};
const chapterCounts = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];

export function bibleBookNumber(value, abbreviations = {}) {
  const raw = String(value || '').trim().replace(/^\d{1,2}-/, '');
  const key = normalize(raw);
  const abbreviation = Object.entries(abbreviations).find(([name]) => normalize(name) === key)?.[1];
  const slug = normalize(abbreviation || raw);
  return bookSlugs.indexOf(aliases[slug] || slug) + 1;
}

// A chapter reference has no verse target. Keep that distinction all the way
// from the article preview to the reader instead of inventing verse 1.
export function parseBibleReference(reference, abbreviations = {}) {
  const text = String(reference || '').trim().replace(/^[([]\s*/, '').replace(/\s*[)\]]$/, '');
  const match = text.match(/^(.+?)\s*(\d{1,3})(.*)$/u);
  if (!match) return null;
  const book = bibleBookNumber(match[1], abbreviations), suffix = match[3].trim();
  if (!book) return null;
  // In single-chapter books, “Filêmon 12, 13” and “Judas 5” name verses.
  const singleChapterVerses = chapterCounts[book - 1] === 1 && !suffix.startsWith(':');
  const chapter = singleChapterVerses ? 1 : Number(match[2]);
  if (chapter < 1 || chapter > chapterCounts[book - 1] || !singleChapterVerses && suffix && !suffix.startsWith(':')) return null;
  const verseSpec = singleChapterVerses ? match[2] + suffix : suffix.slice(1).trim();
  if (suffix.startsWith(':') && !verseSpec) return null;
  const base = {book, slug:bookSlugs[book - 1], chapter, chapterOnly:!singleChapterVerses && !suffix, ranges:[], verseSpec};
  if (base.chapterOnly) return base;
  for (const item of base.verseSpec.split(',')) {
    const range = item.trim().match(/^(\d{1,3})(?:\s*[-–—]\s*(?:(\d{1,3})\s*:\s*)?(\d{1,3}))?$/u);
    if (!range) return null;
    const verse = Number(range[1]), endChapter = range[2] == null ? chapter : Number(range[2]), endVerse = range[3] == null ? verse : Number(range[3]);
    if (verse < 1 || verse > 176 || endVerse < 1 || endVerse > 176 || endChapter < chapter || endChapter > chapterCounts[book - 1] || endChapter === chapter && endVerse < verse) return null;
    base.ranges.push({chapter, verse, endChapter, endVerse});
  }
  return base.ranges.length ? base : null;
}

export function parseBibleReferences(reference, abbreviations = {}) {
  const parts = String(reference || '').split(';').map(part => part.trim());
  if (!parts.length || parts.some(part => !part)) return [];
  const references = [];
  for (let part of parts) {
    if (references.length && /^\d{1,3}\s*(?::|$)/.test(part)) part = `${references.at(-1).slug} ${part}`;
    const parsed = parseBibleReference(part, abbreviations);
    if (!parsed) return [];
    references.push(parsed);
  }
  return references;
}

export function bibleChapterURL(book, chapter, verse, endVerse = null, endChapter = null) {
  const url = new URL('biblia.html', import.meta.url);
  const number = Number(book);
  if (Number.isInteger(number) && number >= 1 && number <= 66) url.searchParams.set('book', number);
  if (Number.isInteger(Number(chapter)) && Number(chapter) >= 1 && Number(chapter) <= 150) url.searchParams.set('chapter', Number(chapter));
  if (Number.isInteger(Number(verse)) && Number(verse) >= 1 && Number(verse) <= 176) url.searchParams.set('verse', Number(verse));
  const lastChapter = Number(endChapter) || Number(chapter), lastVerse = Number(endVerse);
  if (url.searchParams.has('verse') && Number.isInteger(lastChapter) && lastChapter >= Number(chapter) && lastChapter <= 150 &&
      Number.isInteger(lastVerse) && lastVerse >= 1 && lastVerse <= 176 && (lastChapter > Number(chapter) || lastVerse >= Number(verse))) {
    url.searchParams.set('endVerse', lastVerse);
    if (lastChapter !== Number(chapter)) url.searchParams.set('endChapter', lastChapter);
  }
  return url;
}

export function legacyChapterURL(search) {
  const params = new URLSearchParams(search);
  const book = bibleBookNumber(params.get('livro')) || Number(params.get('book'));
  return bibleChapterURL(book, params.get('cap') || params.get('chapter'), params.get('verso') || params.get('verse'), params.get('endVerse'), params.get('endChapter'));
}

export function bibleReferenceURL(reference, abbreviations = {}) {
  const parsed = parseBibleReferences(reference, abbreviations)[0];
  if (!parsed) return null;
  const first = parsed.ranges[0];
  const isRange = first && (first.endChapter !== first.chapter || first.endVerse !== first.verse);
  return bibleChapterURL(parsed.book, parsed.chapter, first?.verse, isRange ? first.endVerse : null, isRange ? first.endChapter : null);
}

export function bibleStudyURL({href = '', targetVerses = '', reference = ''} = {}, abbreviations = {}) {
  const coordinates = value => {
    const match = String(value).match(/^(\d{2})(\d{3})(\d{3})(?:-|$)/);
    if (!match) return null;
    const book = Number(match[1]), chapter = Number(match[2]), verse = Number(match[3]);
    return book >= 1 && book <= 66 && chapter >= 1 && chapter <= chapterCounts[book - 1] && verse >= 1 && verse <= 176 ? {book, chapter, verse} : null;
  };
  let target = coordinates(targetVerses);
  if (href) {
    let source;
    try { source = new URL(href, 'https://www.jw.org'); } catch { return null; }
    if (source.protocol !== 'https:' || !['www.jw.org', 'jw.org'].includes(source.hostname)) return null;
    let path;
    try { path = decodeURIComponent(source.pathname).match(/\/biblioteca\/biblia\/[^/]+\/livros\/([^/]+)\/(\d{1,3})\/?$/i); } catch { return null; }
    if (!path) return null;
    const hashTarget = coordinates(source.hash.replace(/^#v/, ''));
    target ||= hashTarget;
    if (!target || target.book !== bibleBookNumber(path[1], abbreviations) || target.chapter !== Number(path[2]) || hashTarget && (target.book !== hashTarget.book || target.chapter !== hashTarget.chapter || target.verse !== hashTarget.verse)) return null;
  } else if (!target && reference) {
    const parsed = parseBibleReferences(reference, abbreviations);
    const first = parsed[0]?.ranges[0];
    if (parsed.length !== 1 || parsed[0].ranges.length !== 1 || !first || first.chapter !== first.endChapter || first.verse !== first.endVerse) return null;
    target = {book:parsed[0].book, chapter:first.chapter, verse:first.verse};
  }
  if (!target) return null;
  const url = bibleChapterURL(target.book, target.chapter, target.verse);
  url.searchParams.set('studyVerse', target.verse);
  return url;
}

// Article study notes have their own reference screen and a trusted return path.
// Keep the route relative to this installation, including GitHub Pages subpaths.
export function studyReferenceContext(search) {
  const params = new URLSearchParams(search);
  if (params.get('studyView') !== 'reference' || params.get('from') !== 'article') return null;
  const source = params.get('returnTo');
  if (!source) return null;
  const articleRoot = new URL('../sentinela/artigos/', import.meta.url);
  let returnURL;
  try { returnURL = new URL(source, articleRoot); } catch { return null; }
  if (returnURL.origin !== articleRoot.origin || returnURL.protocol !== articleRoot.protocol ||
      returnURL.username || returnURL.password || !returnURL.pathname.startsWith(articleRoot.pathname) ||
      !/^[^/\\%]+\.html$/i.test(returnURL.pathname.slice(articleRoot.pathname.length))) return null;
  const returnTitle = (params.get('returnTitle') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Voltar ao artigo';
  return {returnURL, returnTitle};
}

export function appendBibleChapterLink(container, reference, abbreviations = {}) {
  const url = bibleReferenceURL(reference, abbreviations);
  if (!url) return;
  container.querySelector('.bible-reader-link')?.remove();
  // Keep the link outside <p>: the editor transcribes only verse paragraphs.
  const link = document.createElement('a');
  link.className = 'bible-reader-link';
  link.href = url.href;
  link.textContent = 'Abrir capítulo';
  link.setAttribute('aria-label', `Abrir ${String(reference).split(';')[0].trim()} na Bíblia`);
  link.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;margin-top:12px;padding:0 14px;border:1px solid currentColor;border-radius:6px;color:var(--primary-color,#5b3c88);text-decoration:none;font:600 15px/1.3 "Noto Sans",sans-serif;';
  container.append(link);
}
