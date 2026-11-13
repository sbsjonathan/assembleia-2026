"""Navbar reading gestures, hysteresis and restoration in mobile browser layouts.

Loads the real bundled Bible and production navbar. Exact-distance cases use
synthetic gesture intent with browser scrolling; Chromium additionally exercises
trusted wheel and touch input. WebKit is a desktop test build, not an iPhone PWA.
"""
import json
import os
from http.server import ThreadingHTTPServer
from threading import Thread

from playwright.sync_api import sync_playwright
from test_bible_typography import Handler as BibleHandler, SEED_WEBKIT, open_chapter

ARTICLE = '/sentinela/artigos/qa-navbar.html'
MENU_ARTICLE = '/sentinela/artigos/qa-navbar-menu.html'
FIXTURE = '''<!doctype html><html lang="pt-BR" data-program-year="2026"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="{prefix}/navbar/navbar-unified.css">
<style>html{{overflow-y:scroll}}body{{margin:0}}main{{padding:24px}}.paragrafo{{height:600px}}
#field{{position:fixed;top:120px;left:25px;width:200px}}dialog{{height:200px;overflow:auto}}</style>
</head><body {attributes}><main><h1>Programa ou artigo de teste</h1>{paragraphs}</main>
<input id="field" aria-label="Anotação"><dialog id="sheet"><p style="height:900px">Referência</p></dialog>
<script src="{prefix}/navbar/navbar-unified.js"></script></body></html>'''


class Handler(BibleHandler):
    def do_GET(self):
        original_path = self.path
        path = self.path.split('?', 1)[0]
        prefix = '/sentinela-2026' if path.startswith('/sentinela-2026/') else ''
        relative = path[len(prefix):]
        fixtures = [ARTICLE, MENU_ARTICLE, '/index.html', '/save/auth-supabase.html', '/richtext/container.html',
                    '/estudos.html', '/sentinela/artigos/estudo.html']
        if relative in fixtures:
            attributes = 'class="assembly-home"' if relative == '/index.html' else ''
            # A catalogue has no article paragraphs, even if a stale menu API exists.
            paragraphs = ''.join(f'<p class="paragrafo"><span>{n}</span> Texto para leitura</p>' for n in range(1, 10))
            if relative == '/estudos.html':
                paragraphs = '<div style="height:4000px">Revistas</div>'
            document = FIXTURE.format(prefix=prefix, attributes=attributes, paragraphs=paragraphs)
            if relative == MENU_ARTICLE:
                document = document.replace('</head>', '<link rel="stylesheet" href="/sentinela/menu/menu.css"></head>')
                document = document.replace('<main>', '<div class="barra-estudo">Estudo de A Sentinela</div><main>')
                document = document.replace('</body>', '<script src="/sentinela/menu/menu.js"></script></body>')
            data = document.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if prefix:
            self.path = self.path[len(prefix):]
        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            # A chapter navigation can cancel an in-flight local asset.
            pass
        finally:
            self.path = original_path


def state(page):
    return page.evaluate('''() => ({hidden:window.UnifiedNavbar.get().isHidden, y:scrollY,
      layout:getComputedStyle(document.documentElement).getPropertyValue('--navbar-layout-bottom'),
      padding:getComputedStyle(document.body).paddingBottom,
      context:window.UnifiedNavbar.get().currentPage, anchor:window.UnifiedNavbar.get()._scrollAnchor})''')


def place(page, y=300):
    page.evaluate('y=>{window.UnifiedNavbar.get().resetScrollTracking();scrollTo(0,y);}', y)
    page.wait_for_timeout(60)
    page.evaluate('()=>{window.UnifiedNavbar.get().showNavbar();window.UnifiedNavbar.get().resetScrollTracking();}')


def scroll(page, delta):
    # Browser layout/scroll delivery are real. The synthetic intent keeps the
    # exact threshold independent of an engine's wheel interpolation.
    page.evaluate('''delta=>{dispatchEvent(new WheelEvent('wheel',{deltaY:delta}));scrollBy(0,delta);}''', delta)
    page.wait_for_timeout(50)


def thresholds(page):
    place(page)
    before = state(page)
    for delta in [30, 30, -5, 40]:
        scroll(page, delta)
        assert not state(page)['hidden'], state(page)
    scroll(page, 5)
    assert state(page)['hidden'], state(page)
    # Tiny reverse movements do not reveal the dock or restart a hide animation.
    for delta in [-15, 5, -20, -9]:
        scroll(page, delta)
        assert state(page)['hidden'], state(page)
    scroll(page, -1)
    assert not state(page)['hidden'], state(page)
    after = state(page)
    assert before['layout'] == after['layout'] and before['padding'] == after['padding']
    scroll(page, 99)
    assert not state(page)['hidden'], state(page)
    scroll(page, 1)
    assert state(page)['hidden'], state(page)
    # Page top and short documents cannot strand navigation offscreen.
    scroll(page, -10000)
    assert state(page)['y'] == 0 and not state(page)['hidden'], state(page)
    place(page)


def restorations(page):
    place(page)
    page.evaluate('scrollTo(0,900)')
    page.wait_for_timeout(80)
    assert not state(page)['hidden'], 'Reading-position restore counted as a gesture'
    scroll(page, 100)
    assert state(page)['hidden']
    page.evaluate('scrollTo(0,500)')
    page.wait_for_timeout(80)
    assert state(page)['hidden'], 'Programmatic return revealed the dock'
    scroll(page, -39)
    assert state(page)['hidden']
    scroll(page, -1)
    assert not state(page)['hidden']
    # The stacked article menu and its paragraph navigation own their scrolling.
    page.evaluate("document.dispatchEvent(new CustomEvent('sentinela:article-menu-state',{detail:{open:true}}))")
    scroll(page, 500)
    assert not state(page)['hidden']
    page.evaluate('''() => {
      document.dispatchEvent(new CustomEvent('sentinela:paragraph-navigation',{detail:{active:true}}));
      document.dispatchEvent(new CustomEvent('sentinela:article-menu-state',{detail:{open:false}}));
    }''')
    scroll(page, 900)
    assert not state(page)['hidden']
    page.evaluate("document.dispatchEvent(new CustomEvent('sentinela:paragraph-navigation',{detail:{active:false}}))")
    scroll(page, 99)
    assert not state(page)['hidden']
    scroll(page, 1)
    assert state(page)['hidden']
    # Keep precisely the navbar state that existed before the image viewer.
    page.evaluate("document.dispatchEvent(new CustomEvent('sentinela:image-viewer-state',{detail:{active:true}}))")
    scroll(page, -600)
    page.evaluate("document.dispatchEvent(new CustomEvent('sentinela:image-viewer-state',{detail:{active:false}}));document.dispatchEvent(new Event('sentinela:image-viewer-closed'))")
    page.wait_for_timeout(100)
    assert state(page)['hidden']
    scroll(page, -39)
    assert state(page)['hidden']
    scroll(page, -1)
    assert not state(page)['hidden']
    # Body scroll locks and native dialogs must not contaminate the next gesture.
    page.evaluate("document.body.style.position='fixed'")
    scroll(page, 500)
    page.evaluate("document.body.style.position='';window.UnifiedNavbar.get().resetScrollTracking()")
    assert not state(page)['hidden']
    page.evaluate("document.querySelector('#sheet').showModal()")
    scroll(page, 150)
    assert not state(page)['hidden']
    page.evaluate("document.querySelector('#sheet').close()")
    scroll(page, 99)
    assert not state(page)['hidden']
    scroll(page, 1)
    assert state(page)['hidden']
    place(page)
    # Appending content and its accompanying scroll are layout, not reading.
    page.evaluate("document.querySelector('main').append(Object.assign(document.createElement('div'),{style:'height:600px'}))")
    page.evaluate('scrollBy(0,500)')
    page.wait_for_timeout(60)
    assert not state(page)['hidden']
    scroll(page, 99)
    assert not state(page)['hidden']
    scroll(page, 1)
    assert state(page)['hidden']


def keyboard(page):
    place(page)
    page.locator('#field').focus()
    page.wait_for_timeout(40)
    assert state(page)['hidden']
    scroll(page, 400)
    scroll(page, -80)
    assert state(page)['hidden']
    page.locator('#field').blur()
    page.wait_for_timeout(120)
    assert not state(page)['hidden']
    scroll(page, 99)
    assert not state(page)['hidden']
    scroll(page, 1)
    assert state(page)['hidden']
    page.set_viewport_size({'width':430,'height':800})
    page.wait_for_timeout(60)
    assert state(page)['hidden']
    scroll(page, -39)
    assert state(page)['hidden']
    scroll(page, -1)
    assert not state(page)['hidden']
    page.set_viewport_size({'width':430,'height':873})
    place(page)


def article_menu(page, base):
    page.goto(base + MENU_ARTICLE)
    page.wait_for_function('window.SentinelaArticleMenu && window.UnifiedNavbar?.get()?.navbar')
    place(page, 900)
    original_url = page.url
    active_tab = page.locator('.navbar-item[data-page="watchtower"]')
    active_tab.click()
    page.wait_for_function('SentinelaArticleMenu.isOpen()')
    assert page.evaluate('window.UnifiedNavbar.get()._articleMenuOpen')
    assert not state(page)['hidden'] and page.url == original_url
    page.get_by_role('button', name='Parágrafo 7', exact=True).click()
    page.wait_for_function('!window.UnifiedNavbar.get()._paragraphNavigationActive')
    assert not page.evaluate('SentinelaArticleMenu.isOpen()')
    assert not page.evaluate('window.UnifiedNavbar.get()._articleMenuOpen')
    assert state(page)['y'] > 3000 and not state(page)['hidden'], state(page)
    scroll(page, 99)
    assert not state(page)['hidden'], state(page)
    scroll(page, 1)
    assert state(page)['hidden'], state(page)
    scroll(page, -40)
    assert not state(page)['hidden']
    active_tab.click()
    assert page.evaluate('SentinelaArticleMenu.isOpen()')
    active_tab.click()
    assert not page.evaluate('SentinelaArticleMenu.isOpen()')


def run(engine, executable, base):
    browser = engine.launch(executable_path=executable, headless=True)
    context = browser.new_context(viewport={'width':430,'height':873}, is_mobile=True,
                                  has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + ARTICLE)
    page.wait_for_function('window.UnifiedNavbar?.get()?.navbar && !document.querySelector(".bottom-navbar.booting")')
    thresholds(page)
    restorations(page)
    keyboard(page)
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.bottom-navbar').evaluate('el=>getComputedStyle(el).transitionDuration') == '0s'
    thresholds(page)
    page.emulate_media(reduced_motion='no-preference')
    assert '0.3s' in page.locator('.bottom-navbar').evaluate('el=>getComputedStyle(el).transitionDuration')
    if engine.name == 'chromium':
        place(page)
        page.mouse.move(300, 500)
        page.mouse.wheel(0, 120)
        page.wait_for_function('window.UnifiedNavbar.get().isHidden')
        page.mouse.wheel(0, -50)
        page.wait_for_function('!window.UnifiedNavbar.get().isHidden')
        place(page)
        session = context.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':300,'y':600}]})
        for y in range(580, 359, -20):
            session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':300,'y':y}]})
        page.wait_for_function('window.UnifiedNavbar.get().isHidden')
        session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        session.detach()
    # The active article icon opens the menu, including on older article dates.
    place(page)
    page.evaluate('window.menuToggles=0;window.SentinelaArticleMenu={toggle(){window.menuToggles++}}')
    old_url = page.url
    page.locator('.navbar-item[data-page="watchtower"]').click()
    assert page.evaluate('menuToggles') == 1 and page.url == old_url
    article_menu(page, base)
    for prefix in ['', '/sentinela-2026']:
        for path, expected in [('/index.html','home'),('/save/auth-supabase.html','save'),('/richtext/container.html','notes')]:
            page.goto(base + prefix + path)
            page.wait_for_function('window.UnifiedNavbar?.get()?.navbar')
            place(page)
            assert state(page)['context'] == expected, state(page)
            scroll(page, 700)
            scroll(page, -400)
            assert not state(page)['hidden'], (path, state(page))
    page.goto(base + '/estudos.html')
    page.evaluate('window.SentinelaArticleMenu={toggle(){throw new Error("Catalogue opened article menu")}}')
    page.locator('.navbar-item[data-page="watchtower"]').click()
    page.wait_for_url('**/sentinela/artigos/estudo.html?d=*')
    # Load the actual chapter app, not a lookalike scroll container.
    if engine.name == 'webkit':
        page.goto(base + '/__qa__/seed.html')
        page.evaluate(SEED_WEBKIT)
    open_chapter(page, base, 48, 5)
    assert state(page)['context'] == 'bible'
    assert page.locator('#reader').evaluate('el=>getComputedStyle(el).overflowY') == 'visible'
    thresholds(page)
    # Bible notes are nested scrolling surfaces and leave the document dock alone.
    page.locator('.note-marker.reference').first.click()
    page.wait_for_selector('#note-dialog[open]')
    before = state(page)
    page.evaluate("document.querySelector('#note-body').scrollTop=200")
    page.wait_for_timeout(60)
    assert state(page)['hidden'] == before['hidden']
    page.locator('#note-close').click()
    page.wait_for_selector('#note-dialog', state='hidden')
    # The Watchtower-active Bible reference screen still navigates to the article.
    page.evaluate('''()=>{document.body.dataset.studyReferenceContext='article';
      document.dispatchEvent(new Event('sentinela:reference-context'));
      document.querySelector('main').append(Object.assign(document.createElement('p'),{className:'paragrafo'}));
      window.qaReferenceReturns=0;
      document.addEventListener('sentinela:return-to-article',()=>window.qaReferenceReturns++);
      window.SentinelaArticleMenu={toggle(){throw new Error('Bible reference opened article menu')}};}''')
    place(page, 0)
    assembly_route = page.evaluate('Boolean(window.AssemblyCurrentStudy)')
    page.locator('.navbar-item[data-page="watchtower"]').click()
    if assembly_route:
        page.wait_for_url('**/sentinela/artigos/estudo.html?d=*')
    else:
        # The original Sentinela keeps its return-to-source reference action.
        assert page.evaluate('window.qaReferenceReturns') == 1
    assert not errors, errors
    print(json.dumps({'engine':engine.name,'thresholds':'100px hide / 40px show',
                      'fixedPages':'home, save, notes','realBible':'passed','menuAndRestores':'passed',
                      'keyboardFocusAndViewport':'passed','reducedMotion':'passed',
                      'trustedWheelAndTouch':engine.name=='chromium'}))
    context.close()
    browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        base = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as playwright:
            run(playwright.chromium, '/usr/bin/chromium', base)
            if os.getenv('WEBKIT_EXECUTABLE'):
                Handler.webkit_adapter = True
                run(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], base)
    finally:
        server.shutdown()
        server.server_close()
