'use strict';
// Chapter recordings and verse timings are supplied by the official publication API.
const bibleAudioRequests = new Map();
const BIBLE_AUDIO_ENDPOINT = 'https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS';
function audioTimeSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const match = typeof value === 'string' && value.match(/^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
function officialAudioUrl(value) {
  try {
    const url = new URL(value);
    const domain = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['jw-cdn.org','jw.org'].some(root => domain === root || domain.endsWith('.' + root))) return null;
    return url.href;
  } catch { return null; }
}
function plainAudioLabel(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
}
function parseBibleAudioTrack(response, book, chapter) {
  const tracks = response?.files?.T?.MP3;
  if (!Array.isArray(tracks)) throw new Error('Esta gravação não está disponível em português.');
  const row = tracks.find(file => Number(file.track) === chapter && (file.booknum == null || Number(file.booknum) === book));
  const url = officialAudioUrl(row?.file?.url);
  if (!row || !url || (row.mimetype && row.mimetype !== 'audio/mpeg')) throw new Error('O áudio deste capítulo não está disponível.');
  const duration = Number(row.duration);
  const sourceMarkers = row.markers?.markers;
  const markers = [];
  if (Array.isArray(sourceMarkers)) for (const marker of sourceMarkers) {
    const verse = Number(marker.verseNumber), start = audioTimeSeconds(marker.startTime), length = audioTimeSeconds(marker.duration);
    if (!Number.isInteger(verse) || verse < 0 || verse > 200 || start == null || (duration > 0 && start > duration)) continue;
    markers.push({verse,start,...(length != null ? {end:duration > 0 ? Math.min(duration,start+length) : start+length} : {})});
  }
  markers.sort((a,b) => a.start-b.start || a.verse-b.verse);
  return {url,book,chapter,language:'T',symbol:'nwt',bookTitle:plainAudioLabel(response.pubName),title:plainAudioLabel(row.title) || `Capítulo ${chapter}`,duration:Number.isFinite(duration)&&duration>0?duration:null,markers};
}
async function fetchBibleAudioBook(book) {
  if (bibleAudioRequests.has(book)) return bibleAudioRequests.get(book);
  const request = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = new URL(BIBLE_AUDIO_ENDPOINT);
      url.search = new URLSearchParams({booknum:String(book),output:'json',pub:'nwt',fileformat:'MP3',alllangs:'0',langwritten:'T',txtCMSLang:'T'}).toString();
      const response = await fetch(url.href,{mode:'cors',credentials:'omit',signal:controller.signal});
      if (!response.ok) throw new Error('O áudio deste livro não está disponível no momento.');
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('A conexão com o áudio demorou. Tente novamente.');
      if (error instanceof TypeError) throw new Error('Conecte o iPhone à internet para carregar o áudio.');
      throw error;
    } finally { clearTimeout(timer); }
  })();
  bibleAudioRequests.set(book,request);
  try { return await request; }
  catch (error) { bibleAudioRequests.delete(book); throw error; }
}
async function resolveBibleAudio({symbol,language,book,chapter}) {
  if (!['nwt','nwtsty'].includes(String(symbol).toLowerCase()) || String(language) !== '5') throw new Error('O áudio ainda não está disponível para esta edição ou idioma.');
  book=Number(book);chapter=Number(chapter);
  if (!Number.isInteger(book)||book<1||book>66||!Number.isInteger(chapter)||chapter<1||chapter>150) throw new Error('Capítulo inválido para reprodução.');
  return parseBibleAudioTrack(await fetchBibleAudioBook(book),book,chapter);
}
function audioPositionForVerse(source, value) {
  const verse=Number(value),markers=source?.markers||[];
  if (!Number.isInteger(verse)||verse<0) return {time:0,verse:null,exact:false};
  const exact=markers.find(marker=>marker.verse===verse);
  if (exact) return {time:exact.start,verse:exact.verse,exact:true};
  // Some official markers group several verses. Use the preceding group rather
  // than inventing a time inside it; callers can disclose the actual start verse.
  const preceding=markers.filter(marker=>marker.verse<=verse).at(-1);
  return preceding ? {time:preceding.start,verse:preceding.verse,exact:false} : {time:0,verse:null,exact:false};
}
