"""Two article cards reuse live controls and navigate actual numbered paragraphs.

Runs Chromium and, when WEBKIT_EXECUTABLE is set, desktop WebKit with a mobile
viewport. Cloud calls and annotations are synthetic; no remote account is used.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path('/workspace/scratch/article-navigation-menu')
FIXTURE = r'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/sentinela/style.css">
<link rel="stylesheet" href="/shared/typography.css">
<link rel="stylesheet" href="/sentinela/menu/menu.css">
<style>
body{--cor-principal-estudo:#65478b;--navbar-real-height:74px}
.container{margin:0 auto}.barra-estudo{position:fixed;inset:0 0 auto;height:54px;z-index:100}
main{padding-top:80px}.paragrafo{min-height:170px}.source-tail{height:900px}
.test-navbar{position:fixed;bottom:0;left:0;right:0;height:74px;z-index:1000;
background:#fff;border-top:1px solid #ddd;display:flex;align-items:center;justify-content:center}
.test-navbar button{min-height:44px;border:0;background:transparent;color:#65478b;font:600 14px sans-serif}
</style></head><body><div class="container"><div class="barra-estudo">ESTUDO DE A SENTINELA</div><main>
<h1>Continuemos a aprender</h1>
<p class="pergunta"><span>1-2.</span> Como podemos aprender?</p>
<div id="source-paragraphs"></div>
<p class="paragrafo">Um quadro sem número não é um parágrafo do estudo.</p>
<p class="paragrafo">Uma citação posterior <span>95</span> também não é o número do parágrafo.</p>
<div class="comentarios"><p class="paragrafo"><span>94</span> Comentário do leitor.</p></div>
<div class="ia-wrapper"><p class="paragrafo"><span>93</span> Resposta de IA.</p></div>
<div data-tutor-generated><p class="paragrafo"><span>92</span> Cópia do tutor.</p></div>
<div role="dialog" hidden><p class="paragrafo"><span>91</span> Cópia do modal.</p></div>
<div hidden><p class="paragrafo"><span>90</span> Conteúdo oculto.</p></div>
<p class="paragrafo" hidden><span>1</span> Duplicata oculta.</p>
<p class="paragrafo"><span>1</span> Duplicata do número original.</p>
<div class="source-tail"></div>
</main></div>
<nav class="test-navbar"><button id="nav-sentinela" onclick="SentinelaArticleMenu.toggle()">A Sentinela</button></nav>
<script>
window.estudoId='test-article';window.semanaAtual='02-11';window.qaEvents=[];window.qaCloud=[];
localStorage.setItem('supabase_user', JSON.stringify({id:'synthetic'}));
localStorage.setItem('c-test-article-1', 'Anotação sintética de teste');
window.SupabaseSync={isLoggedIn:()=>true};
window.sentinelaSync={pushMissing:async()=>{qaCloud.push('missing');return {success:true}},
pushOverwrite:async()=>{qaCloud.push('overwrite');return {success:true}}};
for (const number of [1,2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]) {
 const p=document.createElement('p');p.className='paragrafo';p.dataset.source=number;
 if(number===5 || number===12)p.id='same-source-id';
 p.innerHTML='<span>'+number+'</span> Podemos aprender ao prestar atenção, pensar no que lemos e conversar sobre o assunto. Cada parágrafo apresenta uma ideia que nos ajuda a entender o tema do estudo.';
 document.querySelector('#source-paragraphs').append(p);
}
window.addEventListener('sentinela:article-menu-state',e=>qaEvents.push(['menu',e.detail.open,scrollY]));
window.addEventListener('sentinela:paragraph-navigation',e=>qaEvents.push(['navigation',e.detail.active,scrollY]));
</script><script src="/shared/typography.js"></script>
<script src="/sentinela/menu/menu.js"></script></body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/qa-article-navigation.html':
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
    context = browser.new_context(viewport={'width': 430, 'height': 873},
                                  is_mobile=True, has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(origin + '/qa-article-navigation.html')
    page.wait_for_function('window.SentinelaArticleMenu && window.GlobalFontScale')
    page.evaluate('window.qaOriginalFontButton = document.getElementById("btn-fonte-toggle")')
    menu = page.locator('#sentinela-article-menu')

    def open_menu():
        page.locator('#nav-sentinela').tap()
        page.wait_for_function('SentinelaArticleMenu.isOpen()')

    def jump(number):
        page.evaluate('qaEvents=[]')
        page.get_by_role('button', name=f'Parágrafo {number}', exact=True).tap()
        page.wait_for_function('qaEvents.some(e=>e[0]==="navigation" && e[1]===false)')
        assert not menu.is_visible()
        events = page.evaluate('qaEvents')
        assert [event[:2] for event in events] == [['navigation', True], ['menu', False], ['navigation', False]], events
        target = page.locator(f'.paragrafo[data-source="{number}"]')
        top = target.bounding_box()['y']
        expected_top = page.locator('.barra-estudo').bounding_box()['height'] + 12
        assert abs(top - expected_top) < 2, (number, top, expected_top)
        assert target.evaluate('(el)=>document.activeElement===el')
        assert target.evaluate('(el)=>el.classList.contains("article-paragraph-arrival")')
        assert not page.locator('main').evaluate('(el)=>el.inert')

    # The original header behavior remains inline, with no extra navbar dialog.
    page.locator('.barra-estudo').tap()
    assert page.locator('main #sentinela-controles').is_visible()
    assert not menu.is_visible()
    inline_baseline = page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})')
    open_menu()
    assert page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})') == inline_baseline, (inline_baseline, page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})'))
    page.locator('#nav-sentinela').tap()
    assert page.locator('main #sentinela-controles').is_visible()
    assert page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})') == inline_baseline, (inline_baseline, page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})'))
    page.locator('.barra-estudo').tap()

    page.evaluate('scrollTo(0,700)')
    baseline = page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})')
    open_menu()
    assert page.evaluate('qaOriginalFontButton === document.getElementById("btn-fonte-toggle")')
    assert page.locator('#btn-fonte-toggle').count() == 1
    assert page.locator('main').evaluate('(el)=>el.inert')
    assert page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})') == baseline
    numbers = menu.locator('.article-menu__paragraph').all_text_contents()
    assert numbers == [str(n) for n in [1,2,3,*range(5,21)]], numbers
    assert menu.locator('.article-menu__card').count() == 2
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f'{engine.name}-light.png'))

    # The nav icon remains tappable even though the editor below is inert.
    page.locator('#nav-sentinela').tap()
    assert not menu.is_visible()
    assert page.evaluate('({y:scrollY,height:document.documentElement.scrollHeight})') == baseline
    assert page.locator('main #sentinela-controles').count() == 1
    open_menu()
    jump(12)  # Duplicate source IDs must not redirect to paragraph 5.
    open_menu()
    jump(2)   # The grouped question 1–2 yields individual paragraph buttons.

    # Same controls and listeners work from their new parent, including sheets.
    open_menu()
    menu.locator('#btn-fonte-toggle').tap()
    assert menu.locator('#font-options-area').is_visible()
    menu.locator('#range-tamanho-fonte').fill('11')
    assert page.evaluate('GlobalFontScale.getSize()') == 30
    menu.locator('#btn-tema-toggle').tap()
    assert not menu.locator('#font-options-area').is_visible()
    menu.locator('label[for="theme-dark"]').tap()
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    assert page.evaluate('localStorage.getItem("tema-interface")') == 'dark'
    menu.locator('#btn-perf-toggle').tap()
    assert page.evaluate('localStorage.getItem("editor-performance-mode")') == 'low'
    menu.locator('#btn-tema-toggle').tap()
    page.screenshot(path=str(ARTIFACTS / f'{engine.name}-dark-large-font.png'))

    before_sheet = page.evaluate('scrollY')
    menu.locator('#btn-abrir-sync').tap()
    page.wait_for_function('document.getElementById("sentinela-article-menu").inert')
    assert page.locator('#sentinelaSyncOverlay').get_attribute('aria-hidden') == 'false'
    page.keyboard.press('Escape')
    assert page.evaluate('SentinelaArticleMenu.isOpen()')
    page.locator('#sentinelaSyncRun').tap()
    page.wait_for_function('qaCloud.length===1')
    assert page.evaluate('qaCloud') == ['missing']
    page.wait_for_function('!document.getElementById("sentinela-article-menu").inert')
    assert page.evaluate('scrollY') == before_sheet

    menu.locator('#btn-exportar-bin').tap()
    with page.expect_download() as downloaded:
        page.locator('#sentinelaExportRun').tap()
    backup = json.loads(Path(downloaded.value.path()).read_text())
    assert backup['annotations']['c-test-article-1'] == 'Anotação sintética de teste'
    assert backup['preferences']['tema-interface'] == 'dark'
    menu.locator('#btn-limpar-cache').tap()
    assert page.locator('#sentinelaDeleteOverlay').is_visible()
    page.locator('#sentinelaDeleteCancel').tap()
    assert page.evaluate('SentinelaArticleMenu.isOpen()')

    # A short landscape viewport scrolls inside the cards and nested sheets.
    page.set_viewport_size({'width': 873, 'height': 430})
    assert page.locator('body').evaluate('(el)=>getComputedStyle(el).position') != 'fixed'
    geometry = menu.evaluate('''el=>({right:el.getBoundingClientRect().right,
      bottom:el.getBoundingClientRect().bottom,width:innerWidth,height:innerHeight,
      nav:document.querySelector('.test-navbar').getBoundingClientRect().top,
      pane:el.querySelector('.article-menu__scroll').getBoundingClientRect().bottom})''')
    assert geometry['right'] <= geometry['width']
    assert geometry['bottom'] <= geometry['nav'] + 1, geometry
    assert geometry['pane'] <= geometry['bottom']
    menu.locator('#btn-abrir-sync').tap()
    sheet = page.locator('#sentinelaSyncOverlay .sync-sheet')
    sheet_box = sheet.bounding_box()
    assert sheet_box['y'] >= 0 and sheet_box['height'] <= 430, sheet_box
    page.locator('#sentinelaSyncClose').tap()
    assert page.evaluate('SentinelaArticleMenu.isOpen()')
    page.screenshot(path=str(ARTIFACTS / f'{engine.name}-landscape.png'))
    page.locator('#nav-sentinela').tap()
    assert not menu.is_visible()

    # Rebuild from current source DOM on every open, without guessing a count.
    page.evaluate('''() => {const p=document.createElement('p');p.className='paragrafo';
      p.innerHTML='<span>27</span> Novo parágrafo.';document.getElementById('source-paragraphs').append(p)}''')
    page.set_viewport_size({'width':430,'height':873})
    page.emulate_media(reduced_motion='reduce')
    open_menu()
    assert menu.locator('.article-menu__paragraph').last.inner_text() == '27'
    jump(5)
    assert page.locator('.paragrafo[data-source="5"]').evaluate('(el)=>getComputedStyle(el).animationName') == 'none'
    open_menu()
    page.keyboard.press('Escape')
    assert not menu.is_visible()
    page.locator('.barra-estudo').tap()
    assert page.locator('main #sentinela-controles').is_visible()
    assert page.locator('#btn-fonte-toggle').count() == 1
    assert not errors, errors
    context.close()
    browser.close()
    print(f'PASS {engine.name}: source paragraph grid, settled jumps, live actions/sheets, no article shift, theme/font/rotation')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            origin = f'http://127.0.0.1:{server.server_port}'
            check(playwright.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
