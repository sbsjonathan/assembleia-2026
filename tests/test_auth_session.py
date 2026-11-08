"""Auth lifecycle checks using real pages, isolated storage and a fake SDK.

No real accounts or external network are used. Set WEBKIT_EXECUTABLE to also
exercise WebKit; Chromium defaults to /usr/bin/chromium.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
AUTH_PATH = '/save/auth-supabase.html'
SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'

FIXTURE = r"""(() => {
  const nativeRead = Storage.prototype.getItem;
  const nativeWrite = Storage.prototype.setItem;
  const nativeRemove = Storage.prototype.removeItem;
  const storage = window.localStorage;
  const qa = window.authQA = {
    mode: 'valid', held: [], holdNext: false, holdLogin: false,
    writesFail: false, readsFail: false, deletes: [], requests: [],
    raw: () => nativeRead.call(storage, 'ass26:supabase_user'),
    seed: value => nativeWrite.call(storage, 'ass26:supabase_user', value),
    user: name => ({id: 'qa-' + name, usuario: name,
      nome_completo: 'Conta ' + name, senha_hash: 'never-persist-this-hash'})
  };
  Storage.prototype.getItem = function(key) {
    if (key === 'ass26:supabase_user' && qa.readsFail)
      throw new DOMException('Synthetic unavailable storage', 'SecurityError');
    return nativeRead.call(this, key);
  };
  Storage.prototype.setItem = function(key, value) {
    if (key === 'ass26:supabase_user' && qa.writesFail)
      throw new DOMException('Synthetic full storage', 'QuotaExceededError');
    return nativeWrite.call(this, key, value);
  };
  Storage.prototype.removeItem = function(key) {
    if (key === 'ass26:supabase_user') qa.deletes.push(key);
    return nativeRemove.call(this, key);
  };
  qa.makeSDK = () => ({createClient() { return {from(table) {
    const query = {table, filters: {}, columns: '',
      select(value) { this.columns = value; return this; },
      eq(key, value) { this.filters[key] = value; return this; },
      insert(value) { this.inserted = value; return this; },
      update() { return this; }, delete() { return this; },
      single() {
        qa.requests.push({table, kind: 'single', columns: this.columns});
        if (table !== 'usuarios') return Promise.resolve({data: null, error: null});
        const user = qa.user(this.filters.usuario || this.inserted?.usuario || 'alpha');
        if (qa.holdLogin) {
          qa.holdLogin = false;
          return new Promise(resolve => qa.held.push({kind: 'login', resolve, user}));
        }
        return Promise.resolve({data: user, error: null});
      },
      maybeSingle() {
        qa.requests.push({table, kind: 'maybeSingle', columns: this.columns});
        if (table !== 'usuarios') return Promise.resolve({data: null, error: null});
        if (this.filters.usuario && this.filters.senha_hash) {
          const user = qa.user(this.filters.usuario);
          if (qa.holdLogin) {
            qa.holdLogin = false;
            return new Promise(resolve => qa.held.push({kind: 'login', resolve, user}));
          }
          return Promise.resolve({data: user, error: null});
        }
        if (qa.holdNext) {
          qa.holdNext = false;
          return new Promise(resolve => qa.held.push({kind: 'validation', resolve}));
        }
        if (qa.mode === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
        if (qa.mode === 'missing') return Promise.resolve({data: null, error: null});
        if (qa.mode !== 'valid') return Promise.resolve({data: null,
          error: {code: qa.mode, message: 'Synthetic service response'}});
        return Promise.resolve({data: {id: this.filters.id}, error: null});
      }
    };
    return query;
  }};}});
  INSTALL_SDK
})();"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/qa-sibling.html':
            data = b'<!doctype html><body>Unscoped sibling application</body>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
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
    context.add_init_script(FIXTURE.replace('INSTALL_SDK', 'window.supabase = qa.makeSDK();'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin + AUTH_PATH)
    page.wait_for_function('window.SupabaseSync && window.UnifiedNavbar?.get()')
    page.locator('#login-usuario').fill('alpha')
    page.locator('#login-senha').fill('synthetic-password')
    page.locator('#btn-login').tap()
    page.wait_for_function("document.querySelector('#success-screen').classList.contains('active')")
    raw = page.evaluate('authQA.raw()')
    stored = json.loads(raw)
    assert stored['id'] == 'qa-alpha' and stored['usuario'] == 'alpha'
    assert stored.get('loginId')
    assert 'senha' not in raw and 'never-persist' not in raw and 'synthetic-password' not in raw
    assert page.locator('.navbar-item[data-page="save"]').evaluate("el => el.classList.contains('logged-in')")

    # The same record survives reload, actual app navigation and return to Save.
    page.reload()
    page.wait_for_function("document.querySelector('#logged-screen').classList.contains('active')")
    assert page.evaluate('authQA.raw()') == raw
    page.locator('#btn-continuar-logged').tap()
    page.wait_for_url('**/index.html')
    page.wait_for_function('window.SupabaseSync && window.AssembleiaClickables')
    assert page.evaluate('window.SupabaseSync.getCurrentUser().id') == 'qa-alpha'
    page.locator('.navbar-item[data-page="save"]').tap()
    page.wait_for_url('**' + AUTH_PATH)
    page.wait_for_function("document.querySelector('#logged-screen').classList.contains('active')")
    assert page.evaluate('authQA.raw()') == raw

    # Query/network errors never prove that the stored account ceased to exist.
    for mode in ['PGRST116', 'PGRST301', '503', 'throw']:
        result = page.evaluate('''async mode => {
          authQA.mode = mode;
          return await window.SupabaseSync.validateExistingSession();
        }''', mode)
        assert result['status'] == 'unavailable', (mode, result)
        assert page.evaluate('authQA.raw()') == raw
        assert page.evaluate('authQA.deletes.length') == 0
    page.evaluate("authQA.mode = 'valid'")

    # A delayed check must not clear a subsequent login, including the same user.
    for name in ['beta', 'beta']:
        page.evaluate('''() => {
          authQA.holdNext = true;
          window.pendingValidation = window.SupabaseSync.validateExistingSession();
        }''')
        page.wait_for_function("authQA.held.some(item => item.kind === 'validation')")
        result = page.evaluate('name => window.SupabaseSync.logarUsuario(name, "synthetic-password")', name)
        assert result['success']
        new_raw = page.evaluate('authQA.raw()')
        assert new_raw != raw
        result = page.evaluate('''async () => {
          authQA.held.shift().resolve({data: null, error: null});
          return await pendingValidation;
        }''')
        assert result['status'] == 'changed', result
        assert page.evaluate('authQA.raw()') == new_raw
        raw = new_raw

    # Unavailable storage has its own state and does not remove the saved value.
    result = page.evaluate('''() => {
      authQA.readsFail = true;
      const session = window.SupabaseSync.checkExistingSession();
      authQA.readsFail = false;
      return session;
    }''')
    assert result['status'] == 'unavailable'
    assert page.evaluate('authQA.raw()') == raw
    assert page.evaluate('window.SupabaseSync.getCurrentUser().id') == 'qa-beta'

    # UI rendering errors must never be classified as corrupt login data.
    result = page.evaluate('''() => {
      const original = AuthUI.prototype.showLoggedUserScreen;
      AuthUI.prototype.showLoggedUserScreen = () => { throw new Error('Synthetic render failure'); };
      try { new AuthUI(); } catch (_) {}
      finally { AuthUI.prototype.showLoggedUserScreen = original; }
      return authQA.raw();
    }''')
    assert result == raw
    assert page.evaluate('authQA.deletes.length') == 0

    # Separate Pages apps keep their identities. Another Assembly page observes
    # an explicit logout through its real scoped StorageEvent.
    sibling = context.new_page()
    sibling.goto(origin + '/qa-sibling.html')
    sibling.evaluate("localStorage.setItem('supabase_user', '{\"id\":\"sibling-account\"}')")
    assert page.evaluate('authQA.raw()') == raw
    watcher = context.new_page()
    watcher.goto(origin + AUTH_PATH)
    watcher.wait_for_function("document.querySelector('#logged-screen').classList.contains('active')")
    assert watcher.evaluate('window.SupabaseSync.getCurrentUser().id') == 'qa-beta'

    # A late successful validation cannot revive an explicit logout.
    page.evaluate('''() => {
      authQA.holdNext = true;
      window.pendingValidation = window.SupabaseSync.validateExistingSession();
    }''')
    page.wait_for_function("authQA.held.some(item => item.kind === 'validation')")
    page.locator('#btn-logout').tap()
    page.wait_for_function("document.querySelector('#login-screen').classList.contains('active')")
    assert page.evaluate('authQA.raw()') is None
    watcher.wait_for_function("document.querySelector('#login-screen').classList.contains('active')")
    assert watcher.evaluate('window.SupabaseSync.getCurrentUser()') is None
    assert sibling.evaluate("JSON.parse(localStorage.getItem('supabase_user')).id") == 'sibling-account'
    watcher.close()
    sibling.close()
    result = page.evaluate('''async () => {
      authQA.held.shift().resolve({data: {id: 'qa-beta'}, error: null});
      return await pendingValidation;
    }''')
    assert result['status'] == 'changed'
    page.reload()
    page.wait_for_function('window.SupabaseSync')
    assert page.evaluate('authQA.raw()') is None
    assert page.locator('#login-screen').evaluate("el => el.classList.contains('active')")

    # A login still in flight is canceled by logout; it cannot recreate a record.
    page.evaluate('''() => {
      authQA.holdLogin = true;
      window.pendingLogin = window.SupabaseSync.logarUsuario('alpha', 'synthetic-password');
    }''')
    page.wait_for_function("authQA.held.some(item => item.kind === 'login')")
    result = page.evaluate('''async () => {
      window.SupabaseSync.logout();
      const login = authQA.held.shift();
      login.resolve({data: login.user, error: null});
      return await pendingLogin;
    }''')
    assert result['success'] is False
    assert page.evaluate('authQA.raw()') is None

    # Persistence failure cannot report successful login or leave a phantom user.
    result = page.evaluate('''async () => {
      authQA.writesFail = true;
      const result = await window.SupabaseSync.logarUsuario('alpha', 'synthetic-password');
      authQA.writesFail = false;
      return result;
    }''')
    assert result['success'] is False
    assert page.evaluate('authQA.raw()') is None
    assert page.evaluate('window.SupabaseSync.isLoggedIn()') is False

    # Only an unambiguous successful lookup of a removed account signs it out.
    assert page.evaluate("window.SupabaseSync.logarUsuario('alpha', 'synthetic-password')")['success']
    result = page.evaluate("authQA.mode='missing'; window.SupabaseSync.validateExistingSession()")
    assert result['status'] == 'removed'
    assert page.evaluate('authQA.raw()') is None
    assert not errors, errors
    context.close()

    # The SDK can fail while a local session remains available; reconnect retries.
    context = browser.new_context(service_workers='block')
    allow_sdk = False
    requests = []

    def route_request(route):
        nonlocal allow_sdk
        if route.request.url.startswith(origin + '/'):
            route.continue_()
        elif route.request.url == SDK:
            requests.append(route.request.url)
            if allow_sdk:
                route.fulfill(status=200, content_type='application/javascript',
                              body='window.supabase = authQA.makeSDK();')
            else:
                route.abort()
        else:
            route.abort()

    context.route('**/*', route_request)
    context.add_init_script(FIXTURE.replace('INSTALL_SDK', '''
      qa.seed(JSON.stringify({id:'qa-alpha',usuario:'alpha',nome:'Conta alpha',loginId:'existing'}));
    '''))
    page = context.new_page()
    page.goto(origin + AUTH_PATH)
    page.wait_for_function('window.SupabaseSync && window.SupabaseSync.initPromise')
    page.evaluate('window.SupabaseSync.initPromise')
    assert page.evaluate('window.SupabaseSync.getCurrentUser().id') == 'qa-alpha'
    assert page.locator('#logged-screen').evaluate("el => el.classList.contains('active')")
    assert page.evaluate('authQA.deletes.length') == 0
    allow_sdk = True
    page.evaluate("dispatchEvent(new Event('online'))")
    page.wait_for_function('window.SupabaseSync.supabase !== null')
    assert page.evaluate('window.SupabaseSync.validateExistingSession()')['status'] == 'valid'
    assert len(requests) >= 2
    context.close()
    browser.close()
    return {'browser': engine.name, 'login_navigation_persistence': 'passed',
            'validation_failures_preserve_session': 'passed', 'stale_requests': 'passed',
            'logout_stays_logged_out': 'passed', 'cross_page_and_sibling_isolation': 'passed',
            'storage_and_render_failures': 'passed',
            'sdk_failure_and_reconnect': 'passed'}


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
