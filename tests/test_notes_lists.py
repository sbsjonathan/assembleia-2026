"""Ordered-list behavior in the real notes editor, including native Enter and saving.

Set WEBKIT_EXECUTABLE to also exercise WebKit. Uses synthetic notes only.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ITEMS = ['Primeiro item', 'Segundo item', 'Terceiro item']


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
    page.wait_for_function('!!window.cacheRichText && typeof window.NotesEditorActions?.orderedList === "function"')
    page.evaluate('cacheRichText.ready')
    editable = page.locator('#editor .paragraph-content').first
    editable.fill(ITEMS[0])
    page.keyboard.press('End')
    page.evaluate('M4_Caret.saveR(); NotesEditorActions.orderedList()')
    assert editable.locator('ol li').all_text_contents() == ITEMS[:1]
    assert page.evaluate('NotesEditorActions.getListType()') == 'ordered'
    assert page.locator('#kbdToolbar [aria-label="Lista"]').get_attribute('aria-pressed') == 'false'

    # Native Enter creates successive LI elements; empty Enter exits the list.
    for item in ITEMS[1:]:
        page.keyboard.press('End')
        page.keyboard.press('Enter')
        page.keyboard.type(item)
    assert editable.locator('ol li').all_text_contents() == ITEMS
    assert editable.locator('ol').evaluate('(el) => getComputedStyle(el).listStyleType') == 'decimal'
    assert editable.locator('ol').evaluate('(el) => el.start === 1 && !el.reversed')
    page.keyboard.press('End')
    page.keyboard.press('Enter')
    page.keyboard.press('Enter')
    page.keyboard.type('Fora da lista')
    assert editable.locator('ol li').all_text_contents() == ITEMS
    assert page.evaluate('NotesEditorActions.getListType()') is None
    assert 'Fora da lista' in editable.inner_text()

    def select_list(kind):
        page.evaluate('''kind => {
          const list = document.querySelector('#editor ' + kind);
          const range = document.createRange(); range.selectNodeContents(list);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          M4_Caret.saveR();
        }''', kind)

    # Change the whole list, preserving item text, formatting scope and history.
    select_list('ol')
    page.evaluate('M12_History.flush(); NotesEditorActions.list()')
    page.wait_for_timeout(150)
    assert editable.locator('ol').count() == 0
    assert editable.locator('ul li').all_text_contents() == ITEMS
    assert page.evaluate('NotesEditorActions.getListType()') == 'unordered'
    assert page.locator('#kbdToolbar [aria-label="Lista"]').get_attribute('aria-pressed') == 'true'
    page.evaluate('M12_History.undo()')
    page.wait_for_timeout(200)
    assert editable.locator('ol li').all_text_contents() == ITEMS
    assert editable.locator('ul').count() == 0
    page.evaluate('M12_History.redo()')
    page.wait_for_timeout(200)
    assert editable.locator('ul li').all_text_contents() == ITEMS
    select_list('ul')
    page.evaluate('NotesEditorActions.orderedList()')
    page.wait_for_timeout(150)
    assert editable.locator('ol li').all_text_contents() == ITEMS
    assert editable.locator('ul').count() == 0

    # A panel focus can hide the live selection; its last valid range still
    # identifies the list type without restoring focus or moving the caret.
    page.evaluate('''() => {
      const node = document.querySelector('#editor ol li').firstChild;
      const range = document.createRange(); range.selectNodeContents(node);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      M4_Caret.saveR(); document.activeElement.blur(); getSelection().removeAllRanges();
    }''')
    assert page.evaluate('NotesEditorActions.getListType()') == 'ordered'
    page.evaluate('cacheRichText.flush()')
    page.reload()
    page.wait_for_function('window.cacheRichText && document.querySelectorAll("#editor ol li").length===3')
    assert editable.locator('ol li').all_text_contents() == ITEMS
    assert 'Fora da lista' in editable.inner_text()
    assert page.locator('#kbdToolbar .tool-btn').count() == 11
    assert page.locator('#kbdToolbar [aria-label*="numerad"]').count() == 0

    # Removing numbered-list formatting returns the same text to plain blocks.
    select_list('ol')
    page.evaluate('NotesEditorActions.orderedList()')
    page.wait_for_timeout(150)
    assert editable.locator('ol, ul').count() == 0
    for text in [*ITEMS, 'Fora da lista']:
        assert text in editable.inner_text()
    assert not errors, errors
    browser.close()
    return {'browser': engine.name, 'numbered_enter_and_exit': 'passed',
            'list_conversion_and_history': 'passed', 'saved_selection': 'passed',
            'reload_preserves_list': 'passed', 'text_preserved': 'passed'}


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
