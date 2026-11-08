"""Inline notes tools, formatting, shared reading size, and preserved notes.

Run with WEBKIT_EXECUTABLE set to also exercise WebKit. These checks use real
notes pages and synthetic notes; they do not emulate the native iPhone keyboard.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TEXT = 'Nota sintética preservada ao ajustar a fonte e alternar versões. Gênesis 1:1'


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
    page.wait_for_function('window.cacheRichText && window.GlobalFontScale && window.NotesMenu && window.NotesEditorActions')
    page.evaluate('cacheRichText.ready')
    navbar = page.locator('.bottom-navbar [data-page="notes"]')
    panel = page.locator('#notes-tools')
    editable = page.locator('#editor .paragraph-content').first
    assert editable.get_attribute('data-placeholder') == 'Semana de 2 de novembro'
    assert panel.get_attribute('aria-hidden') == 'true'
    assert panel.evaluate('(el) => el.inert')

    def tool(name):
        return panel.locator(f'[data-notes-action="{name}"]')

    def dismiss_keyboard():
        page.evaluate('document.activeElement.blur(); getSelection().removeAllRanges(); M4_Caret.updateFocus()')
        page.wait_for_timeout(420)

    def set_note(text=TEXT):
        editable.fill(text)
        page.evaluate('M12_History.flush(); cacheRichText.flush()')
        dismiss_keyboard()

    def select_word(word='sintética'):
        page.evaluate('''word => {
          const editor = document.querySelector('#editor');
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            const start = node.textContent.indexOf(word);
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start); range.setEnd(node, start + word.length);
            getSelection().removeAllRanges(); getSelection().addRange(range);
            M4_Caret.saveR();
            return;
          }
          throw new Error('Missing test selection: ' + word);
        }''', word)
        dismiss_keyboard()

    def open_panel():
        if not page.evaluate('NotesMenu.isOpen'):
            dismiss_keyboard()
            navbar.tap()
        page.wait_for_function('NotesMenu.isOpen')
        page.wait_for_timeout(320)

    set_note()
    initial_key = page.evaluate('cacheRichText.snapshot().key')
    before_top = page.locator('#editor').bounding_box()['y']
    navbar.tap()
    page.wait_for_timeout(350)
    after_top = page.locator('#editor').bounding_box()['y']
    assert after_top > before_top + 200, (before_top, after_top)
    assert panel.get_attribute('aria-hidden') == 'false'
    assert not panel.evaluate('(el) => el.inert')
    assert page.locator('#notes-versions:not([hidden])').count() == 0
    assert panel.locator('[role="dialog"]').count() == 0
    assert page.locator('#notes-diagnose-navbar, #notes-navbar-diagnostic-script').count() == 0
    assert page.evaluate('cacheRichText.snapshot().key') == initial_key
    navbar.tap()
    page.wait_for_timeout(350)
    assert panel.get_attribute('aria-hidden') == 'true'
    assert abs(page.locator('#editor').bounding_box()['y'] - before_top) < 2

    # The navbar may take focus; a subsequent action still formats the saved
    # selection, not the entire paragraph or a caret moved to the note's end.
    select_word()
    open_panel()
    tool('bold').tap()
    page.wait_for_timeout(150)
    assert editable.locator('b, strong').inner_text() == 'sintética'
    assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())
    select_word()
    tool('italic').tap()
    page.wait_for_timeout(150)
    assert editable.locator('i, em').inner_text() == 'sintética'
    assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())
    dismiss_keyboard()
    tool('undo').tap()
    page.wait_for_timeout(160)
    assert editable.locator('i, em').count() == 0
    assert editable.locator('b, strong').inner_text() == 'sintética'
    dismiss_keyboard()
    tool('redo').tap()
    page.wait_for_timeout(160)
    assert editable.locator('i, em').inner_text() == 'sintética'

    select_word()
    tool('list').tap()
    page.wait_for_timeout(150)
    assert editable.locator('ul li').count() == 1
    select_word()
    tool('list').tap()
    page.wait_for_timeout(150)
    assert editable.locator('ul').count() == 0
    select_word()
    tool('font').tap()
    panel.locator('[data-notes-style="h1"]').tap()
    page.wait_for_timeout(150)
    assert page.locator('#editor .node-paragraph.font-h1').count() == 1
    dismiss_keyboard()
    panel.locator('[data-notes-style="normal"]').tap()
    page.wait_for_timeout(150)
    assert page.locator('#editor .node-paragraph.font-h1').count() == 0

    # Both color actions use the existing picker and preserve the selected word.
    for name, prop, expected in [('textColor', 'color', 'rgb(175, 82, 222)'),
                                  ('backgroundColor', 'backgroundColor', 'rgb(255, 149, 0)')]:
        select_word()
        tool(name).tap()
        page.locator('#color-picker-overlay.open').wait_for(state='visible')
        page.locator('.picker-swatch').nth(4 if name == 'textColor' else 3).tap()
        page.locator('#picker-close').tap()
        page.wait_for_timeout(180)
        result = page.evaluate('''prop => {
          const walker = document.createTreeWalker(document.querySelector('#editor'), NodeFilter.SHOW_TEXT);
          let node; while (node = walker.nextNode()) if (node.textContent.includes('sintética')) {
            let element = node.parentElement;
            while (element && element.id !== 'editor') {
              const value = getComputedStyle(element)[prop];
              if (prop !== 'backgroundColor' || value !== 'rgba(0, 0, 0, 0)') return value;
              element = element.parentElement;
            }
          }
        }''', prop)
        assert result == expected, (name, result)
        assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())
    select_word()
    tool('reset').tap()
    page.wait_for_timeout(150)
    assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())
    assert '#af52de' not in editable.inner_html().lower()
    assert 'rgb(175, 82, 222)' not in editable.inner_html()

    # Inline block insertion is undoable through the same history as the pill.
    select_word('versões')
    tool('toggle').tap()
    page.wait_for_timeout(150)
    assert page.locator('#editor .node-toggle').count() == 1
    dismiss_keyboard()
    tool('undo').tap()
    page.wait_for_timeout(180)
    assert page.locator('#editor .node-toggle').count() == 0
    assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())

    # Reader mode remains the original mode, including its Bible preview.
    select_word('Gênesis')
    tool('reader').tap()
    page.wait_for_function('LeitorMode.isActive()')
    page.locator('#modal-biblia-fechar').wait_for(state='visible')
    page.locator('#modal-biblia-fechar').tap()
    page.wait_for_timeout(250)
    assert tool('bold').is_disabled()
    tool('reader').tap()
    page.wait_for_function('!LeitorMode.isActive()')
    assert editable.inner_text().rstrip('\n') == TEXT, (editable.inner_text(), editable.inner_html())
    dismiss_keyboard()
    page.evaluate('M4_Caret.zombieToolbar = false; M4_Caret.updateFocus()')

    # Global size follows the eleven levels without resizing the action cards.
    slider = page.locator('#notes-tools-font-level')
    if slider.is_hidden():
        tool('font').tap()
    before_button = tool('bold').evaluate('(el) => getComputedStyle(el).fontSize')
    before_key = page.evaluate('cacheRichText.snapshot().key')
    slider.press('End')
    page.wait_for_timeout(100)
    assert page.evaluate('GlobalFontScale.getSize()') == 30
    assert editable.evaluate('(el) => getComputedStyle(el).fontSize') == '30px'
    assert tool('bold').evaluate('(el) => getComputedStyle(el).fontSize') == before_button
    assert page.evaluate('cacheRichText.snapshot().key') == before_key
    page.evaluate('GlobalFontScale.setLevel(5)')
    page.wait_for_timeout(60)
    assert slider.input_value() == '5'
    slider.press('Escape')
    page.wait_for_timeout(300)
    assert panel.get_attribute('aria-hidden') == 'true'
    assert navbar.evaluate('(el) => el === document.activeElement')
    page.evaluate('GlobalFontScale.setLevel(7)')
    open_panel()
    assert slider.input_value() == '7'

    panel.locator('.notes-tools-more summary').tap()
    with page.expect_download() as download_info:
        panel.locator('#notes-tools-export').tap()
    download = download_info.value
    exported = json.loads(Path(download.path()).read_text())
    assert 'Nota' in exported['html'] and 'versões' in exported['html']
    assert download.suggested_filename == 'anotacoes-02-11.json'
    panel.locator('#notes-tools-version-1').tap()
    page.wait_for_url('**/container-v1.html?semana=02-11&versao=1')
    page.wait_for_function('window.cacheRichText && window.NotesVersions')
    assert TEXT in page.locator('#editor').inner_text()
    navbar.tap()
    assert page.locator('#notes-font-level').input_value() == '7'
    page.locator('#notes-version-2').tap()
    page.wait_for_url('**/container.html?semana=02-11&versao=2')
    page.wait_for_function('window.NotesMenu')
    assert TEXT in page.locator('#editor').inner_text()

    # A long note is scrolled only when the tools are explicitly requested.
    set_note('\n'.join(f'Linha {index}: anotação sintética preservada.' for index in range(45)))
    page.evaluate('editorScroll.scrollTop=700')
    page.wait_for_timeout(100)
    assert page.evaluate('editorScroll.scrollTop') > 500
    open_panel()
    assert page.evaluate('editorScroll.scrollTop') < 2
    page.evaluate('editorScroll.scrollTop=240')
    page.wait_for_timeout(350)
    assert page.evaluate('editorScroll.scrollTop') >= 230
    page.evaluate('NotesMenu.close()')
    page.wait_for_timeout(300)

    # The panel stays in normal flow on small screens; controls are reachable
    # by scrolling the existing editor scroller rather than a second modal.
    page.set_viewport_size({'width': 320, 'height': 568})
    open_panel()
    tool('font').tap()
    page.evaluate('GlobalFontScale.setLevel(11)')
    for theme in ['light', 'dark']:
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        page.wait_for_timeout(250)
        geometry = panel.evaluate('''el => {
          const rect=el.getBoundingClientRect();
          const scroller=document.querySelector('#editorScroll');
          return {left:rect.left,right:rect.right,scrollWidth:scroller.scrollWidth,
            clientWidth:scroller.clientWidth,position:getComputedStyle(el).position,
            fontSize:getComputedStyle(el).fontSize};
        }''')
        assert geometry['left'] >= 0 and geometry['right'] <= 320, geometry
        assert geometry['scrollWidth'] <= geometry['clientWidth'] + 1, geometry
        assert geometry['position'] == 'static' and geometry['fontSize'] == '14px', geometry
        slider.scroll_into_view_if_needed()
        assert slider.is_visible()
        page.locator('#notes-tools-close').scroll_into_view_if_needed()
        assert page.locator('#notes-tools-close').is_visible()

    # A real touch scroll beginning on an action must not format the note.
    # Chromium exposes trusted touch injection through CDP; WebKit does not.
    if engine.name == 'chromium':
        page.evaluate('editorScroll.scrollTop=0')
        page.wait_for_timeout(120)
        bounds = tool('bold').bounding_box()
        x, y = bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] / 2
        before_html = page.locator('#editor').inner_html()
        session = context.new_cdp_session(page)
        session.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':x, 'y':y, 'id':1}]})
        for step in range(1, 6):
            session.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':[{'x':x, 'y':y-step*15, 'id':1}]})
            page.wait_for_timeout(20)
        session.send('Input.dispatchTouchEvent', {'type':'touchEnd', 'touchPoints':[]})
        page.wait_for_timeout(250)
        assert page.evaluate('editorScroll.scrollTop') > 10
        assert page.locator('#editor').inner_html() == before_html
        session.detach()

    assert not errors, errors
    context.close()
    browser.close()
    return {'browser': engine.name, 'inline_layout_toggle': 'passed',
            'formatting_and_history': 'passed', 'color_and_reader': 'passed',
            'font_levels': 'passed', 'export_and_versions': 'passed',
            'small_screen_and_long_note': 'passed'}


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
                print(json.dumps(check(engine, executable, origin)), flush=True)
    finally:
        server.shutdown()
