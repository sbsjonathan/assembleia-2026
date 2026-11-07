'use strict';
// Local JWPUB images. SVG is rebuilt with a drawing-only allowlist before use as <img>.
const MEDIA_IMAGE_LIMIT = 16 * 1024 * 1024;
const MEDIA_SVG_LIMIT = 12 * 1024 * 1024;
const MEDIA_OUTPUT_LIMIT = 32 * 1024 * 1024;
const mediaSvgTags = new Map('svg g defs symbol use path rect circle ellipse line polyline polygon image text tspan textPath clipPath mask pattern linearGradient radialGradient stop title desc'.split(' ').map(x=>[x.toLowerCase(),x]));
const mediaSvgAttrs = new Map('id class x y x1 y1 x2 y2 cx cy r rx ry dx dy width height d points transform viewBox preserveAspectRatio opacity fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity clip-path clip-rule mask offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing word-spacing rotate lengthAdjust textLength'.split(' ').map(x=>[x.toLowerCase(),x]));
const mediaCssProps = new Set('fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity stop-color stop-opacity opacity overflow clip-path clip-rule font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing word-spacing'.split(' '));
function mediaXml(value) {return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function mediaCssValue(value) {
  if(/[\\@<>]|expression|javascript|behavior|https?:|data:/i.test(value))return null;
  if(/url\s*\(/i.test(value)&&!/^url\(\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*\)$/i.test(value))return null;
  return value.trim();
}
function mediaDeclarations(source) {
  return source.split(';').map(piece=>{
    const at=piece.indexOf(':');if(at<0)return '';
    const property=piece.slice(0,at).trim().toLowerCase(),value=mediaCssValue(piece.slice(at+1));
    return mediaCssProps.has(property)&&value?`${property}:${value}`:'';
  }).filter(Boolean).join(';');
}
function mediaStyles(source) {
  const result=[];
  for(const match of source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors=match[1].trim(),declarations=mediaDeclarations(match[2]);
    if(/^[\w.#\s,>+~-]+$/.test(selectors)&&declarations)result.push(`${selectors}{${declarations}}`);
  }
  return result.join('\n');
}
function mediaRasterType(bytes) {
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return 'image/png';
  if(bytes.length>=6&&String.fromCharCode(...bytes.subarray(0,6)).match(/^GIF8[79]a$/))return 'image/gif';
  if(bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP')return 'image/webp';
  return null;
}
function mediaBase64(bytes) {
  let binary='';for(let at=0;at<bytes.length;at+=16384)binary+=String.fromCharCode(...bytes.subarray(at,at+16384));
  return btoa(binary);
}
async function mediaArchive(active) {
  if(active.mediaArchive!==undefined)return active.mediaArchive;
  const stored=await getStored('packages',active.id);
  if(!(stored?.data instanceof Blob)){active.mediaArchive=null;return null;}
  const index=await zipIndex(stored.data);
  active.mediaArchive={blob:stored.data,index};return active.mediaArchive;
}
async function mediaSvgImageHref(archive,href,budget) {
  if(/^#[A-Za-z_][\w:.-]*$/.test(href))return href;
  const embedded=href.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if(embedded){const compact=embedded[2].replace(/\s/g,'');if(compact.length>MEDIA_IMAGE_LIMIT*1.4)return null;return `data:${embedded[1].toLowerCase()};base64,${compact}`;}
  const file=href.replace(/^jwpub-media:\/\//,'');
  if(!/^[\w.-]+\.(?:jpe?g|png|gif|webp)$/i.test(file)||!archive.index.has(file))return null;
  if(budget.files.has(file))return budget.files.get(file);
  if(budget.files.size>=64)return null;
  const bytes=archive.read?await archive.read(file,MEDIA_IMAGE_LIMIT):await entryBytes(archive.blob,archive.index.get(file),MEDIA_IMAGE_LIMIT),type=mediaRasterType(bytes);
  budget.bytes+=bytes.length;if(!type||budget.bytes>MEDIA_OUTPUT_LIMIT)return null;
  const uri=`data:${type};base64,${mediaBase64(bytes)}`;budget.files.set(file,uri);return uri;
}
async function sanitizePublicationSvg(source,archive) {
  if(source.length>MEDIA_SVG_LIMIT||/<!DOCTYPE|<!ENTITY/i.test(source))fail('Esta imagem não é compatível.');
  const styles=[];
  let clean=source.replace(/<!--[\s\S]*?-->/g,'').replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,(_,css)=>{const safe=mediaStyles(css);if(safe)styles.push(safe);return '';});
  clean=clean.replace(/<(script|foreignObject|iframe|object|audio|video|animate|animateTransform|animateMotion|set)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const output=[],stack=[],budget={bytes:0,files:new Map()};let root=false,skip=0;
  for(const token of clean.match(/<[^>]*>|[^<]+|</g)||[]) {
    if(!token.startsWith('<')){if(root&&!skip)output.push(mediaXml(decodeEntities(token)));continue;}
    const closing=token.match(/^<\/([\w:-]+)\s*>/);if(closing){
      const name=closing[1].toLowerCase();const item=stack.pop();if(!item)continue;
      if(item.skip){skip--;continue;}
      if(item.name!==name)fail('Estrutura SVG inválida.');output.push(`</${mediaSvgTags.get(name)}>`);continue;
    }
    const opening=token.match(/^<([a-z][\w:-]*)\b/i);if(!opening)continue;
    const name=opening[1].toLowerCase(),tag=mediaSvgTags.get(name),selfClosing=/\/\s*>$/.test(token);
    if(skip||!tag||(!root&&name!=='svg')){if(!selfClosing){stack.push({name,skip:true});skip++;}continue;}
    const attrs=[];
    for(const match of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key=match[1].toLowerCase(),value=decodeEntities(match[2]??match[3]??'');
      if(key==='href'||key==='xlink:href'){
        const href=name==='image'?await mediaSvgImageHref(archive,value,budget):/^#[A-Za-z_][\w:.-]*$/.test(value)?value:null;
        if(href)attrs.push(`href="${mediaXml(href)}"`);continue;
      }
      if(key==='style'){const css=mediaDeclarations(value);if(css)attrs.push(`style="${mediaXml(css)}"`);continue;}
      const allowed=mediaSvgAttrs.get(key);if(!allowed)continue;
      if(mediaCssValue(value)===null)continue;
      attrs.push(`${allowed}="${mediaXml(value)}"`);
    }
    if(name==='svg'&&!root){root=true;attrs.push('xmlns="http://www.w3.org/2000/svg"');}
    output.push(`<${tag}${attrs.length?' '+attrs.join(' '):''}${selfClosing?'/':''}>`);
    if(name==='svg'&&styles.length)output.push(`<style>${styles.join('\n')}</style>`);
    if(!selfClosing)stack.push({name,skip:false});
  }
  if(!root||stack.length)fail('Estrutura SVG inválida.');
  const result=output.join('');if(result.length>MEDIA_OUTPUT_LIMIT)fail('A imagem é grande demais para abrir.');
  return result;
}
async function readPublicationMedia(active,value) {
  if(typeof value!=='string'||!/^[\w.-]+\.(?:jpe?g|png|gif|webp|svg)$/i.test(value))fail('Imagem inválida.');
  const limit=/\.svg$/i.test(value)?MEDIA_SVG_LIMIT:MEDIA_IMAGE_LIMIT;
  const bundled=await bundledMediaArchive(active);
  let archive,bytes,bundledError;
  if(bundled?.index.has(value)){
    try{bytes=await bundled.read(value,limit);archive=bundled;}catch(error){bundledError=error;}
  }
  if(!bytes){
    archive=await mediaArchive(active);
    const entry=archive?.index.get(value);
    if(!entry){if(bundledError)throw bundledError;return null;}
    bytes=await entryBytes(archive.blob,entry,limit);
  }
  if(/\.svg$/i.test(value))return new Blob([await sanitizePublicationSvg(textDecoder.decode(bytes),archive)],{type:'image/svg+xml'});
  const mime=mediaRasterType(bytes);if(!mime)fail('Formato de imagem não compatível.');
  return new Blob([bytes],{type:mime});
}
