"""Opening-tab and clock-marker regression checks against the real programme.

Run: python tests/test_program_schedule.py
Set WEBKIT_EXECUTABLE to additionally exercise WebKit.
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
        if self.path.split('?', 1)[0] != '/schedule-fixture.html':
            return super().do_GET()
        # Use the real programme markup and the two controllers under test.
        # Other features have their own tests and cannot affect the fake clock.
        html = re.sub(r'<script\b[^>]*>.*?</script>', '', (ROOT / 'index.html').read_text(), flags=re.S | re.I)
        html = html.replace('</body>', '<script src="assembleia/hora/scripth.js"></script><script src="programacao/dia.js"></script></body>')
        data = html.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


STATE = """() => ({
    tab: AssemblyProgram.activeTab(),
    visible: document.querySelector('[role="tabpanel"]:not([hidden])').id,
    markerTab: document.querySelector('.hora-ativo')?.closest('[role="tabpanel"]').id || null,
    markerTime: document.querySelector('.hora-ativo .hora')?.textContent.trim() || null,
    markerCount: document.querySelectorAll('.hora-ativo').length
})"""


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873}, timezone_id='UTC', service_workers='block')
    context.route('**/*', lambda r: r.continue_() if r.request.url.startswith(origin + '/') else r.abort())
    errors = []

    def open_at(hour, minute, fragment='', page_name='schedule-fixture.html'):
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("""(() => {
            const NativeDate = Date;
            window.scheduleClock = NativeDate.UTC(2026, 10, 7, %d, %d);
            window.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : [window.scheduleClock])); }
                static now() { return window.scheduleClock; }
            };
        })();""" % (hour, minute))
        page.goto(origin + '/' + page_name + fragment)
        page.wait_for_function('window.AssemblySchedule && window.AssemblyProgram')
        return page

    # Real boundaries, midday gap, stale hashes and the requested 15:19 case.
    cases = [
        (9, 39, '', 'manha', None, None),
        (9, 40, '#tarde', 'manha', 'manha', '9:40'),
        (10, 4, '', 'manha', 'manha', '10:00'),
        (12, 5, '', 'manha', 'manha', '12:05'),
        (12, 6, '#tarde', 'tarde', None, None),
        (13, 19, '#perguntas', 'perguntas', None, None),
        (13, 20, '#manha', 'tarde', 'tarde', '13:20'),
        (15, 19, '#manha', 'tarde', 'tarde', '14:45'),
        (15, 19, '#perguntas', 'tarde', 'tarde', '14:45'),
        (16, 0, '', 'tarde', 'tarde', '16:00'),
        (16, 1, '#perguntas', 'perguntas', None, None),
        (20, 0, '#invalid', 'manha', None, None),
    ]
    for hour, minute, fragment, tab, marker_tab, marker_time in cases:
        page = open_at(hour, minute, fragment)
        state = page.evaluate(STATE)
        assert state == {'tab': tab, 'visible': tab, 'markerTab': marker_tab,
                         'markerTime': marker_time, 'markerCount': int(marker_tab is not None)}, (hour, minute, fragment, state)
        page.close()

    page = open_at(15, 19)
    page.locator('#tab-perguntas').click()
    page.evaluate('AssemblySchedule.refresh()')
    assert page.evaluate(STATE)['tab'] == 'perguntas'
    page.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))')
    assert page.evaluate(STATE)['tab'] == 'perguntas', 'A resumed manual tab must not be changed.'
    page.reload()
    assert page.evaluate(STATE)['tab'] == 'tarde', 'A new opening must follow the marker, not its restored fragment.'
    page.close()

    page = open_at(10, 4)
    page.evaluate('scheduleClock = Date.UTC(2026,10,7,15,19); AssemblySchedule.refresh()')
    assert page.evaluate(STATE)['tab'] == 'manha', 'The minute refresh never changes the selected tab.'
    page.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))')
    assert page.evaluate(STATE)['tab'] == 'tarde', 'An untouched resumed PWA can follow the new session.'
    page.close()

    page = open_at(10, 4)
    page.locator('[data-note-id="ca-copgm27:nota:confiar-de-todo-coracao"]').click()
    page.evaluate('scheduleClock = Date.UTC(2026,10,7,15,19); AssemblySchedule.refresh(); window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))')
    assert page.evaluate(STATE)['tab'] == 'manha', 'Work on a note must preserve its panel on resume.'
    page.evaluate('''() => {
        const note = document.createElement('div');
        note.innerHTML = '<p><span class="hora">15:18</span>Time pasted into a note</p>';
        document.getElementById('tarde').append(note);
        AssemblySchedule.refresh();
    }''')
    assert page.evaluate(STATE)['markerTime'] == '14:45'
    page.close()

    # The real script order (clock, clickables, tab controller, sync) must agree too.
    page = open_at(15, 19, '#manha', page_name='index.html')
    page.wait_for_function('document.querySelectorAll(".clickable-asmb").length === 17')
    state = page.evaluate(STATE)
    assert state['tab'] == state['markerTab'] == 'tarde' and state['markerTime'] == '14:45', state
    page.close()
    assert not errors, errors
    browser.close()
    return {'engine': engine.name, 'openingCases': len(cases), 'manualChoicePreserved': True,
            'resumeFollowsUntouchedPage': True, 'draftPanelPreserved': True, 'fullPageOpening': True, 'errors': errors}


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
