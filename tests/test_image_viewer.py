"""Image dismissal regressions with production viewer, navbar and reading position.

Remote requests are blocked. Chromium also exercises trusted touch input through
CDP; WebKit uses synthetic TouchEvents, not a physical iPhone gesture.
"""
import json
import os
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = '/sentinela/artigos/qa-image.html'
VIEWER_PATH = '/sentinela/imagem/swiper-zoom.js'
BASELINE = subprocess.check_output(['git', 'show', 'HEAD:' + VIEWER_PATH[1:]], cwd=ROOT) if os.getenv('IMAGE_VIEWER_BASELINE') else None
PICTURE = b'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#345787"/><circle cx="300" cy="200" r="100" fill="#e8d59b"/></svg>'
FIXTURE = '''<!doctype html><html lang="pt-BR" data-theme="light"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/sentinela/style.css">
<link rel="stylesheet" href="/navbar/navbar-unified.css">
<link rel="stylesheet" href="/sentinela/imagem/swiper-zoom.css">
<style>:root{--navbar-safe-bottom:34px!important}main{padding:20px}.intro{height:900px}.tail{height:1300px}figure{margin:0}figure img{display:block;width:100%}</style>
</head><body class="is-pwa" data-study-reference-context="article"><div class="container"><main>
<div class="intro"><h1>Artigo de teste</h1></div>
<figure id="article-anchor"><img id="article-image" src="/__qa__/picture.svg" alt="Legenda de teste"><figcaption>Legenda de teste</figcaption></figure>
<p class="paragrafo">Texto original após a imagem.</p><div class="tail"></div>
</main></div>
<div id="zoom-container" class="zoom-container"><div class="zoom-header"><button type="button" class="zoom-btn-fechar" aria-label="Fechar">×</button></div><div class="zoom-content"></div><div class="zoom-footer"></div></div>
<script src="/navbar/navbar-unified.js"></script>
<script id="sentinela-reading-position" data-study-date="2026-11-02" src="/sentinela/artigos/reading-position.js"></script>
<script src="/sentinela/imagem/swiper-zoom.js"></script>
<script>document.querySelector('#article-image').addEventListener('click',event=>abrirZoom(event.currentTarget));</script>
</body></html>'''

HELPERS = r'''() => {
  window.qaTouch=(type,points)=>{
    const target=document.querySelector('.zoom-image'),touches=points.map(([clientX,clientY],identifier)=>({clientX,clientY,identifier,target}));
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{touches:{value:['touchend','touchcancel'].includes(type)?[]:touches},changedTouches:{value:touches}});
    target.dispatchEvent(event);
  };
  window.qaImageSnapshot=()=>{
    const overlay=document.querySelector('#zoom-container'),image=overlay.querySelector('img'),nav=document.querySelector('.bottom-navbar');
    const css=getComputedStyle(overlay),rect=document.querySelector('#article-anchor').getBoundingClientRect();
    const color=css.backgroundColor.match(/[\d.]+/g).map(Number),alpha=color.length===4?color[3]:1;
    const opacity=Number(css.opacity),imageCSS=image&&getComputedStyle(image),imageRect=image?.getBoundingClientRect();
    return {backgroundAlpha:alpha,overlayOpacity:opacity,effectiveAlpha:alpha*opacity,
      imageOpacity:imageCSS?Number(imageCSS.opacity):0,imageTop:imageRect?.top??null,imageHeight:imageRect?.height??null,
      articleTop:rect.top,scroll:scrollY,bodyPosition:getComputedStyle(document.body).position,
      bodyPadding:getComputedStyle(document.body).paddingBottom,navHidden:nav.classList.contains('hidden'),
      navTransform:getComputedStyle(nav).transform,active:overlay.classList.contains('active'),
      closing:overlay.classList.contains('closing'),ariaHidden:overlay.getAttribute('aria-hidden')};
  };
  window.qaStartImageTrace=()=>{
    const trace=window.qaImageTrace={before:qaImageSnapshot(),frames:[],finished:false};
    let released=false;
    const target=document.querySelector('.zoom-content');
    const release=()=>{
      if(released)return;released=true;target.removeEventListener('touchend',release);
      const end=performance.now()+550;
      const sample=()=>{trace.frames.push(qaImageSnapshot());if(performance.now()<end)requestAnimationFrame(sample);else trace.finished=true;};
      sample();
    };
    target.addEventListener('touchend',release);
  };
}'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == FIXTURE_PATH:
            data, kind = FIXTURE.encode(), 'text/html; charset=utf-8'
        elif path == '/__qa__/picture.svg':
            data, kind = PICTURE, 'image/svg+xml'
        elif path == VIEWER_PATH and BASELINE is not None:
            data, kind = BASELINE, 'application/javascript'
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def snapshot(page):
    return page.evaluate('qaImageSnapshot()')


def touch(page, kind, points):
    page.evaluate('([kind,points])=>qaTouch(kind,points)', [kind, points])


def open_image(page):
    page.evaluate("abrirZoom(document.querySelector('#article-image'))")
    page.wait_for_timeout(450)
    assert snapshot(page)['active']
    assert snapshot(page)['bodyPosition'] == 'fixed'


def assert_restored(page, before):
    page.wait_for_function("document.querySelector('#zoom-container').getAttribute('aria-hidden')==='true'")
    page.wait_for_timeout(80)
    after = snapshot(page)
    assert not after['active'] and not after['closing'], after
    for key in ['scroll', 'articleTop']:
        assert abs(after[key] - before[key]) <= 1, (key, before, after)
    for key in ['bodyPosition', 'bodyPadding', 'navHidden', 'navTransform']:
        assert after[key] == before[key], (key, before, after)


def assert_swipe_trace(page, before):
    page.wait_for_function('qaImageTrace.finished')
    trace = page.evaluate('qaImageTrace')
    start = trace['before']
    assert abs(start['backgroundAlpha'] - .3) < .01, start
    previous_alpha = start['effectiveAlpha']
    previous_image = start['imageOpacity'] * start['overlayOpacity']
    for frame in trace['frames']:
        assert frame['effectiveAlpha'] <= previous_alpha + .005, ('Swipe release darkened the backdrop', start, frame)
        previous_alpha = frame['effectiveAlpha']
        image_alpha = frame['imageOpacity'] * frame['overlayOpacity']
        assert image_alpha <= previous_image + .005, ('Swipe release brightened the image', start, frame)
        previous_image = image_alpha
        if frame['imageTop'] is not None:
            assert abs(frame['imageTop'] - start['imageTop']) <= 1, ('Dragged image snapped on release', start, frame)
        assert abs(frame['articleTop'] - before['articleTop']) <= 1, ('Article jumped below viewer', before, frame)
        assert frame['navHidden'] == before['navHidden'], frame
    assert_restored(page, before)


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True)
    context = browser.new_context(viewport={'width':430,'height':873}, is_mobile=True, has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    context.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true})")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin + FIXTURE_PATH)
    page.wait_for_function("window.abrirZoom && window.UnifiedNavbar?.instance && document.querySelector('#article-image').naturalWidth>0")
    page.evaluate(HELPERS)
    page.evaluate('scrollTo(0,780)')
    page.wait_for_timeout(400)
    # Exercise both prior navbar states and reduced-motion dismissal.
    for nav_visible, reduced in [(False,False),(True,False),(True,True)]:
        page.emulate_media(reduced_motion='reduce' if reduced else 'no-preference')
        page.evaluate('visible=>visible?window.UnifiedNavbar.get().showNavbar():window.UnifiedNavbar.get().hideNavbar()', nav_visible)
        page.wait_for_timeout(350)
        before = snapshot(page)
        open_image(page)
        touch(page, 'touchstart', [[215,350]])
        touch(page, 'touchmove', [[215,490]])
        page.evaluate('qaStartImageTrace()')
        touch(page, 'touchend', [[215,490]])
        assert_swipe_trace(page, before)
    page.emulate_media(reduced_motion='no-preference')
    before = snapshot(page)
    # X and Escape retain their established close/scroll-restoration path.
    for escape in [False, True]:
        open_image(page)
        if escape: page.keyboard.press('Escape')
        else: page.locator('.zoom-btn-fechar').click()
        assert_restored(page, before)
    # A gesture below the threshold and a cancelled gesture return to the image.
    for ending in ['touchend','touchcancel']:
        open_image(page)
        touch(page,'touchstart',[[215,350]])
        touch(page,'touchmove',[[215,395]])
        touch(page,ending,[[215,395]])
        page.wait_for_timeout(250)
        state = snapshot(page)
        assert state['active'] and state['backgroundAlpha'] == 1 and state['imageOpacity'] == 1, state
        page.keyboard.press('Escape')
        assert_restored(page,before)
    # Pinch/pan remains a zoom operation, not a dismissal.
    open_image(page)
    touch(page,'touchstart',[[165,350],[265,350]])
    touch(page,'touchmove',[[115,350],[315,350]])
    touch(page,'touchend',[[115,350],[315,350]])
    page.wait_for_timeout(250)
    assert 'scale(2)' in page.locator('.zoom-image').evaluate('el=>el.style.transform')
    touch(page,'touchstart',[[215,350]])
    touch(page,'touchmove',[[235,390]])
    touch(page,'touchend',[[235,390]])
    assert snapshot(page)['active'] and snapshot(page)['backgroundAlpha'] == 1
    page.keyboard.press('Escape')
    assert_restored(page,before)
    # An old close callback cannot remove a newly opened viewer.
    open_image(page)
    touch(page,'touchstart',[[215,350]])
    touch(page,'touchmove',[[215,490]])
    touch(page,'touchend',[[215,490]])
    page.evaluate("abrirZoom(document.querySelector('#article-image'))")
    page.wait_for_timeout(550)
    assert snapshot(page)['active'] and snapshot(page)['backgroundAlpha'] == 1
    assert page.locator('.zoom-image').count() == 1
    page.keyboard.press('Escape')
    assert_restored(page,before)
    if engine.name == 'chromium':
        open_image(page)
        session = context.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':215,'y':350}]})
        for y in range(370,491,20):
            session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':215,'y':y}]})
        # CDP can acknowledge a move before its coalesced touchmove reaches the
        # page. Sample after the final position, not after crossing the threshold.
        page.wait_for_function("Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.zoom-image')).transform).m42-140)<.1")
        page.evaluate('qaStartImageTrace()')
        session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        assert_swipe_trace(page,before)
        session.detach()
    assert not errors, errors
    print(json.dumps({'engine':engine.name,'swipeReleaseFrames':'passed','articleAndNavbarRestore':'passed',
                      'buttonAndEscape':'passed','cancelAndShortSwipe':'passed','pinchAndPan':'passed',
                      'rapidReopen':'passed','reducedMotion':'passed','trustedTouch':engine.name=='chromium'}))
    context.close()
    browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as playwright:
            check(playwright.chromium, '/usr/bin/chromium', origin)
            if os.getenv('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin)
    finally:
        server.shutdown()
        server.server_close()
