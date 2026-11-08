"""Exercise the real article menu, cache, markup and cloud merge across reload.

All accounts, annotations and cloud responses below are synthetic/local.
"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = r'''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/sentinela/menu/menu.css">
<style>body{margin:20px;font:16px sans-serif} .comentarios{min-height:25px}</style>
</head><body><div class="barra-estudo">Estudo sintético</div><main>
<div><p class="pergunta"><span>1-2.</span> Primeira pergunta?</p></div>
<p class="paragrafo"><span>1</span> Primeiro parágrafo original.</p>
<p class="paragrafo"><span>2</span> Segundo parágrafo original.</p>
<div><p class="pergunta"><span>3.</span> Segunda pergunta?</p></div>
<p class="paragrafo"><span>3</span> Terceiro parágrafo original.</p>
</main><script>
window.estudoId='35';window.semanaAtual='02-11';
if (!localStorage.getItem('qa-seeded')) {
  const values={
    'c-35-1-2':'Comentário agrupado','r-35-1-2':'Resposta agrupada',
    'p-35-1-2-pg-0':'<span>1</span> <mark class="hl-color-yellow">Primeiro parágrafo original.</mark>',
    'p-35-1-2-pg-1':'<span>2</span> <mark class="hl-color-blue">Segundo parágrafo original.</mark>',
    'c-35-3':'Comentário simples','r-35-3':'Resposta simples',
    'p-35-3-pg-0':'<span>3</span> <mark class="hl-color-green">Terceiro parágrafo original.</mark>'
  };
  for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);
  localStorage.setItem('qa-cloud',JSON.stringify(values));
  localStorage.setItem('c-36-1','Outro artigo');
  localStorage.setItem('ca-copgm27:note-1','Programa da assembleia');
  localStorage.setItem('supabase_user',JSON.stringify({id:'synthetic',loginId:'test'}));
  localStorage.setItem('qa-seeded','1');
}
window.SupabaseSync={isLoggedIn:()=>true,
  carregarSentinelaAnotacoes:async()=>JSON.parse(localStorage.getItem('qa-cloud')),
  salvarSentinelaAnotacoes:async(week,study,value)=>{
    localStorage.setItem('qa-cloud',JSON.stringify(value));return{success:true};
  }
};
</script>
<script src="/sentinela/clickable/cache.js"></script>
<script src="/sentinela/clickable/clickable.js"></script>
<script src="/sentinela/mark.js"></script>
<script src="/save/sentinela-sync.js"></script>
<script src="/sentinela/menu/menu.js"></script>
</body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/qa-article-clear.html':
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True)
    for scope in ['day', 'all-notes']:
        context = browser.new_context(viewport={'width': 430, 'height': 873})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(origin + '/qa-article-clear.html')
        page.wait_for_function('window.sentinelaSync?.initialLoadComplete')
        assert page.locator('.paragrafo mark').count() == 3
        assert page.locator('#c-35-1-2').inner_text() == 'Comentário agrupado'
        # Real menu action, browser confirmation and navigation, without mocks
        # around the delete method or location.reload.
        page.locator('.barra-estudo').click()
        page.locator('#btn-limpar-cache').click()
        page.locator(f'label:has(input[name="local-delete-opt"][value="{scope}"])').click()
        with page.expect_navigation(wait_until='load'):
            page.locator('#sentinelaDeleteRun').click()
        page.wait_for_function('window.sentinelaSync?.initialLoadComplete')
        assert page.locator('.paragrafo mark').count() == 0
        assert page.locator('#c-35-1-2').inner_text() == ''
        assert page.locator('#c-35-3').inner_text() == ''
        assert page.locator('#r-35-1-2').inner_text() != 'Resposta agrupada'
        assert page.locator('#r-35-3').inner_text() != 'Resposta simples'
        assert page.locator('.paragrafo').count() == 3
        assert 'Primeiro parágrafo original.' in page.locator('.paragrafo').first.inner_text()
        state = page.evaluate('''() => ({notes:sentinelaSync.collectAnnotationsFromLocalStorage(),
          other:localStorage.getItem('c-36-1'),programme:localStorage.getItem('ca-copgm27:note-1'),
          account:localStorage.getItem('supabase_user'),cloud:JSON.parse(localStorage.getItem('qa-cloud'))})''')
        assert state['notes'] == {}
        assert state['other'] == ('Outro artigo' if scope == 'day' else None)
        assert state['programme'] == 'Programa da assembleia'
        assert state['account']
        assert len(state['cloud']) == 7
        page.reload()
        page.wait_for_function('window.sentinelaSync?.initialLoadComplete')
        assert page.locator('.paragrafo mark').count() == 0
        # A subsequent deliberate edit still uploads; old source marks remain
        # only in the cloud until the explicit download operation is requested.
        page.locator('#c-35-3').fill('Nova nota depois de apagar')
        assert page.evaluate('sentinelaSync.executeAutoSave()')['success']
        assert page.evaluate("JSON.parse(localStorage.getItem('qa-cloud'))['c-35-3']") == 'Nova nota depois de apagar'
        assert page.locator('.paragrafo mark').count() == 0
        assert page.evaluate('sentinelaSync.pullMissing()')['success']
        assert page.locator('.paragrafo mark').count() == 3
        assert page.locator('#c-35-3').inner_text() == 'Nova nota depois de apagar'
        assert not errors, errors
        context.close()
    browser.close()
    print(f'PASS {engine.name}: real local-clear menu, every paragraph, reload, scope isolation, later edits and explicit restore')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            check(playwright.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), f'http://127.0.0.1:{server.server_port}')
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], f'http://127.0.0.1:{server.server_port}')
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
