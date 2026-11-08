"""Native inline-editor focus, selection and visual-viewport regression checks.

Run: python tests/test_program_caret.py
Set WEBKIT_EXECUTABLE to also run WebKit. Viewport changes are simulated;
these checks do not emulate the native iPhone keyboard or its selection UI.
"""
import json
import os
import re
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

    def do_GET(self):
        if self.path != '/caret-fixture.html':
            return super().do_GET()
        # Keep the real programme HTML/CSS, storage, navbar and inline editor.
        html = re.sub(r'<script\b[^>]*>.*?</script>', '', (ROOT / 'index.html').read_text(), flags=re.S | re.I)
        scripts = ''.join(f'<script src="{src}"></script>' for src in [
            'assembleia/anotacoes/agente-ia.js', 'navbar/navbar-unified.js',
            'assembleia/anotacoes/clickable/click-asmb.js'])
        data = html.replace('</body>', scripts + '</body>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


VIEWPORT = """(() => {
    const viewport = Object.assign(new EventTarget(), {height:873, width:430, offsetTop:0, offsetLeft:0, scale:1});
    Object.defineProperty(window, 'visualViewport', {configurable:true, value:viewport});
    window.testViewport = (height, top=0, event='resize') => {
        Object.assign(viewport, {height, offsetTop:top});
        viewport.dispatchEvent(new Event(event));
    };
    const scrollBy = window.scrollBy.bind(window), scrollTo = window.scrollTo.bind(window);
    window.caretScrolls = [];
    window.positionTestScroll = scrollTo;
    window.scrollBy = (...args) => { caretScrolls.push({method:'by', args}); scrollBy(...args); };
    window.scrollTo = (...args) => { caretScrolls.push({method:'to', args}); scrollTo(...args); };
    const focus = HTMLElement.prototype.focus;
    window.scriptFocusCalls = 0;
    HTMLElement.prototype.focus = function(...args) { scriptFocusCalls++; return focus.apply(this, args); };
})();"""

SETUP = """() => {
    window.editor = document.querySelector('.clickable-asmb[contenteditable="true"]');
    window.note = editor.closest('.anotacao-asmb');
    note.previousElementSibling.click();
    window.selectIn = (node, offset=0, endNode=node, endOffset=offset) => {
        const range = document.createRange();
        range.setStart(node, offset); range.setEnd(endNode, endOffset);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        window.selectedNode = node; window.selectedOffset = offset;
    };
    window.positionCaret = top => {
        const rect = getSelection().getRangeAt(0).getBoundingClientRect();
        positionTestScroll({top:scrollY + rect.top - top, behavior:'instant'});
        caretScrolls.length = 0;
    };
    window.caretState = () => {
        const sel = getSelection(), rect = sel.getRangeAt(0).getBoundingClientRect();
        return {top:rect.top, bottom:rect.bottom, scrolls:[...caretScrolls],
            sameNode:sel.anchorNode===selectedNode, sameOffset:sel.anchorOffset===selectedOffset,
            collapsed:sel.isCollapsed, html:editor.innerHTML, y:scrollY};
    };
}"""


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873}, is_mobile=True,
                                  has_touch=True, service_workers='block')
    context.route('**/*', lambda r: r.continue_() if r.request.url.startswith(origin + '/') else r.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(VIEWPORT)
    page.goto(origin + '/caret-fixture.html')
    page.wait_for_function('document.querySelectorAll(".clickable-asmb").length===17')
    page.evaluate(SETUP)
    page.wait_for_timeout(350)

    # A real tap on the empty field must not call JS focus() or force its range.
    page.evaluate('scriptFocusCalls=0')
    page.locator('.clickable-asmb[contenteditable="true"]').first.tap()
    assert page.evaluate('scriptFocusCalls') == 0
    page.keyboard.type('abc')
    page.keyboard.press('Backspace')
    page.keyboard.press('Backspace')
    page.keyboard.press('Backspace')
    page.keyboard.type('d')
    assert page.evaluate('editor.textContent') == 'd'
    assert page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullText') == 'd'

    # The saved clone can drop a ghost rich paragraph; the live blank line and
    # its collapsed selection must remain in place for the next character.
    page.evaluate("""() => {
        editor.innerHTML='<div class="node-paragraph"><div class="paragraph-content">Anotação anterior</div></div>' +
            '<div class="node-paragraph" data-test="empty"><div class="paragraph-content"><br></div></div>';
        window.blankLine=editor.lastElementChild.firstElementChild;
        selectIn(blankLine, 0);
        editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertParagraph'}));
    }""")
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and page.evaluate('blankLine.isConnected'), state
    assert not page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullHtml.includes("data-test")')

    # Partial IME input and background events cannot replace the composing DOM.
    page.evaluate("""() => {
        window.beforeComposition=AssembleiaIA.readRecord(editor.dataset.id).fullHtml;
        editor.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
        blankLine.textContent='に'; selectIn(blankLine.firstChild, 1);
        editor.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true}));
        AssembleiaClickables.refresh();
        window.dispatchEvent(new CustomEvent('assembleia:recordchange', {detail:{id:editor.dataset.id, record:{fullHtml:'Outro texto'}}}));
        const enter=new KeyboardEvent('keydown', {bubbles:true, cancelable:true, key:'Enter', isComposing:true});
        editor.dispatchEvent(enter); window.compositionEnterPrevented=enter.defaultPrevented;
    }""")
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and 'に' in state['html'], state
    assert page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullHtml===beforeComposition')
    assert not page.evaluate('compositionEnterPrevented')
    page.evaluate("editor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'に'}))")
    assert 'に' in page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullText')

    # A nested editable paragraph is just as protected as the editor root.
    page.evaluate("""() => {
        editor.innerHTML='<div class="paragraph-content" contenteditable="true" tabindex="0">Texto com cursor no meio</div>';
        window.paragraph=editor.firstElementChild;
        selectIn(paragraph.firstChild, 9); paragraph.focus({preventScroll:true});
        AssembleiaClickables.refresh();
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new CustomEvent('assembleia:recordchange', {detail:{id:editor.dataset.id, record:{fullHtml:'Outro texto'}}}));
    }""")
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and page.evaluate('document.activeElement===paragraph'), state
    assert 'Texto com cursor no meio' in state['html']

    # Collapsed rich content is still note content; pruning must not erase it.
    page.evaluate("""() => {
        editor.focus({preventScroll:true});
        editor.innerHTML='<div class="node-toggle"><button class="toggle-arrow">▸</button><span class="toggle-title"></span>' +
          '<div class="children" hidden><div class="node-paragraph"><div class="paragraph-content">Guardar este texto recolhido</div></div></div></div>';
        selectIn(editor, 0);
        editor.dispatchEvent(new InputEvent('input', {bubbles:true}));
    }""")
    assert 'Guardar este texto recolhido' in page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullHtml')

    # The native browser handles the tapped line and keyboard. The application
    # must not add delayed corrective scrolls on top of its own scroll/pan.
    page.evaluate("""() => {
        editor.innerHTML=Array.from({length:40},(_,i)=>'<div>Linha '+i+' de uma anotação longa</div>').join('');
        editor.classList.remove('is-empty'); editor.focus({preventScroll:true});
        selectIn(editor.children[18].firstChild, 8); positionCaret(520);
        testViewport(500); testViewport(450); testViewport(400);
    }""")
    before = page.evaluate('caretState()')
    page.wait_for_timeout(400)
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and state['y'] == before['y'], state
    assert not state['scrolls'], 'The app must not add a second scroll after keyboard resize.'

    # Simulate a stream of native viewport pans and repeated caret movement.
    # This used to schedule another instant scroll after each quiet interval.
    for top in (20, 70, 45, 90, 0):
        page.evaluate('(top) => { testViewport(400,top,"scroll"); document.dispatchEvent(new Event("selectionchange")); }', top)
        page.wait_for_timeout(220)
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and state['y'] == before['y'] and not state['scrolls'], state
    page.evaluate('testViewport(873)')
    page.wait_for_timeout(250)
    assert not page.evaluate('caretScrolls'), 'Keyboard close must not restore an earlier scroll position.'

    # Neither safe-area tabs nor a large font can start an upper-edge correction.
    page.evaluate("document.querySelector('.session-nav').style.top='59px'")
    for visual_top in (0, 70):
        page.evaluate('(top) => { positionCaret(80); testViewport(400,top); }', visual_top)
        before = page.evaluate('caretState()')
        page.wait_for_timeout(250)
        state = page.evaluate('caretState()')
        assert state['sameNode'] and state['sameOffset'] and state['y'] == before['y'] and not state['scrolls'], state
    page.evaluate("document.querySelector('.session-nav').style.removeProperty('top'); testViewport(873)")
    page.evaluate("document.documentElement.style.setProperty('--read-size','30px'); positionCaret(580); testViewport(450)")
    before = page.evaluate('caretState()')
    page.wait_for_timeout(250)
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and state['y'] == before['y'] and not state['scrolls'], state

    # Range selection, inertia, typing and a collapsed caret tap are also native.
    page.evaluate("""() => {
        selectIn(editor.children[18].firstChild, 2, editor.children[24].firstChild, 8);
        caretScrolls.length=0; testViewport(150);
    }""")
    page.wait_for_timeout(250)
    state = page.evaluate('caretState()')
    assert not state['collapsed'] and not state['scrolls'], state
    page.evaluate("""() => {
        selectIn(editor.children[18].firstChild,8); positionCaret(580);
        editor.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:80,clientY:500}));
        editor.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:80,clientY:300}));
        editor.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));
    }""")
    for _ in range(5):
        page.evaluate('testViewport(400,0,"scroll")')
        page.wait_for_timeout(220)
    state = page.evaluate('caretState()')
    assert not state['scrolls'] and state['top'] > 500, state
    page.evaluate("""() => {
        editor.dispatchEvent(new InputEvent('input',{bubbles:true}));
        editor.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:90,clientY:580}));
        editor.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:90,clientY:580}));
        document.dispatchEvent(new Event('selectionchange'));
    }""")
    before = page.evaluate('caretState()')
    page.wait_for_timeout(350)
    state = page.evaluate('caretState()')
    assert state['sameNode'] and state['sameOffset'] and state['y'] == before['y'] and not state['scrolls'], state
    assert 'Linha 18' in page.evaluate('AssembleiaIA.readRecord(editor.dataset.id).fullText')

    assert not errors, errors
    browser.close()
    return {'engine': engine.name, 'nativeTapNoRefocus': True, 'blankLinePreserved': True,
            'compositionPreserved': True, 'nestedFocusPreserved': True, 'collapsedTextSaved': True,
            'keyboardUsesNativeScroll': True, 'viewportPanNoCorrection': True, 'safeAreaNoCorrection': True, 'largeFont': True,
            'longSelectionPreserved': True, 'momentumScrollPreserved': True, 'errors': errors}


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            results = [check(playwright.chromium, '/usr/bin/chromium', origin)]
            if os.environ.get('WEBKIT_EXECUTABLE'):
                results.append(check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin))
            print(json.dumps(results, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
