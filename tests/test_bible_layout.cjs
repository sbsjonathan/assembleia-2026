'use strict';

// Run: node tests/test_bible_layout.cjs
// These extracts retain the bundled nwtsty source markup, including punctuation
// immediately after study terms and a verse that continues across poetry lines.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bible = path.join(__dirname, '..', 'biblia');
const context = vm.createContext({
  TextDecoder, TextEncoder, Uint8Array, Blob,
  importScripts() {}, self: {},
});
vm.runInContext(fs.readFileSync(path.join(bible, 'reader-worker.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(bible, 'chapter-layout.js'), 'utf8'), context);

const study = (id, ...terms) => ({
  terms, note: { id: `study:${id}`, kind: 'study', label: 'Estudo', title: 'Nota de estudo' },
});
const lookup = (overrides = {}) => ({
  document: 48, chapter: 1, footnotes: new Map(), marginals: new Set(),
  studyByVerse: new Map(), ...overrides,
});
const partsOf = blocks => blocks.flatMap(block => block.parts);
const normalize = text => text.replace(/\s+/gu, ' ').trim();
const verseText = (blocks, verse) => normalize(blocks.map(block => block.parts
  .filter(part => part.verse === verse && !part.number && (!part.note || part.note.kind === 'study'))
  .map(part => part.text).join('')).filter(Boolean).join(' '));

const galatians = `<p id="p2" data-pid="2" class="sb"><span id="v48-1-1-1" class="v"><span data-vlid="vl0" class="cl"><strong>1</strong> <span class="tt cl" data-rel-vlid="vl0"></span></span>Paulo, apóstolo não da parte de homens nem por homem algum, mas por Jesus Cristo<span data-mid="1" class="m">a<span class="tt m" data-rel-mid="1"></span></span> e por Deus, o Pai,<span data-mid="2" class="m">b<span class="tt m" data-rel-mid="2"></span></span> que o levantou dentre os mortos, </span><span id="v48-1-2-1" class="v"><span data-vlid="2" class="vl">2 <span class="tt vl" data-rel-vlid="2"></span></span>e todos os irmãos comigo, às congregações da Galácia:<span data-mid="3" class="m">c<span class="tt m" data-rel-mid="3"></span></span></span></p>
<p id="p3" data-pid="3" class="sb"><span id="v48-1-3-1" class="v"><span data-vlid="3" class="vl">3 <span class="tt vl" data-rel-vlid="3"></span></span>Que vocês tenham bondade imerecida e paz da parte de Deus, nosso Pai, e do Senhor Jesus Cristo. </span><span id="v48-1-4-1" class="v"><span data-vlid="4" class="vl">4 <span class="tt vl" data-rel-vlid="4"></span></span>Ele se entregou pelos nossos pecados<span data-mid="4" class="m">d<span class="tt m" data-rel-mid="4"></span></span> a fim de nos livrar deste mundo mau,<span data-mid="5" class="m">e<span class="tt m" data-rel-mid="5"></span></span> segundo a vontade do nosso Deus e Pai;<span data-mid="6" class="m">f<span class="tt m" data-rel-mid="6"></span></span> </span><span id="v48-1-5-1" class="v"><span data-vlid="5" class="vl">5 <span class="tt vl" data-rel-vlid="5"></span></span>a Ele seja dada a glória para todo o sempre. Amém.</span></p>
<p id="p4" data-pid="4" class="sb"><span id="v48-1-6-1" class="v"><span data-vlid="6" class="vl">6 <span class="tt vl" data-rel-vlid="6"></span></span>Estou admirado de que vocês estejam se afastando tão depressa Daquele que os chamou com a bondade imerecida de Cristo, para seguirem outro tipo de boas novas.<span data-mid="7" class="m">g<span class="tt m" data-rel-mid="7"></span></span></span></p>`;
const galatiansBlocks = context.parseChapterLayout(galatians, lookup({
  marginals: new Set([1, 2, 3, 4, 5, 6, 7]),
  studyByVerse: new Map([
    [2, [study(2735, 'às congregações da Galácia', 'Galácia')]],
    [3, [study(2736, 'Que vocês tenham bondade imerecida e paz')]],
    [4, [study(2737, 'mundo')]],
    [5, [study(2738, 'Amém')]],
    [6, [study(2739, 'que vocês estejam se afastando tão depressa', 'outro tipo de boas novas')]],
  ]),
}));
const expected = [
  'Paulo, apóstolo não da parte de homens nem por homem algum, mas por Jesus Cristo e por Deus, o Pai, que o levantou dentre os mortos,',
  'e todos os irmãos comigo, às congregações da Galácia:',
  'Que vocês tenham bondade imerecida e paz da parte de Deus, nosso Pai, e do Senhor Jesus Cristo.',
  'Ele se entregou pelos nossos pecados a fim de nos livrar deste mundo mau, segundo a vontade do nosso Deus e Pai;',
  'a Ele seja dada a glória para todo o sempre. Amém.',
  'Estou admirado de que vocês estejam se afastando tão depressa Daquele que os chamou com a bondade imerecida de Cristo, para seguirem outro tipo de boas novas.',
];
for (const [index, text] of expected.entries()) {
  assert.equal(verseText(galatiansBlocks, index + 1), text, `Gálatas 1:${index + 1} must retain its complete text and punctuation`);
}
const galatiansParts = partsOf(galatiansBlocks);
assert.equal(galatiansBlocks.length, 3, 'Original paragraph boundaries remain intact');
assert.deepEqual(Array.from(galatiansParts.filter(part => part.number), part => part.verse), [1, 2, 3, 4, 5, 6]);
assert.equal(galatiansParts.filter(part => part.chapter).length, 1);
assert.equal(galatiansParts.filter(part => part.note?.kind === 'reference').length, 7);
assert.equal(galatiansParts.filter(part => part.note?.kind === 'study').length, 6);
assert.ok(galatiansParts.every(part => !part.strong), 'Study links must not invent bold text');
assert.ok(galatiansParts.filter(part => part.note?.kind === 'study').every(part => part.sourceStrong === false), 'Study links distinguish real source emphasis from old cached automatic bold');
for (const [term, punctuation] of [['Amém', '.'], ['outro tipo de boas novas', '.'], ['às congregações da Galácia', ':']]) {
  const at = galatiansParts.findIndex(part => part.text === term);
  assert.ok(at >= 0);
  assert.equal(galatiansParts[at + 1].text, punctuation, 'No artificial whitespace before punctuation');
  assert.equal(galatiansParts[at].note.kind, 'study', 'The study note remains accessible');
}

const psalm = `<p id="p23" data-pid="23" class="sw"><span id="v19-3-0-1" class="v">Salmo de Davi, quando ele fugia de seu filho Absalão.<span data-mid="22" class="m">a<span class="tt m" data-rel-mid="22"></span></span></span></p>
<p id="p24" data-pid="24" class="sl"><span id="v19-3-1-1" class="v"><span data-vlid="vl0" class="cl"><strong>3</strong> <span class="tt cl" data-rel-vlid="vl0"></span></span>Ó Jeová, por que os meus adversários se tornaram tão numerosos?<span data-mid="23" class="m">b<span class="tt m" data-rel-mid="23"></span></span></span></p>
<p id="p25" data-pid="25" class="sz"><span id="v19-3-1-2" class="v">Por que tantos se levantam contra mim?<span data-mid="24" class="m">c<span class="tt m" data-rel-mid="24"></span></span></span></p>
<p id="p26" data-pid="26" class="sl"><span id="v19-3-2-1" class="v"> <span data-vlid="2" class="vl">2 <span class="tt vl" data-rel-vlid="2"></span></span>Muitos dizem sobre mim:<span data-fnid="10" class="fn">a<span id="footnotesource10" class="tt fn" data-rel-fnid="10"></span></span></span></p>
<p id="p27" data-pid="27" class="sz"><span id="v19-3-2-2" class="v">“Deus não o salvará.”<span data-mid="25" class="m">d<span class="tt m" data-rel-mid="25"></span></span> (<em>Selá</em>)<span data-fnid="11" class="fn">b<span id="footnotesource11" class="tt fn" data-rel-fnid="11"></span></span></span></p>
<div class="groupFootnote"><div id="footnote10" data-fnid="10" class="fcc fn-ref"><p>Footnote bodies must not enter the reading text.</p></div></div>`;
const psalmBlocks = context.parseChapterLayout(psalm, lookup({
  document: 19, chapter: 3, footnotes: new Map([[10, 510], [11, 511]]),
  marginals: new Set([22, 23, 24, 25]),
}));
const psalmParts = partsOf(psalmBlocks);
assert.equal(psalmBlocks.length, 5, 'Hidden footnote bodies are not rendered as scripture');
assert.equal(psalmBlocks[0].type, 'heading');
assert.equal(psalmBlocks[0].superscription, true);
assert.equal(psalmBlocks[1].type, 'poetry');
assert.equal(psalmBlocks[2].indent, 1);
assert.equal(psalmParts.find(part => part.chapter).text, '3');
assert.equal(psalmParts.find(part => part.chapter).verse, 1, 'Chapter label must still target the first verse');
assert.equal(verseText(psalmBlocks, 1), 'Ó Jeová, por que os meus adversários se tornaram tão numerosos? Por que tantos se levantam contra mim?');
assert.equal(verseText(psalmBlocks, 2), 'Muitos dizem sobre mim: “Deus não o salvará.” (Selá)');
assert.equal(psalmParts.find(part => part.text === 'Selá').emphasis, true);
assert.deepEqual(Array.from(psalmParts.filter(part => part.note?.kind === 'footnote'), part => [part.text, part.note.id]), [['*', 'fn:510'], ['#', 'fn:511']]);

// Study matching must retain intentional source styling, if an edition uses it.
const styled = partsOf(context.parseChapterLayout(
  '<p><span id="v19-3-2-1"><em>Selá</em>; <strong>ênfase original</strong>.</span></p>',
  lookup({ studyByVerse: new Map([[2, [study(1, 'Selá'), study(2, 'ênfase original')]]]) }),
));
assert.equal(styled.find(part => part.text === 'Selá').emphasis, true);
assert.ok(!styled.find(part => part.text === 'Selá').strong);
assert.equal(styled.find(part => part.text === 'Selá').sourceStrong, false);
assert.equal(styled.find(part => part.text === 'ênfase original').strong, true);
assert.equal(styled.find(part => part.text === 'ênfase original').sourceStrong, true);
assert.equal(styled.filter(part => part.note?.kind === 'study').length, 2);

console.log('PASS Bible layout: original text, punctuation, note targets, verses, poetry and source emphasis');
