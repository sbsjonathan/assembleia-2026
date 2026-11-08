"""Synthetic Realtime lifecycle/recipient checks. No Supabase requests or real accounts."""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = '''<!doctype html><html><body>
<input id="online-permitir" type="checkbox"><button id="btn-online-toggle">Online</button>
<div id="online-status"></div><div id="online-lista"></div>
<div id="fullscTitle">Synthetic note</div><div id="editor" contenteditable="true"><p class="node-paragraph">Synthetic selected text</p></div>
<script>
localStorage.clear();
localStorage.setItem('sentinela-conexao-ativa','1');
localStorage.setItem('sentinela-ver-online','1');
window.qaUser={id:'qa-a',usuario:'Synthetic A',loginId:'session-a'};
window.qaChannels=[]; window.qaWrites=[];
window.SupabaseSync={getCurrentUser:()=>qaUser,supabase:{
 channel(name,options){
  const c={name,options,handlers:{},sent:[],tracked:[],removed:false,
   on(type,filter,fn){this.handlers[filter.event]=fn;return this},
   subscribe(fn){this.status=fn;return this},
   emit(event,payload){this.handlers[event]?.({payload})},
   track(value){this.tracked.push(value);return Promise.resolve('ok')},
   untrack(){return Promise.resolve('ok')},
   presenceState(){return {}},
   send(value){this.sent.push(value);return Promise.resolve('ok')}
  };qaChannels.push(c);return c;
 },async removeChannel(c){c.removed=true;return 'ok'}
}};
window.AssembleiaIA={readRecord:()=>({}),writeRecord:(id,value)=>qaWrites.push({id,value})};
</script>
<script src="/assembleia/conexao.js"></script>
<script src="/assembleia/anotacoes/clickable/envio-texto.js"></script>
</body></html>'''

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(service_workers='block')
    context.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=FIXTURE)
                  if route.request.url == origin + '/peer-test' else
                  route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def reset():
        page.goto(origin + '/peer-test')
        page.wait_for_function('qaChannels.length === 1')
        page.evaluate("qaChannels[0].status('SUBSCRIBED')")

    def pair(peer='qa-b'):
        page.evaluate('''id => qaChannels.at(-1).emit('pedido-pareamento', {
          para_id:qaUser.id,de_id:id,de_nome:id,codigo:'QA1234'
        })''', peer)
        page.locator('.online-btn-aceitar').click()
        assert page.evaluate('ConexaoPresenca.podeEnviar()')

    def select_and_send(confirm=True):
        page.evaluate('''() => {
          const range=document.createRange();range.selectNodeContents(document.querySelector('#editor p'));
          getSelection().removeAllRanges();getSelection().addRange(range);
          document.dispatchEvent(new Event('touchend'));
        }''')
        page.locator('#envio-balao').click()
        page.locator('.envio-modal-enviar').wait_for()
        if confirm:
            page.locator('.envio-modal-enviar').click()
            page.wait_for_function("qaChannels.at(-1).sent.some(message=>message.event==='envio-texto')")
            return page.evaluate("qaChannels.at(-1).sent.find(message=>message.event==='envio-texto').payload")

    reset()
    page.evaluate("qaChannels[0].emit('resposta-pareamento',{para_id:'qa-a',de_id:'qa-unrequested',aceito:true,codigo:'unsolicited'})")
    assert page.evaluate('ConexaoPresenca.parAtual()') is None
    pair()
    assert page.evaluate("JSON.parse(localStorage.getItem('sentinela-par-conexao')).conta") == '["qa-a","session-a"]'
    payload = select_and_send()
    assert payload['para_id'] == 'qa-b'
    # A token alone cannot confirm delivery: a different sender must be ignored.
    page.evaluate("payload => EnvioTextoAck({...payload,para_id:'qa-a',de_id:'qa-c'})", payload)
    assert not page.locator('.envio-toast').filter(has_text='Entregue').count()
    page.evaluate("payload => qaChannels[0].emit('envio-ack',{...payload,para_id:'qa-a',de_id:'qa-b'})", payload)
    assert page.locator('.envio-toast').filter(has_text='Entregue a qa-b').count() == 1
    page.evaluate("payload => qaChannels[0].emit('envio-resposta',{...payload,para_id:'qa-a',de_id:'qa-b',aceito:true})", payload)
    assert page.locator('.envio-toast').filter(has_text='Enviado com sucesso').count() == 1

    reset(); pair(); select_and_send()
    page.evaluate("qaChannels[0].emit('encerrar-conexao',{para_id:'qa-a',de_id:'qa-b'})")
    pair('qa-c')
    page.wait_for_timeout(1700)
    assert page.evaluate("qaChannels[0].sent.filter(m=>m.event==='envio-texto').map(m=>m.payload.para_id)") == ['qa-b']

    reset(); pair(); select_and_send(False)
    page.evaluate("qaChannels[0].emit('encerrar-conexao',{para_id:'qa-a',de_id:'qa-b'})")
    assert page.locator('.envio-modal-overlay').count() == 0
    assert not page.evaluate("qaChannels[0].sent.some(m=>m.event==='envio-texto')")

    reset(); pair()
    page.evaluate("qaChannels[0].emit('envio-texto',{para_id:'qa-a',de_id:'qa-b',token:'incoming',quadro_id:'ca-copgm27:nota:qa',html:'<p>Received text</p>',texto:'Received text'})")
    page.locator('.envio-modal-enviar').wait_for()
    page.evaluate("qaUser={id:'qa-c',loginId:'session-c'};dispatchEvent(new Event('supabaseSessionChanged'))")
    assert page.locator('.envio-modal-overlay').count() == 0
    assert page.evaluate('qaWrites.length') == 0
    assert not page.evaluate('ConexaoPresenca.podeEnviar()')
    page.wait_for_function('qaChannels[0].removed')
    # A late subscribe callback cannot revive the old account's presence.
    page.evaluate("qaChannels[0].status('SUBSCRIBED')")
    assert not page.evaluate('ConexaoPresenca.estaConectado()')
    assert page.evaluate('qaChannels[0].tracked.length') == 1
    page.evaluate('ConexaoPresenca.conectar()')
    page.wait_for_function('qaChannels.length === 2')
    page.evaluate("qaChannels[1].status('SUBSCRIBED')")
    assert page.evaluate('qaChannels[1].tracked[0].id') == 'qa-c'
    assert page.evaluate('ConexaoPresenca.parAtual()') is None

    reset(); pair()
    page.evaluate("SupabaseSync.sessionUnavailable=true;dispatchEvent(new Event('supabaseSessionChanged'))")
    assert not page.evaluate('ConexaoPresenca.podeEnviar()')
    assert not page.evaluate('qaChannels[0].removed')
    page.evaluate('SupabaseSync.sessionUnavailable=false')
    assert page.evaluate('ConexaoPresenca.podeEnviar()')
    page.evaluate("qaUser=null;dispatchEvent(new Event('supabaseLogout'))")
    assert not page.evaluate('ConexaoPresenca.podeEnviar()')
    assert page.evaluate("localStorage.getItem('sentinela-par-conexao')") is None

    reset(); pair()
    page.evaluate("qaUser={id:'qa-a',loginId:'new-login'};dispatchEvent(new StorageEvent('storage',{key:'supabase_user'}))")
    assert not page.evaluate('ConexaoPresenca.podeEnviar()')
    assert page.evaluate("qaChannels[0].sent.filter(m=>m.event==='encerrar-conexao').length") == 0

    reset(); pair()
    page.evaluate('ConexaoPresenca.desconectar()')
    assert page.evaluate("qaChannels[0].sent.filter(m=>m.event==='encerrar-conexao').map(m=>m.payload.para_id)") == ['qa-b']
    assert not page.evaluate('ConexaoPresenca.estaConectado()')

    # Channel creation awaiting cleanup is also cancelled by logout.
    reset()
    page.evaluate("qaChannels[0].status('CLOSED'); window.qaRelease=null; qaChannels[0].untrack=()=>new Promise(r=>qaRelease=r); void ConexaoPresenca.conectar()")
    page.wait_for_function('qaRelease !== null')
    page.evaluate("qaUser=null;dispatchEvent(new Event('supabaseLogout'));qaRelease('ok')")
    page.wait_for_timeout(50)
    assert page.evaluate('qaChannels.length') == 1
    assert not page.evaluate('ConexaoPresenca.estaConectado()')
    assert not errors, errors
    print(f'PASS {engine.name}: delivery, sender verification, retry recipient, confirmation, account/logout lifecycle, storage failure, delayed cleanup')
    context.close(); browser.close()

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            check(playwright.chromium, '/usr/bin/chromium', origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin)
    finally:
        server.shutdown()
