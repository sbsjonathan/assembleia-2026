"""Render the bundled Study Bible in Chromium and WebKit, without remote services.

Checks inline study links, punctuation wrapping, font scaling, original poetry,
note interactions, and rendering of pre-update cached chapters. WebKit here is
an automated browser build, not an installed iPhone PWA.
"""
import json
import os
import gzip
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.getenv('BIBLE_QA_ARTIFACTS', '/tmp/bible-typography-qa'))

# WPE's headless port cannot reliably read an IndexedDB-backed Blob. Seed the
# exact bundled database as bytes and adapt only the test worker's storage read.
# Production parsing, DOM, styles and notes are exercised without alteration.
WEBKIT_STORAGE = '''const qaBlobBuffers=new WeakMap(),qaBlobRead=Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer=function(){return qaBlobBuffers.has(this)?Promise.resolve(qaBlobBuffers.get(this).slice(0)):qaBlobRead.call(this);};
const qaIDBResult=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'result');
Object.defineProperty(IDBRequest.prototype,'result',{get(){const r=qaIDBResult.get.call(this);
if(r&&r.data instanceof ArrayBuffer){const blob=new Blob([r.data],{type:'application/octet-stream'});qaBlobBuffers.set(blob,r.data);return {...r,data:blob};}return r;}});
'''
SEED_WEBKIT = '''async()=>{
 const [manifest,data]=await Promise.all([fetch('/biblia/bundled/manifest.json').then(r=>r.json()),fetch('/__qa__/bible.db').then(r=>r.arrayBuffer())]);
 await new Promise((resolve,reject)=>{const r=indexedDB.open('jwpub-iphone-library',2);
 r.onupgradeneeded=()=>{for(const name of ['publications','databases','packages'])r.result.createObjectStore(name,{keyPath:'id'});};
 r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(['publications','databases'],'readwrite');
 t.objectStore('publications').put({id:manifest.id,title:manifest.title,language:manifest.language,symbol:manifest.symbol,bundled:true});
 t.objectStore('databases').put({id:manifest.id,data,bundledManifest:manifest});
 t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});
}'''

class Handler(SimpleHTTPRequestHandler):
    webkit_adapter = False
    bible_bytes = None
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/__qa__/seed.html':
            data,kind=b'<!doctype html><script src="/shared/app-scope.js"></script>', 'text/html'
        elif path=='/__qa__/bible.db':
            if self.bible_bytes is None:
                folder=ROOT/'biblia/bundled'
                manifest=json.loads((folder/'manifest.json').read_text())
                Handler.bible_bytes=gzip.decompress(b''.join((folder/chunk['path']).read_bytes() for chunk in manifest['database']['chunks']))
                assert hashlib.sha256(Handler.bible_bytes).hexdigest()==manifest['database']['sha256']
            data,kind=self.bible_bytes,'application/octet-stream'
        elif path=='/biblia/reader-worker.js' and self.webkit_adapter:
            data,kind=WEBKIT_STORAGE.encode()+(ROOT/'biblia/reader-worker.js').read_bytes(),'application/javascript'
        else:
            return super().do_GET()
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

METRICS = r'''() => {
 const body = document.querySelector('#verses'), title = document.querySelector('#screen-title');
 const chapter = body.querySelector('.chapter-number');
 const font = el => parseFloat(getComputedStyle(el).fontSize);
 const header=document.querySelector('.app-header');
 const links = [...body.querySelectorAll('.study-word')];
 const punctuation = links.flatMap(link => {
   const after = link.nextSibling, text = after?.firstChild;
   if (!text || !/^[.,;:!?]/.test(text.textContent)) return [];
   const last = link.lastChild, a = document.createRange(), b = document.createRange();
   a.setStart(last, last.length - 1); a.setEnd(last, last.length);
   b.setStart(text, 0); b.setEnd(text, 1);
   return [{term: link.textContent, sameLine: Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top)<2,
    sameFont: getComputedStyle(link).font === getComputedStyle(after).font}];
 });
 return {title:title.textContent, bodyHeading:!!document.querySelector('#reading-title,#reader > h2'),
  readerLabel:document.querySelector('#reader').getAttribute('aria-labelledby'),
  font:font(body), globalFont:GlobalFontScale.getSize(), lineHeight:parseFloat(getComputedStyle(body).lineHeight),
  chapterRatio:font(chapter)/font(body), chapterWeight:getComputedStyle(chapter).fontWeight,
  headerHeight:header.getBoundingClientRect().height, headerTitle:font(title),
  headerSubtitle:font(document.querySelector('#screen-subtitle')), headerBack:font(document.querySelector('#back')),
  overflowing:document.documentElement.scrollWidth>innerWidth+1,
  links:links.length, inline:links.every(el=>el.tagName==='A'&&getComputedStyle(el).display==='inline'),
  weights:links.map(el=>getComputedStyle(el).fontWeight),
  multiline:links.some(el=>el.getClientRects().length>1), punctuation,
  navbar:font(document.querySelector('.bottom-navbar'))};
}'''

def open_chapter(page, base, book, chapter):
    page.goto(f'{base}/biblia/biblia.html?book={book}&chapter={chapter}', wait_until='domcontentloaded')
    page.wait_for_selector('#reader:not([hidden]) .bible-paragraph', timeout=120000)
    page.wait_for_function('document.querySelector("#screen-title").textContent.endsWith(" " + new URLSearchParams(location.search).get("chapter"))')
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(300)

def close_note(page):
    page.locator('#note-close').click()
    page.wait_for_selector('#note-dialog', state='hidden')

def run(browser, name, base):
    context = browser.new_context(viewport={'width':430,'height':873},is_mobile=True,has_touch=True,service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page = context.new_page()
    if name=='webkit':
        page.goto(base+'/__qa__/seed.html')
        page.evaluate(SEED_WEBKIT)
    open_chapter(page, base, 48, 1)
    reports=[]
    for width, level in [(430,3),(320,1),(320,11),(430,11),(1024,3)]:
        page.set_viewport_size({'width':width,'height':873})
        page.evaluate('(level)=>GlobalFontScale.setLevel(level)',level)
        page.evaluate('document.fonts.ready')
        data=page.evaluate(METRICS)
        assert data['title']=='Gálatas 1' and data['links']>=20, data
        assert not data['bodyHeading'] and data['readerLabel']=='screen-title', data
        assert data['inline'] and set(data['weights'])=={'400'}, data
        assert abs(data['font']-data['globalFont']*17.35/19.36)<.03, data
        assert abs(data['lineHeight']/data['font']-1.5)<.01 and 1.49<data['chapterRatio']<1.51, data
        assert data['chapterWeight']=='700' and not data['overflowing'], data
        assert data['headerHeight']==44 and data['headerTitle']==17 and data['headerSubtitle']==13 and data['headerBack']==16, data
        assert data['punctuation'] and all(item['sameLine'] and item['sameFont'] for item in data['punctuation']), data
        if width<=430:
            assert data['multiline'], 'Study phrases must wrap within the paragraph'
        reports.append({'width':width,'level':level,**data})
    assert len({r['navbar'] for r in reports})==1, 'The reading font must not resize navigation'
    page.set_viewport_size({'width':430,'height':873})
    page.evaluate('GlobalFontScale.setLevel(3)')
    page.screenshot(path=str(ARTIFACTS/f'{name}-galatians.png'))
    # Study words remain keyboard accessible without navigation or hash scrolling.
    study=page.locator('.study-word').filter(has_text='Amém').first
    study.focus(); study.press('Enter')
    page.wait_for_function('document.querySelector("#note-dialog").open && document.querySelector("#note-body").textContent.includes("Amém")')
    assert page.evaluate('location.hash')==''
    close_note(page)
    assert study.evaluate('(el)=>document.activeElement===el')
    page.locator('.note-marker.reference').first.click()
    page.wait_for_selector('#note-dialog[open] .reference-preview')
    close_note(page)
    # Old saved chapters carried strong:true on every inferred study term.
    legacy=page.evaluate('''()=>{const key='sentinela-bible-view-v1',cache=JSON.parse(localStorage.getItem(key));
      for(const block of cache.reading.data.blocks)for(const part of block.parts)if(part.note?.kind==='study'){part.strong=true;delete part.sourceStrong;}
      return {key:Object.keys(localStorage).find(k=>k.endsWith(key)),value:JSON.stringify(cache)};}''')
    page.add_init_script('''const legacy = '''+json.dumps(legacy)+''';
      if(!sessionStorage.getItem('bible-legacy-checked')){localStorage.setItem(legacy.key,legacy.value);sessionStorage.setItem('bible-legacy-checked','1');window.legacyBibleSeeded=true;}''')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('#reader:not([hidden]) .study-word')
    assert page.evaluate('window.legacyBibleSeeded && performance.getEntriesByName("bible-local-view").length===1')
    assert set(page.evaluate(METRICS)['weights'])=={'400'}
    # Match the supplied JW Library screenshot, not the different web reader.
    open_chapter(page, base, 48, 5)
    assert abs(page.evaluate(METRICS)['font']-17.35)<.03
    galatians5=page.evaluate(r'''()=>{
      const paragraph=document.querySelector('.bible-paragraph'),walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT),lines={};
      let firstCharacter=null;
      while(walker.nextNode()){
        const text=walker.currentNode;
        if(text.parentElement.closest('.note-marker,.verse-number'))continue;
        for(let i=0;i<text.length;i++){
          const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);
          const rect=range.getBoundingClientRect(),top=Math.round(rect.top);
          if(!firstCharacter&&text.textContent[i].trim())firstCharacter={left:rect.left,bottom:rect.bottom};
          lines[top]=(lines[top]||'')+text.textContent[i];
        }
      }
      const chapter=document.querySelector('.chapter-number').getBoundingClientRect();
      return {lines:Object.values(lines).map(text=>text.trim()),
        chapterInline:Math.abs(chapter.bottom-firstCharacter.bottom)<12&&firstCharacter.left>=chapter.right-1};
    }''')
    assert galatians5['lines']==[
        'Para tal liberdade é que Cristo nos libertou.',
        'Portanto, mantenham-se firmes e não se',
        'deixem submeter novamente a um jugo de',
        'escravidão.'
    ],galatians5
    assert galatians5['chapterInline'],galatians5
    page.screenshot(path=str(ARTIFACTS/f'{name}-galatians5-original-layout.png'))
    # Removing the redundant heading leaves the first verse close to the header.
    # Its action menu must still fit instead of trying to scroll above page zero.
    assert page.evaluate('scrollY')==0
    page.locator('#verse-1').click()
    page.wait_for_selector('.text-actions:not([hidden])')
    assert page.locator('#verse-1').get_attribute('aria-pressed')=='true'
    assert page.evaluate('scrollY')==0
    assert page.locator('.text-actions').get_attribute('data-placement')=='below'
    assert page.evaluate('''()=>{
      const menu=document.querySelector('.text-actions').getBoundingClientRect();
      return menu.top>=document.querySelector('.app-header').getBoundingClientRect().bottom&&menu.bottom<=innerHeight;
    }''')
    page.keyboard.press('Escape')
    page.wait_for_selector('.text-actions',state='hidden')
    page.locator('#verse-7').click()
    page.wait_for_selector('.text-actions:not([hidden])')
    assert page.locator('#verse-7').get_attribute('aria-pressed')=='true'
    assert page.locator('.text-actions').get_attribute('data-placement')=='above'
    page.keyboard.press('Escape')
    page.wait_for_selector('.text-actions',state='hidden')
    open_chapter(page, base, 1, 1)
    page.locator('.note-marker.footnote').first.click()
    page.wait_for_function('document.querySelector("#note-dialog").open && document.querySelector("#note-body").textContent.length>8 && document.querySelector("#note-body").textContent!=="Carregando…"')
    assert page.locator('#note-title').inner_text()=='Nota de rodapé'
    close_note(page)
    page.locator('#verse-1').click()
    page.wait_for_selector('.text-actions:not([hidden])')
    assert page.locator('#verse-1').get_attribute('aria-pressed')=='true'
    open_chapter(page, base, 19, 3)
    assert page.locator('.bible-heading.superscription').count()==1
    assert page.locator('.bible-paragraph.poetry.indented').count()>0
    assert page.locator('em').filter(has_text='Selá').first.evaluate('(el)=>getComputedStyle(el).fontStyle')=='italic'
    assert page.locator('.chapter-number').inner_text()=='3'
    page.screenshot(path=str(ARTIFACTS/f'{name}-psalm.png'))
    context.close()
    return {'fontCases':reports,'galatians5':galatians5}

if __name__=='__main__':
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    report={}
    try:
        with sync_playwright() as p:
            for name,engine,options in [('chromium',p.chromium,{'executable_path':os.getenv('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),'args':['--no-sandbox']}),('webkit',p.webkit,{'executable_path':os.environ['WEBKIT_EXECUTABLE']} if os.getenv('WEBKIT_EXECUTABLE') else {})]:
                Handler.webkit_adapter=name=='webkit'
                browser=engine.launch(**options)
                report[name]=run(browser,name,base)
                browser.close()
                print(f'PASS {name}: JW Library Galatians 5 line layout, compact fixed header, inline notes, five font/width combinations, legacy cache, references and poetry',flush=True)
    finally:
        server.shutdown()
        (ARTIFACTS/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
