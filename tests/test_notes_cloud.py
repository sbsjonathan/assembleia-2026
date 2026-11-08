"""Real v1/v2 editor persistence with synthetic cloud and blocked external network."""
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
    browser = engine.launch(executable_path=executable, headless=True, args=['--no-sandbox'] if engine.name == 'chromium' else [])
    for version in [1, 2]:
        context = browser.new_context(service_workers='block', viewport={'width': 430, 'height': 873})
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
        context.add_init_script('''
            localStorage.setItem('ass26:supabase_user', JSON.stringify({id:'synthetic',loginId:'one'}));
            window.fakeCloud = { raw: null, writes: [], fail: false };
            window.SupabaseSync = {
                isLoggedIn: () => !!localStorage.getItem('supabase_user'),
                carregarRichtextAnotacoes: async () => fakeCloud.raw,
                salvarRichtextAnotacoes: async (week, raw, options) => {
                    if (fakeCloud.fail) return {success:false,error:'synthetic failure'};
                    if (options.expectedRemote !== fakeCloud.raw) return {success:false,error:'conflict'};
                    fakeCloud.writes.push(raw); fakeCloud.raw = raw; return {success:true};
                }
            };
        ''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        entry = 'container-v1.html' if version == 1 else 'container.html'
        page.goto(f'{origin}/richtext/{entry}?semana=02-11&versao={version}')
        page.wait_for_function('window.AutoSaveManager && window.UnifiedLoadManager && window.cacheRichText')
        page.evaluate('Promise.all([window.AutoSaveManager.ready, window.UnifiedLoadManager.ready, window.cacheRichText.ready])')
        page.evaluate('window.fakeCloud.fail = true')
        editor = page.locator('#editor .paragraph-content').first
        editor.fill('Documento sintético preservado numa falha de nuvem.')
        page.evaluate('window.cacheRichText.flush()')
        page.wait_for_function('window.cacheRichText.hasPending(window.cacheRichText.snapshot()) && !window.AutoSaveManager.sending')
        assert page.evaluate('fakeCloud.writes.length') == 0
        assert 'Documento sintético' in page.evaluate("localStorage.getItem('richtext_cache_02-11')")
        page.evaluate('window.fakeCloud.fail=false; window.AutoSaveManager.forceAutoSave()')
        page.wait_for_function('!window.cacheRichText.hasPending(window.cacheRichText.snapshot()) && fakeCloud.writes.length === 1')
        assert page.evaluate('window.cacheRichText.isStored(window.cacheRichText.snapshot())')
        page.evaluate("window.fakeCloud.raw=''; window.UnifiedLoadManager.syncWithSupabase()")
        page.wait_for_function("!document.getElementById('editor').textContent.trim() && !window.UnifiedLoadManager.syncing")
        assert page.evaluate('fakeCloud.writes.length') == 1
        assert page.evaluate("Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).some(k=>k.startsWith('richtext_recovery_02-11_'))")
        assert not errors, errors
        print(json.dumps({'engine': engine.name, 'version': version, 'local_failure_and_retry': 'passed', 'empty_cloud_and_recovery': 'passed'}), flush=True)
        context.close()
    browser.close()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            check(p.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), f'http://127.0.0.1:{server.server_port}')
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(p.webkit, os.environ['WEBKIT_EXECUTABLE'], f'http://127.0.0.1:{server.server_port}')
    finally:
        server.shutdown()
