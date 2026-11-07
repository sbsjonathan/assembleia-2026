"""Notes options, shared reading size, and data-preserving version switches.

Run with WEBKIT_EXECUTABLE set to also exercise WebKit. These browser checks
cover the real notes pages; they do not emulate the native iPhone keyboard.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873},
                                  is_mobile=True, has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin + '/richtext/container.html?semana=02-11&versao=2')
    page.wait_for_function('window.cacheRichText && window.GlobalFontScale && window.NotesVersions')
    editor = page.locator('#editor .paragraph-content').first
    editor.fill('Nota sintética preservada ao ajustar a fonte e alternar versões.')
    page.evaluate('document.activeElement.blur(); cacheRichText.flush()')
    page.wait_for_timeout(450)
    before = page.evaluate('cacheRichText.snapshot().key')

    # Use the real active navbar entry, rather than calling the menu API.
    page.locator('.bottom-navbar [data-page="notes"]').click()
    page.locator('#notes-font-level').wait_for(state='visible')
    assert page.locator('#notes-diagnose-navbar').count() == 0
    assert page.locator('#notes-navbar-diagnostic-script').count() == 0
    assert page.locator('#notes-font-level').input_value() == '3'
    assert page.locator('#notes-font-level').get_attribute('aria-valuetext') == 'Nível 3 de 11, padrão'
    assert page.locator('.notes-font-ticks i').count() == 11
    page.locator('#notes-versions-close').press('Tab')
    assert page.locator('#notes-font-level').evaluate('(el) => el === document.activeElement')
    page.locator('#notes-font-level').press('End')
    assert page.evaluate('GlobalFontScale.getSize()') == 30
    assert editor.evaluate('(el) => getComputedStyle(el).fontSize') == '30px'
    assert page.locator('.notes-version-card').evaluate('(el) => getComputedStyle(el).fontSize') == '15px'
    page.wait_for_timeout(150)
    assert not page.locator('body').evaluate('(el) => el.classList.contains("navbar-is-hidden")')
    assert page.evaluate('cacheRichText.snapshot().key') == before

    # Other settings panels / storage refreshes must update an already-open menu.
    page.evaluate('GlobalFontScale.setLevel(5)')
    assert page.locator('#notes-font-level').input_value() == '5'
    assert page.locator('#notes-font-level').get_attribute('aria-valuetext') == 'Nível 5 de 11'
    page.locator('#notes-font-level').press('Escape')
    assert page.locator('#notes-versions').is_hidden()
    assert page.locator('.bottom-navbar [data-page="notes"]').evaluate('(el) => el === document.activeElement')
    page.evaluate('GlobalFontScale.setLevel(7)')
    page.locator('.bottom-navbar [data-page="notes"]').click()
    assert page.locator('#notes-font-level').input_value() == '7'

    # Keep all useful export and version functions. Verify an actual download.
    with page.expect_download() as download_info:
        page.locator('#notes-export-current').click()
    download = download_info.value
    exported = json.loads(Path(download.path()).read_text())
    assert 'Nota sintética preservada' in exported['html']
    assert download.suggested_filename == 'anotacoes-02-11.json'
    page.locator('#notes-version-1').click()
    page.wait_for_url('**/container-v1.html?semana=02-11&versao=1')
    page.wait_for_function('window.cacheRichText && window.NotesVersions')
    assert 'Nota sintética preservada' in page.locator('#editor').inner_text()
    page.locator('.bottom-navbar [data-page="notes"]').click()
    assert page.locator('#notes-font-level').input_value() == '7'
    page.locator('#notes-font-level').press('Home')
    assert page.evaluate('GlobalFontScale.getLevel()') == 1
    page.locator('#notes-version-2').click()
    page.wait_for_url('**/container.html?semana=02-11&versao=2')
    assert 'Nota sintética preservada' in page.locator('#editor').inner_text()
    page.locator('.bottom-navbar [data-page="notes"]').click()
    assert page.locator('#notes-font-level').input_value() == '1'

    # Small screens can scroll the menu body without losing its close control.
    page.set_viewport_size({'width': 320, 'height': 568})
    page.evaluate('GlobalFontScale.setLevel(11)')
    for theme in ['light', 'dark']:
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        page.wait_for_timeout(350)
        geometry = page.evaluate('''() => {
          const card = document.querySelector('.notes-version-card').getBoundingClientRect();
          const close = document.querySelector('#notes-versions-close').getBoundingClientRect();
          const body = document.querySelector('.notes-version-body');
          return {left:card.left, right:card.right, top:card.top, bottom:card.bottom,
            closeTop:close.top, closeBottom:close.bottom, bodyHeight:body.clientHeight,
            bodyOverflow:getComputedStyle(body).overflowY,
            bg:getComputedStyle(document.querySelector('.notes-font-control')).backgroundColor};
        }''')
        assert geometry['left'] >= 0 and geometry['right'] <= 320, geometry
        assert geometry['top'] >= 0 and geometry['bottom'] <= 568, geometry
        assert 0 <= geometry['closeTop'] < geometry['closeBottom'] <= 568, geometry
        assert geometry['bodyHeight'] > 0 and geometry['bodyOverflow'] == 'auto', geometry
        assert geometry['bg'] == ('rgb(248, 246, 250)' if theme == 'light' else 'rgb(44, 39, 51)'), geometry

    assert not errors, errors
    context.close()
    browser.close()
    return {'browser': engine.name, 'notes_menu': 'passed', 'font_levels': 'passed',
            'export_and_versions': 'passed', 'small_screen_and_themes': 'passed'}


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            engines = [(playwright.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'))]
            if os.environ.get('WEBKIT_EXECUTABLE'):
                engines.append((playwright.webkit, os.environ['WEBKIT_EXECUTABLE']))
            for engine, executable in engines:
                print(json.dumps(check(engine, executable, origin)))
    finally:
        server.shutdown()
