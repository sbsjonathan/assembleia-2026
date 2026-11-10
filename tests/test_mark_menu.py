"""Manual highlight menu in Chromium/WebKit, with synthetic article text only.

The browser cannot drive iOS selection handles. Range creation and touch-end
selection gestures below are simulated; menu taps use real Playwright touch.
Set WEBKIT_EXECUTABLE for WebKit and QA_ARTIFACT_DIR for screenshot artifacts.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get('QA_ARTIFACT_DIR', '/tmp/assembleia-mark-menu-qa'))
FIXTURE = '''<!doctype html><html lang="pt-BR" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/sentinela/style.css">
<style>
body{background:white}main{padding:20px 24px 80px}.paragrafo{font:20px/1.6 sans-serif;margin:18px 0}
header{height:60px;background:#ce5a00}h1{font:600 22px/1.4 sans-serif;margin:0 0 20px;color:#4a4a4a}
.paragrafo>span:first-child{font-size:.8em;color:#626262;font-weight:bold;margin-right:8px}
</style><script>
window.qaWrites=[];window.CacheAnotacao={
 carregar:id=>localStorage.getItem(id)||'',
 salvar:(id,html)=>{qaWrites.push({id,html});localStorage.setItem(id,html)}
};
</script></head><body><header></header><main><h1>Como mostramos confiança?</h1>
<p class="paragrafo" id="plain-p"><span>1</span> <span id="plain">Podemos confiar em Jeová e agir com fé.</span></p>
<p class="paragrafo" id="recap-p"><span>2</span> <mark class="ia-underline-recap" data-hl-id="recap-a" data-ia-owner="recap-q" data-ia-mode="owned">Confiar em <a class="bbl" href="#bible">Jeová</a> fortalece nossa fé.</mark></p>
<p class="paragrafo" id="color-p"><span>3</span> <mark class="hl-color-green ia-highlight-b" data-hl-id="colored-a" data-ia-owner="question-3" data-ia-mode="owned">Agimos com <mark class="ia-underline-recap" data-hl-id="recap-b" data-ia-owner="recap-q" data-ia-mode="owned">coragem</mark> e amor.</mark></p>
<p class="paragrafo" id="outer-recap-p"><span>4</span> <mark class="ia-underline-recap" data-hl-id="recap-c" data-ia-owner="recap-other" data-ia-mode="owned">Cultivamos a <mark class="hl-color-blue" data-hl-id="colored-b">paz</mark> todos os dias.</mark></p>
<p class="paragrafo" id="quick-p"><span>5</span> <span id="quick">A oração nos ajuda a agir com coragem.</span></p>
<p class="paragrafo" id="legacy-p"><span>6</span> <mark class="hl-color-orange ia-underline-recap" data-hl-id="legacy-combined">A esperança nos fortalece.</mark></p>
</main><script src="/sentinela/mark.js"></script></body></html>'''

GESTURES = '''(() => {
 window.qaTouch=(type,target,x,y)=>{
   const event=new Event(type,{bubbles:true,cancelable:true});
   const point={clientX:x,clientY:y,pageX:x+scrollX,pageY:y+scrollY,identifier:1,target};
   Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
   Object.defineProperty(event,'changedTouches',{value:[point]});
   target.dispatchEvent(event);
 };
 window.qaSelect=(selector,phrase=null)=>{
   const element=document.querySelector(selector),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
   const nodes=[];let text='',node;
   while((node=walker.nextNode())){nodes.push({node,start:text.length});text+=node.nodeValue;}
   const start=phrase===null?0:text.indexOf(phrase),end=phrase===null?text.length:start+phrase.length;
   if(start<0)throw Error('Selection phrase missing: '+phrase);
   const first=nodes.find(item=>item.start+item.node.length>start);
   const last=nodes.find(item=>item.start+item.node.length>=end);
   const range=document.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);
   const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return range.toString();
 };
 window.qaSelectionGesture=(selector,phrase=null)=>{
   const target=document.querySelector(selector),rect=target.getBoundingClientRect();
   const x=rect.left+5,y=rect.top+5;
   qaTouch('touchstart',target,x,y);qaSelect(selector,phrase);qaTouch('touchend',target,x,y);
 };
})();'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?')[0] == '/mark-menu-fixture.html':
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width':430,'height':873},is_mobile=True,
                                  has_touch=True,service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin) else route.abort())
    context.add_init_script(GESTURES)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin+'/mark-menu-fixture.html',wait_until='load')
    menu = page.locator('#hl-custom-menu')
    main = menu.locator('.hl-color-btn-main')

    def select(selector,phrase=None):
        # Independent selection, not the quick double-tap paint gesture.
        page.wait_for_timeout(450)
        page.evaluate('([selector,phrase])=>qaSelectionGesture(selector,phrase)',[selector,phrase])
        menu.wait_for(state='visible')

    def tap_mark(selector):
        page.wait_for_timeout(450)
        page.locator(selector).tap()
        menu.wait_for(state='visible')

    def saved_matches(selector):
        return page.locator(selector).evaluate('(element)=>localStorage.getItem(element.id)===element.innerHTML')

    # A fresh selection uses a single swatch and applies without a palette.
    original = page.locator('#plain-p').inner_text()
    select('#plain','confiar em Jeová')
    assert main.get_attribute('aria-label') == 'Aplicar destaque amarelo'
    assert 'hl-color-stack' not in (main.get_attribute('class') or '')
    assert menu.locator('.hl-palette').is_hidden()
    assert page.evaluate('getSelection().toString()') == 'confiar em Jeová'
    ARTIFACTS.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(ARTIFACTS/f'{engine.name}-plain-selection.png'))
    main.tap()
    menu.wait_for(state='hidden')
    assert page.locator('#plain-p mark.hl-color-yellow').inner_text() == 'confiar em Jeová'
    assert page.locator('#plain-p').inner_text() == original and saved_matches('#plain-p')
    assert page.evaluate('getSelection().isCollapsed')

    # Tapping existing color offers the palette stack, reflecting that mark's
    # color even when the previous selection used a different one.
    tap_mark('#color-p [data-hl-id="recap-b"]')
    assert 'hl-color-stack' in (main.get_attribute('class') or '')
    assert main.get_attribute('aria-label') == 'Alterar cor do destaque'
    assert main.get_attribute('aria-expanded') == 'false'
    assert 'hl-color-green' in (main.get_attribute('class') or '')
    peeks = main.locator('.hl-color-peek')
    assert peeks.count() == 5 and all(peeks.nth(i).is_visible() for i in range(peeks.count()))
    assert len(set(peeks.evaluate_all('(elements)=>elements.map(el=>getComputedStyle(el).backgroundColor)'))) == 5
    assert main.locator('.hl-color-front').is_visible()
    page.screenshot(path=str(ARTIFACTS/f'{engine.name}-stacked-color.png'))
    main.tap()
    assert menu.locator('.hl-palette').is_visible()
    assert menu.locator('.hl-palette [data-color]').count() == 6
    menu.locator('.hl-palette [data-color="purple"]').tap()
    menu.wait_for(state='hidden')
    colored = page.locator('#color-p [data-hl-id="colored-a"]')
    assert colored.get_attribute('class') == 'hl-color-purple'
    assert colored.get_attribute('data-ia-owner') is None
    assert page.locator('#color-p [data-hl-id="recap-b"]').inner_text() == 'coragem'
    assert page.locator('#color-p [data-hl-id="recap-b"]').get_attribute('data-ia-owner') == 'recap-q'
    assert saved_matches('#color-p')

    # Selection on a dotted recap is still a new color selection. The selected
    # link and the original dotted layer survive the direct current-color tap.
    original_recap = page.locator('#recap-p').inner_text()
    select('#recap-p [data-hl-id="recap-a"]','Confiar em Jeová')
    assert main.get_attribute('aria-label') == 'Aplicar destaque roxo'
    assert 'hl-color-stack' not in (main.get_attribute('class') or '')
    main.tap()
    menu.wait_for(state='hidden')
    assert ' '.join(page.locator('#recap-p mark.hl-color-purple').all_text_contents()) == 'Confiar em Jeová'
    assert page.locator('#recap-p [data-hl-id="recap-a"]').inner_text() == 'Confiar em Jeová fortalece nossa fé.'
    assert page.locator('#recap-p a.bbl').get_attribute('href') == '#bible'
    assert page.locator('#recap-p').inner_text() == original_recap and saved_matches('#recap-p')

    # A reload restores both independent layers. Deleting the color keeps the
    # dotted source and link; the same rule applies to either nesting order.
    page.reload(wait_until='load')
    assert page.locator('#color-p [data-hl-id="colored-a"]').get_attribute('class') == 'hl-color-purple'
    assert page.locator('#color-p [data-hl-id="recap-b"]').inner_text() == 'coragem'
    assert page.locator('#recap-p mark.hl-color-purple').count() == 2
    tap_mark('#color-p [data-hl-id="recap-b"]')
    menu.locator('.hl-btn-trash').tap()
    assert page.locator('#color-p [data-hl-id="colored-a"]').count() == 0
    assert page.locator('#color-p [data-hl-id="recap-b"]').inner_text() == 'coragem'
    assert saved_matches('#color-p')
    tap_mark('#outer-recap-p [data-hl-id="colored-b"]')
    menu.locator('.hl-btn-trash').tap()
    assert page.locator('#outer-recap-p [data-hl-id="colored-b"]').count() == 0
    assert page.locator('#outer-recap-p [data-hl-id="recap-c"]').inner_text() == 'Cultivamos a paz todos os dias.'
    assert saved_matches('#outer-recap-p')

    # Old saved articles can carry both styles on one mark. Recoloring and
    # deleting color must retain its dotted layer before explicit removal.
    tap_mark('#legacy-p [data-hl-id="legacy-combined"]')
    assert 'hl-color-stack' in (main.get_attribute('class') or '')
    assert 'hl-color-orange' in (main.get_attribute('class') or '')
    main.tap()
    menu.locator('.hl-palette [data-color="pink"]').tap()
    legacy = page.locator('#legacy-p [data-hl-id="legacy-combined"]')
    assert 'hl-color-pink' in legacy.get_attribute('class')
    assert 'ia-underline-recap' in legacy.get_attribute('class')
    tap_mark('#legacy-p [data-hl-id="legacy-combined"]')
    menu.locator('.hl-btn-trash').tap()
    assert legacy.get_attribute('class') == 'ia-underline-recap'
    assert legacy.inner_text() == 'A esperança nos fortalece.' and saved_matches('#legacy-p')
    tap_mark('#legacy-p [data-hl-id="legacy-combined"]')
    assert main.is_hidden()
    menu.locator('.hl-btn-trash').tap()
    assert page.locator('#legacy-p mark').count() == 0
    assert 'A esperança nos fortalece.' in page.locator('#legacy-p').inner_text() and saved_matches('#legacy-p')

    # Quick second touch + drag preserves the existing automatic paint path.
    page.wait_for_timeout(450)
    page.evaluate('''()=>{
      const target=document.querySelector('#quick'),r=target.getBoundingClientRect();
      window.qaQuick={target,x:r.left+5,y:r.top+5};
      qaTouch('touchstart',target,qaQuick.x,qaQuick.y);getSelection().removeAllRanges();qaTouch('touchend',target,qaQuick.x,qaQuick.y);
    }''')
    page.wait_for_timeout(100)
    page.evaluate('''()=>{
      const {target,x,y}=qaQuick;qaTouch('touchstart',target,x,y);qaSelect('#quick','A oração nos ajuda');
      qaTouch('touchmove',target,x+45,y);qaTouch('touchend',target,x+45,y);
    }''')
    page.wait_for_function('document.querySelector("#quick mark[class*=hl-color]")')
    assert page.locator('#quick mark').inner_text() == 'A oração nos ajuda'
    assert menu.is_hidden() and saved_matches('#quick-p')
    assert not errors,errors
    print(json.dumps({'engine':engine.name,'directColorSelection':'passed','stackedPalette':'passed',
                      'recapColorLayers':'passed','recolorAndDelete':'passed','reload':'passed',
                      'quickSelectionPaint':'passed','screenshots':str(ARTIFACTS)}),flush=True)
    browser.close()


if __name__ == '__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            check(playwright.chromium,os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit,os.environ['WEBKIT_EXECUTABLE'],origin)
    finally:
        server.shutdown()
