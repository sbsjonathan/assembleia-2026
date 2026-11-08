"""Cloud-menu modes and modal lifecycle with synthetic accounts and no backend.

Uses the production menu assets. Set WEBKIT_EXECUTABLE to cover WebKit too.
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = r'''<!doctype html><html data-font-scope="interface"><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assembleia/menu/menu.css">
<script src="/shared/typography.js"></script>
<style>body{margin:20px;font:16px sans-serif;--text-primary:#222;--bg-body:#fff}</style>
</head><body><button class="dia">Assembleia</button><div id="menu-container"></div>
<script>
const qa = window.qa = { calls: [], alerts: [], failRead: false,
  held: null, holdNext: false, failNext: false, preserveEdits: false };
localStorage.setItem('supabase_user', JSON.stringify({id:'synthetic-a',loginId:'login-a'}));
localStorage.setItem('ca-copgm27:synthetic', 'must-stay-until-sync-applies');
window.alert = message => qa.alerts.push(message);
window.SupabaseSync = {
  checkExistingSession() {
    if (qa.failRead) return {status:'unavailable'};
    const raw = localStorage.getItem('supabase_user');
    if (!raw) return {status:'signed-out',raw};
    try { const user = JSON.parse(raw); return {status:user.id?'signed-in':'invalid',raw,user}; }
    catch (_) { return {status:'invalid',raw}; }
  },
  apagarAssembleiaCompleto() { throw new Error('UI must delegate deletion through AssembleiaSync'); }
};
window.assembleiaSync = Object.fromEntries([
  'pushMissing','pushMerge','pushOverwrite','pullMissing','pullMerge','pullOverwrite','deleteAll'
].map(name => [name, async () => {
  qa.calls.push(name);
  if (qa.holdNext) {
    qa.holdNext = false;
    await new Promise(resolve => { qa.held = resolve; });
  }
  if (qa.failNext) { qa.failNext = false; throw new Error('Synthetic connection failed'); }
  return {success:true,preservedLocalChanges:qa.preserveEdits};
}]));
</script><script src="/assembleia/menu/menu.js"></script></body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/qa-cloud-menu.html':
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
    context.route('**/*', lambda route: route.continue_()
                  if route.request.url.startswith(origin + '/') else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin + '/qa-cloud-menu.html')
    page.locator('.dia').tap()
    page.locator('#btn-abrir-sync').wait_for(state='visible')

    def calls():
        return page.evaluate('qa.calls')

    def open_mode(tab, option='missing'):
        page.locator('#btn-abrir-sync').tap()
        page.locator(f'[data-sync-tab="{tab}"]').tap()
        page.locator('.sync-choice').filter(has=page.locator(
            f'input[name="sync-{tab}"][value="{option}"]')).tap()
        page.locator('#asmbSyncRun').tap()

    def confirm_overwrite():
        page.locator('#asmbAlertBtnRight').tap()

    def password():
        page.locator('#asmbPwInput').fill('Noj')
        page.locator('#asmbPwOk').tap()

    def wait_idle():
        page.wait_for_function('!document.querySelector("#asmbSyncRun").disabled')

    # Each selected mode calls exactly its corresponding contextual operation.
    expected = []
    for tab, prefix in [('enviar', 'push'), ('baixar', 'pull')]:
        for mode in ['missing', 'merge', 'overwrite']:
            open_mode(tab, mode)
            if mode == 'overwrite':
                confirm_overwrite()
            password()
            wait_idle()
            expected.append(prefix + mode.capitalize())
            assert calls() == expected, calls()
            assert page.locator('#asmbPwOverlay').get_attribute('aria-hidden') == 'true'

    # The sequence is locked from its first confirmation, and repeated events
    # cannot start a second permission prompt/request or change the chosen mode.
    open_mode('enviar', 'overwrite')
    assert page.locator('#btn-abrir-sync').is_disabled()
    assert page.locator('#btn-limpar-cache').is_disabled()
    page.evaluate('''() => {
      document.querySelector('#asmbSyncRun').dispatchEvent(new Event('click'));
      document.querySelector('[data-sync-tab="apagar"]').dispatchEvent(new Event('click'));
    }''')
    confirm_overwrite()
    page.locator('#asmbPwInput').fill('wrong')
    page.locator('#asmbPwOk').tap()
    assert page.locator('#asmbPwError').is_visible()
    assert calls() == expected
    page.evaluate('qa.holdNext = true')
    password()
    page.wait_for_function('!!qa.held')
    assert calls() == expected + ['pushOverwrite']
    assert page.locator('#btn-abrir-sync').is_disabled()
    page.evaluate('''() => {
      document.querySelector('#asmbSyncRun').dispatchEvent(new Event('click'));
      qa.held(); qa.held = null;
    }''')
    wait_idle()
    expected.append('pushOverwrite')
    assert calls() == expected

    # Canceling before the focus timer fires must not refocus a hidden password
    # field later. A new operation must have exactly one listener/request.
    open_mode('enviar')
    page.locator('#asmbPwCancel').dispatch_event('click')
    wait_idle()
    page.wait_for_timeout(160)
    assert not page.evaluate('document.activeElement.id === "asmbPwInput"')
    assert calls() == expected
    open_mode('enviar', 'overwrite')
    page.locator('#asmbAlertBtnLeft').tap()
    wait_idle()
    assert calls() == expected

    # Logging out/in during permission cannot transfer a pending action to the
    # new account, even when the account id is the same but login id is new.
    open_mode('enviar')
    page.evaluate('localStorage.setItem("supabase_user", JSON.stringify({id:"synthetic-a",loginId:"login-b"}))')
    password()
    wait_idle()
    assert calls() == expected
    assert 'A conta mudou' in page.evaluate('qa.alerts.at(-1)')

    page.evaluate('qa.failRead = true')
    page.locator('#btn-abrir-sync').tap()
    assert 'ler sua sessão' in page.evaluate('qa.alerts.at(-1)')
    assert page.locator('#asmbSyncOverlay').get_attribute('aria-hidden') == 'true'
    page.evaluate('qa.failRead = false')
    page.evaluate('localStorage.setItem("supabase_user", "invalid-json")')
    page.locator('#btn-abrir-sync').tap()
    assert 'login' in page.evaluate('qa.alerts.at(-1)')
    page.evaluate('localStorage.setItem("supabase_user", JSON.stringify({id:"synthetic-a"}))')

    open_mode('baixar')
    context.set_offline(True)
    password()
    wait_idle()
    assert calls() == expected
    assert 'internet' in page.evaluate('qa.alerts.at(-1)')
    context.set_offline(False)

    # Exceptions are surfaced as failure, never as a success or local deletion.
    page.evaluate('qa.failNext = true')
    open_mode('enviar')
    password()
    wait_idle()
    expected.append('pushMissing')
    assert 'Synthetic connection failed' in page.evaluate('qa.alerts.at(-1)')
    assert page.evaluate('localStorage.getItem("ca-copgm27:synthetic")') == 'must-stay-until-sync-applies'

    # Deletion goes through the same synchronized engine; all confirmations are
    # awaited and the UI honors concurrent local edits reported by that engine.
    page.evaluate('qa.preserveEdits = true')
    open_mode('apagar', 'all')
    page.locator('#asmbAlertBtnRight').tap()
    page.wait_for_function('document.querySelector("#asmbAlertTitle").textContent === "Confirmar exclusão"')
    page.locator('#asmbAlertBtnLeft').tap()
    password()
    wait_idle()
    expected.append('deleteAll')
    assert calls() == expected
    assert 'alterações feitas durante' in page.evaluate('qa.alerts.at(-1)')
    assert page.evaluate('localStorage.getItem("ca-copgm27:synthetic")') == 'must-stay-until-sync-applies'

    # Download applies all visual preferences immediately without a reload or
    # focus transfer. An explicit empty snapshot restores defaults without
    # silently recreating the removed preference keys.
    page.evaluate('''() => {
      const input = document.createElement('input');
      input.id = 'qa-focus'; document.body.append(input); input.focus();
      const values = {'tema-interface':'dark', 'editor-performance-mode':'normal',
        'cor-assembleia':'#123456', 'tamanho-fonte-global':'30'};
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      dispatchEvent(new CustomEvent('assembleia:cloudapplied', {detail:{keys:Object.keys(values)}}));
    }''')
    assert page.evaluate('document.activeElement.id') == 'qa-focus'
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    assert page.locator('html').get_attribute('data-performance-mode') == 'normal'
    assert page.locator('#theme-dark').is_checked()
    assert page.locator('#cor-picker').input_value() == '#123456'
    assert page.locator('#range-tamanho-fonte').input_value() == '11'
    assert page.evaluate('GlobalFontScale.getLevel()') == 11
    assert page.evaluate('document.documentElement.style.getPropertyValue("--cor-global")') == '#123456'
    page.evaluate('''() => {
      const keys = ['tema-interface','editor-performance-mode','cor-assembleia','tamanho-fonte-global'];
      keys.forEach(key => localStorage.removeItem(key));
      dispatchEvent(new CustomEvent('assembleia:cloudapplied', {detail:{keys}}));
    }''')
    assert page.evaluate('document.activeElement.id') == 'qa-focus'
    assert page.locator('html').get_attribute('data-performance-mode') == 'low'
    assert page.locator('#theme-system').is_checked()
    assert page.locator('#cor-picker').input_value() == '#604184'
    assert page.locator('#range-tamanho-fonte').input_value() == '3'
    assert page.evaluate('GlobalFontScale.getLevel()') == 3
    assert page.evaluate('["tema-interface","editor-performance-mode","cor-assembleia","tamanho-fonte-global"].every(key => localStorage.getItem(key) === null)')
    assert not errors, errors
    browser.close()
    print(f'PASS {engine.name}: seven modes, permission lifecycle, duplicate taps, account changes, failures and synchronized deletion')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            check(playwright.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin)
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
