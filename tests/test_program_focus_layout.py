"""Full-program focus geometry with all application scripts and local assets.

Run with WEBKIT_EXECUTABLE to include WebKit. This reproduces layout changes
that affect native keyboard reveal; it does not emulate the iPhone keyboard.
Only synthetic notes are used, and external services are blocked.
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


GEOMETRY = """() => ({
  scrollY, height: document.documentElement.scrollHeight,
  padding: parseFloat(getComputedStyle(document.body).paddingBottom),
  field: target.getBoundingClientRect().toJSON(),
  innerScroll: target.closest('.anotacao-asmb-inner').scrollTop
})"""


def check(engine, executable, origin, standalone):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873},
                                  is_mobile=True, has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_()
                  if route.request.url.startswith(origin + '/') else route.abort())
    if standalone:
        context.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true});")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin + '/index.html')
    page.wait_for_function('window.AssemblyProgram && window.AssembleiaClickables && window.GlobalFontScale && document.querySelector(".bottom-navbar")')
    page.evaluate('document.fonts.ready')
    if standalone:
        # Desktop WebKit has no physical home-indicator safe area. Reserve the
        # same bottom inset as the reported installed iPhone PWA.
        page.add_style_tag(content=':root { --navbar-safe-bottom: 34px; }')
    page.evaluate("AssemblyProgram.selectTab('perguntas',{scroll:false})")
    page.evaluate("""() => {
      document.querySelectorAll('#perguntas .anotacao-asmb').forEach(note => note.__trigger.click());
      window.target = [...document.querySelectorAll('#perguntas .clickable-asmb')].at(-1);
      target.textContent = 'Anotação de teste';
      target.classList.remove('is-empty');
    }""")
    page.wait_for_timeout(400)
    page.evaluate('scrollTo(0,document.documentElement.scrollHeight)')
    page.wait_for_timeout(100)
    before = page.evaluate(GEOMETRY)
    assert before['padding'] > 40, before
    # preventScroll isolates the application-induced clamp from intentional
    # native focus scrolling. Before the repair this moved the field by 69px.
    page.evaluate('target.focus({preventScroll:true})')
    page.wait_for_timeout(200)
    after = page.evaluate(GEOMETRY)
    assert abs(after['padding'] - before['padding']) < 1, (before, after)
    assert after['height'] == before['height'], (before, after)
    assert abs(after['scrollY'] - before['scrollY']) < 1, (before, after)
    assert abs(after['field']['top'] - before['field']['top']) < 1, (before, after)
    assert page.locator('.bottom-navbar').evaluate("el => el.classList.contains('hidden')")
    page.evaluate('target.blur()')
    page.wait_for_timeout(200)
    dismissed = page.evaluate(GEOMETRY)
    assert dismissed['height'] == before['height'], (before, dismissed)
    assert abs(dismissed['scrollY'] - before['scrollY']) < 1, (before, dismissed)
    assert not page.locator('.bottom-navbar').evaluate("el => el.classList.contains('hidden')")

    # A visually folded contenteditable must not be reachable by keyboard Next,
    # tabbing, or a browser focus request. Exercise the production toggle path.
    page.evaluate("""() => {
      AssemblyProgram.selectTab('manha',{scroll:false});
      window.target = document.querySelector('#manha .clickable-asmb');
      window.note = target.closest('.anotacao-asmb');
      note.__trigger.click(); target.focus({preventScroll:true});
    }""")
    page.wait_for_timeout(100)
    for _ in range(10):
        page.keyboard.press('Tab')
        assert page.evaluate("""() => {
          const note = document.activeElement.closest('.anotacao-asmb');
          return !note || note.classList.contains('ativa');
        }"""), 'Keyboard focus entered a collapsed note.'
    assert page.evaluate("""() => [...document.querySelectorAll('#manha .anotacao-asmb:not(.ativa) .clickable-asmb')].every(editor => {
      editor.focus({preventScroll:true}); return document.activeElement !== editor;
    })"""), 'A collapsed field accepted focus.'

    # Focus during opening must not scroll a hidden wrapper, then jump again
    # when the animation finishes. This reproduced 11–12px in both engines.
    page.evaluate("""() => {
      document.activeElement.blur();
      if (note.classList.contains('ativa')) note.__trigger.click();
      AssembleiaIA.saveInlineDraft(target.dataset.id, 'Texto de teste');
    }""")
    page.wait_for_timeout(350)
    page.evaluate('note.__trigger.click()')
    page.wait_for_timeout(30)
    assert page.evaluate("""() => {
      const inner = target.closest('.anotacao-asmb-inner');
      inner.scrollTop = 20;
      return inner.scrollTop === 0;
    }"""), 'The folding wrapper consumed caret reveal as an inner scroll.'
    page.evaluate('target.focus()')
    focused = page.evaluate(GEOMETRY)
    page.wait_for_timeout(400)
    settled = page.evaluate(GEOMETRY)
    assert focused['innerScroll'] == settled['innerScroll'] == 0
    assert abs(focused['field']['top'] - settled['field']['top']) < 1, (focused, settled)
    assert abs(focused['field']['height'] - settled['field']['height']) < 1, (focused, settled)

    # The placeholder is presentation, not an editable line. Large fonts and
    # an empty native DIV/BR must not make the first character shrink the box.
    placeholder_cases = []
    for width in (430, 320):
        page.set_viewport_size({'width': width, 'height': 873})
        for level in (3, 11):
            page.evaluate('(level) => GlobalFontScale.setLevel(level)', level)
            page.wait_for_timeout(250)
            for blank in ('', '<br>', '<div><br></div>'):
                page.evaluate("""html => {
                  target.innerHTML = html;
                  target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
                }""", blank)
                empty = page.evaluate('target.getBoundingClientRect().height')
                page.locator('#manha .clickable-asmb').first.fill('A')
                typed = page.evaluate('target.getBoundingClientRect().height')
                assert abs(empty - typed) < 1, (width, level, blank, empty, typed)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                placeholder_cases.append({'width': width, 'level': level, 'blank': blank,
                                          'emptyHeight': empty, 'typedHeight': typed})

    assert not errors, errors
    browser.close()
    return {'browser': engine.name, 'standalone': standalone,
            'bottomReserve': before['padding'], 'focusDoesNotClampDocument': 'passed',
            'foldedFieldsExcludedFromFocus': 'passed', 'openingHasNoNestedScroll': 'passed',
            'placeholderCases': placeholder_cases}


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
                for standalone in (False, True):
                    print(json.dumps(check(engine, executable, origin, standalone)), flush=True)
    finally:
        server.shutdown()
