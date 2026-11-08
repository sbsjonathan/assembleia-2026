"""Tutor interaction regressions against production modules and a synthetic article.

All remote requests are blocked. The AI Worker is replaced in-page by manually
resolved promises, so this suite neither sends notes nor spends AI credits.
Set WEBKIT_EXECUTABLE to also run WebKit. Keyboard coverage simulates the visual
viewport geometry; a desktop browser cannot reproduce the native iPhone keyboard.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = '/__qa__/tutor.html'
FIXTURE = '''<!doctype html>
<html lang="pt-BR" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Confie em Jeová e seja protegido — estudo sintético</title>
<link rel="stylesheet" href="/sentinela/style.css">
<link rel="stylesheet" href="/navbar/navbar-unified.css">
<link rel="stylesheet" href="/sentinela/clickable/agente-modal/agente-modal.css">
<style>
@font-face {font-family:'Noto Sans';font-style:normal;font-weight:100 900;src:url('/biblia/fonts/noto-sans-variable-latin.woff2') format('woff2')}
:root {--cor-principal-estudo:#18396c;--cor-titulo-principal:#375255;--accent:#684387;--cor-destaque:#684387;--app-accent:#684387;--navbar-real-height:70px;--navbar-safe-bottom:0px}
body {color:var(--text-main);padding-bottom:100px}
.paragrafo {line-height:1.7;margin-bottom:36px}
.qa-note {min-height:38px;border:1px solid var(--border-color);border-radius:5px;margin-bottom:24px}
.qa-end {height:1100px}
.qa-mark {display:none}
#outside-focus {width:1px;height:1px;position:absolute;top:0;left:0;opacity:0}
</style>
<script>window.estudoId='2026522';</script>
</head><body data-estudo="02-11" class="with-bottom-navbar is-pwa">
<div class="container" data-hope4-article="2026522">
<header class="barra-estudo">2 A 8 DE NOVEMBRO DE 2026</header>
<main>
<section class="secao-cantico"><p><span class="cantico">Cântico 3</span> <span class="cantico-titulo">Jeová, minha força e esperança</span></p></section>
<h1 class="estudo-titulo">Confie em Jeová e seja protegido</h1>
<p class="citacao">“Jeová é o meu refúgio.” — SAL. 91:9.</p>
<div class="objetivo"><p class="objetivo-titulo">Objetivo</p><p class="objetivo-texto">Ter certeza da proteção de Jeová, tanto agora quanto no futuro.</p></div>
<div><p class="pergunta" id="p-2026522-1"><span>1.</span> Como podemos fortalecer nossa confiança?</p></div>
<div class="qa-note comentarios" contenteditable="true">NOTA_PRIVADA_NAO_ENVIAR</div>
<p class="paragrafo" data-question-id="p-2026522-1"><span>1</span> Confiar em Jeová envolve conhecê-lo e lembrar de como ele cuida de seus servos. A oração e o estudo nos ajudam a manter essa confiança todos os dias. <em class="qa-mark">EXCLUSIVO_P1</em></p>
<div><p class="pergunta" id="p-2026522-2"><span>2.</span> O que podemos aprender dos exemplos bíblicos?</p></div>
<p class="paragrafo" data-question-id="p-2026522-2"><span>2</span> Os exemplos bíblicos mostram como a fé ajuda em momentos difíceis. <em class="qa-mark">EXCLUSIVO_P2</em><span class="anotacao">ANALISE_PRIVADA_NAO_ENVIAR</span></p>
<div><p class="pergunta" id="p-2026522-3-5"><span>3–5.</span> Como demonstrar confiança em nossas decisões?</p></div>
<p class="paragrafo" data-question-id="p-2026522-3-5"><span>3</span> Podemos buscar orientação antes de decidir. <em class="qa-mark">EXCLUSIVO_P3</em></p>
<p class="paragrafo" data-question-id="p-2026522-3-5"><span>4</span> Também podemos ouvir conselhos sábios. <em class="qa-mark">EXCLUSIVO_P4</em></p>
<p class="paragrafo" data-question-id="p-2026522-3-5"><span>5</span> Depois, precisamos agir de acordo com o que aprendemos. <em class="qa-mark">EXCLUSIVO_P5</em></p>
<div><p class="pergunta" id="p-2026522-6"><span>6.</span> Como apoiar nossos irmãos?</p></div>
<p class="paragrafo" data-question-id="p-2026522-6"><span>6</span> Podemos oferecer apoio e encorajamento. <em class="qa-mark">EXCLUSIVO_P6</em></p>
<div class="qa-end"></div>
</main></div>
<input id="outside-focus" aria-label="Foco de teste">
<nav class="bottom-navbar">
<a class="navbar-item" href="#"><div class="navbar-icon icon-home"></div><span class="navbar-label">Início</span></a>
<a class="navbar-item" href="#"><div class="navbar-icon icon-bible"></div><span class="navbar-label">Bíblia</span></a>
<a class="navbar-item" href="#"><div class="navbar-icon icon-notes"></div><span class="navbar-label">Anotações</span></a>
<a class="navbar-item active" href="#"><div class="navbar-icon icon-watchtower"></div><span class="navbar-label">A Sentinela</span></a>
<a class="navbar-item" href="#"><div class="navbar-icon icon-save"></div><span class="navbar-label">Salvar</span></a>
</nav>
<script id="sentinela-reading-position" data-study-date="2026-11-02" src="/sentinela/artigos/reading-position.js"></script>
<script src="/shared/typography.js"></script>
<script src="/sentinela/mark.js"></script>
<script src="/sentinela/imagem.js"></script>
<script src="/sentinela/clickable/agente-modal/agente-modal.js"></script>
</body></html>'''

MOCKS = '''(() => {
  window.qaRequests = [];
  window.qaPending = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options={}) => {
    const url = String(input?.url || input);
    if (!url.includes('workers.dev')) return nativeFetch(input, options);
    const request = JSON.parse(options.body || '{}');
    const record = {body:request,url,aborted:false};
    const index = qaRequests.push(record) - 1;
    return new Promise((resolve,reject) => {
      qaPending[index] = {
        resolve: (text) => resolve(new Response(JSON.stringify({text,model:'synthetic-test-model'}), {status:200,headers:{'Content-Type':'application/json'}})),
        reject
      };
      options.signal?.addEventListener('abort', () => {
        record.aborted = true;
        reject(new DOMException('Synthetic request aborted','AbortError'));
      }, {once:true});
    });
  };
  window.qaResolve = (index,text) => qaPending[index].resolve(text);
  window.qaPointerEvents = [];
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) {
    addEventListener(type,event=>qaPointerEvents.push({type,pointerType:event.pointerType,pointerId:event.pointerId,target:event.target.id}),true);
  }
  window.qaViewport = new EventTarget();
  window.qaViewportManual = false;
  window.qaUpdateViewport = (values) => {
    Object.assign(qaViewport,values);
    qaViewport.dispatchEvent(new Event('resize'));
    qaViewport.dispatchEvent(new Event('scroll'));
  };
  Object.assign(qaViewport, {width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,scale:1});
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>qaViewport});
  addEventListener('resize',()=>{
    if (!qaViewportManual) qaUpdateViewport({width:innerWidth,height:innerHeight,offsetTop:0,offsetLeft:0,pageTop:scrollY,pageLeft:0,scale:1});
  });
})();'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path.split('?')[0] == FIXTURE_PATH:
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def log_message(self, *args):
        pass


def open_question(page, number):
    page.evaluate("number => ArticleTutor.open(document.querySelector('#p-2026522-' + number + ' > span'))", number)
    page.locator('#modal-agente').wait_for(state='visible')
    page.wait_for_timeout(80)
    assert page.locator('#modal-agente:visible').count() == 1
    assert not page.locator('#agente-bolinha').is_visible()


def send(page, text):
    index = page.evaluate('qaRequests.length')
    page.locator('#agente-pergunta').fill(text)
    page.locator('#agente-enviar').click()
    page.wait_for_function('index => qaRequests.length === index + 1', arg=index)
    return index


def resolve(page, index, text, visible=True):
    page.evaluate('([index,text]) => qaResolve(index,text)', [index, text])
    if visible:
        page.wait_for_function('text => document.querySelector("#agente-thread").textContent.includes(text)', arg=text)
    else:
        page.wait_for_timeout(100)


def rect(page, selector):
    return page.locator(selector).evaluate('el => el.getBoundingClientRect().toJSON()')


def document_rect(page, selector):
    return page.locator(selector).evaluate('''el => {
      const rect=el.getBoundingClientRect();
      return {left:rect.left+scrollX,top:rect.top+scrollY,width:rect.width,height:rect.height};
    }''')


def assert_same_document_rect(actual, expected):
    assert all(abs(actual[key] - expected[key]) <= 1 for key in expected), (actual, expected)


def assert_document_anchor(page, selector):
    before = rect(page, selector)
    anchor = document_rect(page, selector)
    scroll_before = page.evaluate('scrollY')
    page.evaluate('scrollBy(0,125);qaUpdateViewport({pageTop:scrollY})')
    page.wait_for_timeout(120)
    scroll_delta = page.evaluate('scrollY') - scroll_before
    after = rect(page, selector)
    assert scroll_delta > 100, 'Fixture must have enough article to scroll.'
    assert abs(after['top'] - before['top'] + scroll_delta) <= 1, (selector, before, after, scroll_delta)
    assert_same_document_rect(document_rect(page, selector), anchor)
    page.evaluate('value=>{scrollTo(0,value);qaUpdateViewport({pageTop:scrollY})}', scroll_before)
    page.wait_for_timeout(120)


def assert_initial_clearance(page):
    box = rect(page, '#modal-agente')
    assert box['left'] >= 19 and box['right'] <= page.viewport_size['width'] - 19, box
    assert box['top'] >= 19, box
    navbar = rect(page, '.bottom-navbar')
    assert box['bottom'] <= navbar['top'] - 10, (box, navbar)


def assert_within_viewport(page, selector='#modal-agente', margin=1):
    box = rect(page, selector)
    view = page.evaluate('({width:visualViewport.width,height:visualViewport.height,top:visualViewport.offsetTop,left:visualViewport.offsetLeft})')
    assert box['left'] >= view['left'] - margin, (selector, box, view)
    assert box['right'] <= view['left'] + view['width'] + margin, (selector, box, view)
    assert box['top'] >= view['top'] - margin, (selector, box, view)
    assert box['bottom'] <= view['top'] + view['height'] + margin, (selector, box, view)


def start_drag_visual_trace(page, selector):
    visual = selector if selector == '#agente-bolinha' else '#modal-agente .modal-agente-content'
    page.wait_for_function('selector=>!document.querySelector(selector).getAnimations().some(a=>a.playState==="running")', arg=visual)
    page.evaluate('''([selector,visualSelector])=>{
      const target=document.querySelector(selector),visual=document.querySelector(visualSelector);
      const trace=window.qaDragPaint={starts:[],frames:[],release:false};
      const onAnimation=event=>{
        if(event.target===visual && event.animationName==='agente-reveal') trace.starts.push(event.animationName);
      };
      const onRelease=()=>{
        if(trace.release) return;
        trace.release=true;
        const until=performance.now()+220;
        const sample=()=>{
          const rect=target.getBoundingClientRect();
          trace.frames.push({opacity:Number(getComputedStyle(visual).opacity),
            anchor:{left:rect.left+scrollX,top:rect.top+scrollY,width:rect.width,height:rect.height}});
          if(performance.now()<until) requestAnimationFrame(sample);
        };
        sample();
      };
      document.addEventListener('animationstart',onAnimation);
      for(const type of ['pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,onRelease);
      trace.cleanup=()=>{
        document.removeEventListener('animationstart',onAnimation);
        for(const type of ['pointerup','pointercancel','lostpointercapture']) document.removeEventListener(type,onRelease);
      };
    }''', [selector, visual])


def assert_drag_visual_trace(page, expected):
    page.wait_for_timeout(250)
    trace=page.evaluate('''()=>{
      qaDragPaint.cleanup();
      return {starts:qaDragPaint.starts,frames:qaDragPaint.frames,release:qaDragPaint.release};
    }''')
    assert trace['release'] and len(trace['frames']) >= 2, trace
    assert not trace['starts'], 'Drag release must not replay the entrance animation: '+str(trace)
    assert all(frame['opacity'] >= .999 for frame in trace['frames']), 'Drag release must not fade the surface: '+str(trace)
    for frame in trace['frames']:
        assert_same_document_rect(frame['anchor'], expected)


def drag(page, selector, dx, dy):
    target = '#agente-bolinha' if selector == '#agente-bolinha' else '#modal-agente'
    start_drag_visual_trace(page, target)
    box = rect(page, selector)
    # Header centre is the text/drag region, not its right-side action buttons.
    x = box['left'] + min(box['width'] / 2, 90)
    y = box['top'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=8)
    expected = document_rect(page, target)
    page.mouse.up()
    assert_drag_visual_trace(page, expected)


def check_longpress(page):
    target = page.locator('#p-2026522-1 > span')
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.mouse.move(x + 25, y + 25)
    page.wait_for_timeout(1000)
    page.mouse.up()
    assert not page.locator('#modal-agente').is_visible(), 'Moving during the hold must cancel it.'
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.evaluate('scrollBy(0,35)')
    page.wait_for_timeout(1000)
    page.mouse.up()
    assert not page.locator('#modal-agente').is_visible(), 'Scrolling during the hold must cancel it.'
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    page.wait_for_timeout(500)
    assert not page.locator('#modal-agente').is_visible(), 'A short press must not open the tutor.'
    page.wait_for_timeout(650)
    page.mouse.up()
    page.locator('#modal-agente').wait_for(state='visible')
    assert '1' in page.locator('#agente-contexto').inner_text()
    assert page.evaluate('document.activeElement?.id') != 'agente-pergunta', 'Opening must not summon the keyboard.'


def check_conversations(page):
    # A delayed answer belongs to its original paragraph even after switching.
    first = send(page, 'PERGUNTA_A: Como posso fortalecer a confiança?')
    page.locator('#agente-pergunta').fill('Rascunho do parágrafo um')
    first_id = page.locator('#modal-agente').get_attribute('data-session-id')
    open_question(page, '2')
    assert page.locator('#agente-pergunta').input_value() == ''
    assert 'PERGUNTA_A' not in page.locator('#agente-thread').inner_text()
    assert first_id != page.locator('#modal-agente').get_attribute('data-session-id')
    second = send(page, 'PERGUNTA_B: O que aprendemos desses exemplos?')
    page.evaluate("document.querySelector('#outside-focus').focus({preventScroll:true})")
    resolve(page, first, 'RESPOSTA_A: Podemos orar e estudar diariamente.', visible=False)
    assert 'RESPOSTA_A' not in page.locator('#agente-thread').inner_text()
    resolve(page, second, 'RESPOSTA_B: Os exemplos fortalecem a nossa fé.')
    assert page.evaluate('document.activeElement.id') == 'outside-focus', 'A response must not steal focus.'
    open_question(page, '1')
    assert 'RESPOSTA_A' in page.locator('#agente-thread').inner_text()
    assert 'RESPOSTA_B' not in page.locator('#agente-thread').inner_text()
    assert page.locator('#agente-pergunta').input_value() == 'Rascunho do parágrafo um'
    first_prompt, second_prompt = page.evaluate('qaRequests.slice(0,2).map(r=>r.body.prompt)')
    assert 'EXCLUSIVO_P1' in first_prompt and 'EXCLUSIVO_P2' not in first_prompt
    assert 'EXCLUSIVO_P2' in second_prompt and 'EXCLUSIVO_P1' not in second_prompt
    assert 'PERGUNTA_A' not in second_prompt
    assert 'NOTA_PRIVADA_NAO_ENVIAR' not in first_prompt
    assert 'ANALISE_PRIVADA_NAO_ENVIAR' not in second_prompt

    page.locator('#agente-fechar').click()
    assert not page.locator('#modal-agente').is_visible()
    assert not page.locator('#agente-bolinha').is_visible()
    open_question(page, '1')
    assert 'RESPOSTA_A' in page.locator('#agente-thread').inner_text()
    assert page.locator('#agente-pergunta').input_value() == 'Rascunho do parágrafo um'

    open_question(page, '3-5')
    assert '3–5' in page.locator('#agente-contexto').inner_text()
    grouped = send(page, 'Como posso aplicar essas três ideias?')
    prompt = page.evaluate('index => qaRequests[index].body.prompt', grouped)
    assert all(f'EXCLUSIVO_P{number}' in prompt for number in (3, 4, 5)), prompt
    assert all(f'EXCLUSIVO_P{number}' not in prompt for number in (1, 2, 6)), prompt
    resolve(page, grouped, 'Primeiro, busque orientação. Depois, ouça conselhos e coloque o que aprendeu em prática.')

    # Same paragraph number in another article must start another conversation.
    page.evaluate("""() => {
      window.estudoId='2026999';
      document.querySelector('[data-hope4-article]').dataset.hope4Article='2026999';
      document.querySelector('.estudo-titulo').textContent='Outro estudo sintético';
    }""")
    open_question(page, '1')
    assert page.locator('#modal-agente').get_attribute('data-session-id') != first_id
    assert 'PERGUNTA_A' not in page.locator('#agente-thread').inner_text()
    assert page.locator('#agente-pergunta').input_value() == ''
    page.evaluate("""() => {
      window.estudoId='2026522';
      document.querySelector('[data-hope4-article]').dataset.hope4Article='2026522';
      document.querySelector('.estudo-titulo').textContent='Confie em Jeová e seja protegido';
    }""")
    open_question(page, '1')
    assert 'RESPOSTA_A' in page.locator('#agente-thread').inner_text()


def check_window_and_orb(page):
    page.locator('#agente-pergunta').focus()
    page.locator('#agente-pergunta').evaluate('el=>el.setSelectionRange(2,7)')
    before = rect(page, '#modal-agente')
    document_width = page.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth,innerWidth]')
    drag(page, '#agente-drag', 100, -55)
    after = rect(page, '#modal-agente')
    assert abs(after['y'] - before['y']) > 15, (before, after)
    assert abs(after['x'] - before['x'] - 100) <= 2, 'Mobile drag must not be limited to a few pixels.'
    assert page.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth,innerWidth]') == document_width, 'Moving the window must not widen the article.'
    assert page.evaluate('document.activeElement.id') == 'agente-pergunta'
    assert page.locator('#agente-pergunta').evaluate('el=>[el.selectionStart,el.selectionEnd]') == [2, 7]
    assert_document_anchor(page, '#modal-agente')
    # Move the window back so its minimise control remains visible.
    drag(page, '#agente-drag', -100, 55)
    page.locator('#agente-minimizar').click()
    page.locator('#agente-bolinha').wait_for(state='visible')
    assert not page.locator('#modal-agente').is_visible()
    assert page.locator('#agente-bolinha').evaluate('el=>getComputedStyle(el).position') == 'absolute'
    assert_document_anchor(page, '#agente-bolinha')
    orb_before = rect(page, '#agente-bolinha')
    dx = 100 if orb_before['left'] < page.viewport_size['width'] / 2 else -100
    drag(page, '#agente-bolinha', dx, -75)
    moved = rect(page, '#agente-bolinha')
    assert page.locator('#agente-bolinha').is_visible(), 'Dragging the orb must not expand it.'
    assert abs(moved['left'] - orb_before['left'] - dx) <= 2, (orb_before, moved)
    assert abs(moved['top'] - orb_before['top'] + 75) <= 2, 'Bubble must not snap back to an edge.'
    assert_document_anchor(page, '#agente-bolinha')
    assert_within_viewport(page, '#agente-bolinha')
    page.locator('#agente-bolinha').click()
    page.locator('#modal-agente').wait_for(state='visible')
    assert 'RESPOSTA_A' in page.locator('#agente-thread').inner_text()
    assert page.locator('#agente-pergunta').input_value() == 'Rascunho do parágrafo um'
    assert page.evaluate('document.activeElement.id') != 'agente-pergunta', 'Restoring must not summon the keyboard.'


def check_stop_retry_reset_and_keyboard(page):
    open_question(page, '6')
    index = send(page, 'PERGUNTA_CANCELADA: Como apoiar os irmãos?')
    page.get_by_role('button', name='Parar resposta', exact=True).click()
    page.wait_for_function('index => qaRequests[index].aborted && !ArticleTutor.getState().pending', arg=index)
    assert 'interrompida' in page.locator('#agente-status').inner_text()
    page.get_by_role('button', name='Tentar novamente', exact=True).click()
    page.wait_for_function('index => qaRequests.length === index + 2', arg=index)
    unsafe = '<img src=x onerror="window.qaUnsafe=1"><script>window.qaUnsafe=1</script>'
    resolve(page, index + 1, 'Apoie com palavras bondosas. ' + unsafe)
    assert page.locator('#agente-thread .agente-message--user').count() == 1, 'Retry must not duplicate the user turn.'
    assert page.locator('#agente-thread img, #agente-thread script').count() == 0, 'AI text must not become executable HTML.'
    assert not page.evaluate('Boolean(window.qaUnsafe)')
    pending = send(page, 'PERGUNTA_APAGADA: Mais uma aplicação?')
    page.locator('#agente-reset').click()
    page.wait_for_function('index => qaRequests[index].aborted && !ArticleTutor.getState().pending', arg=pending)
    assert 'PERGUNTA_APAGADA' not in page.locator('#agente-thread').inner_text()
    assert page.locator('#agente-thread .agente-message').count() == 0
    open_question(page, '1')
    assert 'RESPOSTA_A' in page.locator('#agente-thread').inner_text(), 'Reset must affect only its own paragraph.'

    page.locator('#agente-fechar').click()
    page.locator('#p-2026522-1 > span').focus()
    page.keyboard.press('Enter')
    page.locator('#modal-agente').wait_for(state='visible')
    page.wait_for_function("document.activeElement.id === 'agente-fechar'")
    page.locator('#agente-expandir').click()
    for _ in range(12):
        page.keyboard.press('Tab')
        assert page.evaluate("document.querySelector('#modal-agente').contains(document.activeElement)")
    page.keyboard.press('Escape')
    assert page.locator('#modal-agente').get_attribute('data-mode') == 'window'
    page.keyboard.press('Escape')
    assert not page.locator('#modal-agente').is_visible()
    assert page.evaluate("document.activeElement === document.querySelector('#p-2026522-1 > span')")
    open_question(page, '1')


def assert_native_composer_reachable(page):
    # A short landscape viewport can make the article-style modal body scroll.
    # Controls must be reachable through that native ancestor, not merely have
    # bounding boxes inside the viewport while hidden behind overflow clipping.
    anchor=document_rect(page,'#modal-agente')
    result=page.locator('#modal-agente .agente-modal-body').evaluate('''body => {
      const before=body.scrollTop;
      body.scrollTop=body.scrollHeight;
      const port=body.getBoundingClientRect();
      const field=document.querySelector('#agente-pergunta').getBoundingClientRect();
      const send=document.querySelector('#agente-enviar').getBoundingClientRect();
      const target=document.elementFromPoint(send.left+send.width/2,send.top+send.height/2);
      return {port:port.toJSON(),field:field.toJSON(),send:send.toJSON(),
        hit:Boolean(target?.closest('#agente-enviar')),before,after:body.scrollTop,
        overflow:getComputedStyle(body).overflowY};
    }''')
    assert result['overflow'] in ('auto','scroll'), result
    assert result['field']['top']>=result['port']['top']-1 and result['field']['bottom']<=result['port']['bottom']+1, result
    assert result['send']['top']>=result['port']['top']-1 and result['send']['bottom']<=result['port']['bottom']+1, result
    assert result['hit'], 'Send button must be hit-testable after native body scrolling: '+str(result)
    assert_same_document_rect(document_rect(page,'#modal-agente'),anchor)


def keyboard_snapshot(page):
    return page.evaluate('''() => {
      const panel=document.querySelector('#modal-agente');
      const field=document.querySelector('#agente-pergunta');
      const box=panel.getBoundingClientRect();
      return {
        style:Object.fromEntries(['top','left','width','height','max-height'].map(name=>[name,panel.style.getPropertyValue(name)])),
        anchor:{left:box.left+scrollX,top:box.top+scrollY,width:box.width,height:box.height},
        focus:document.activeElement?.id,selection:[field.selectionStart,field.selectionEnd],
        scroll:scrollY
      };
    }''')


def keyboard_trace(page, steps, *, inner_height_changes=False):
    """Replay resize/pan events without pretending to create an iOS keyboard.

    Native focus reveal is represented by a captured browser scroll method.
    Application scrolling/focus calls are recorded separately. End-state-only
    viewport-fit assertions previously missed the repeated relocation bug.
    """
    return page.evaluate('''async ({steps,innerHeightChanges}) => {
      const panel=document.querySelector('#modal-agente');
      const viewportHeight=innerHeight;
      const descriptor=Object.getOwnPropertyDescriptor(window,'innerHeight');
      const scrollMethods={scrollTo:window.scrollTo,scrollBy:window.scrollBy};
      const nativeScrollTo=window.scrollTo.bind(window);
      const nativeFocus=HTMLElement.prototype.focus;
      const nativeIntoView=Element.prototype.scrollIntoView;
      const startScroll=scrollY;
      const isolatedFullscreen=panel.dataset.mode==='fullscreen';
      const writes=[],calls=[],frames=[];
      const observer=new MutationObserver(records=>records.forEach(record=>writes.push({
        name:record.attributeName,before:record.oldValue,after:panel.getAttribute(record.attributeName)
      })));
      observer.observe(panel,{attributes:true,attributeOldValue:true,attributeFilter:['style','data-compact']});
      window.scrollTo=function(...args){calls.push('scrollTo');return scrollMethods.scrollTo.apply(this,args)};
      window.scrollBy=function(...args){calls.push('scrollBy');return scrollMethods.scrollBy.apply(this,args)};
      HTMLElement.prototype.focus=function(...args){calls.push('focus:'+this.id);return nativeFocus.apply(this,args)};
      Element.prototype.scrollIntoView=function(...args){calls.push('scrollIntoView:'+this.id);return nativeIntoView.apply(this,args)};
      const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      qaViewportManual=true;
      try {
        for(const step of steps) {
          if(innerHeightChanges) Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>step.height});
          // Fullscreen has only one layout viewport of document content. iOS
          // can pan its smaller visual viewport within that surface even when
          // root scrollY remains zero. Keep window-mode document pan unchanged.
          let visualTop=step.offsetTop||0;
          if(isolatedFullscreen) {
            const maxPan=Math.max(0,viewportHeight-step.height);
            visualTop=Math.min(maxPan,visualTop+(step.pan||0));
            if(step.reveal) {
              const field=document.querySelector('#agente-pergunta').getBoundingClientRect();
              visualTop=Math.min(maxPan,Math.max(0,field.bottom-step.height+20));
            }
          } else {
            if(step.pan!==undefined) nativeScrollTo(0,startScroll+step.pan);
            if(step.reveal) {
              const field=document.querySelector('#agente-pergunta').getBoundingClientRect();
              nativeScrollTo(0,scrollY+field.bottom-step.height+20);
            }
          }
          qaUpdateViewport({height:step.height,width:step.width||innerWidth,offsetTop:visualTop,
            offsetLeft:step.offsetLeft||0,pageTop:scrollY+visualTop,pageLeft:scrollX+(step.offsetLeft||0),scale:step.scale||1});
          // WebKit may also dispatch a same-width window resize while animating
          // keyboard/accessory bars; it must not be treated as device rotation.
          dispatchEvent(new Event('resize'));
          await tick();
          const rect=panel.getBoundingClientRect(),field=document.querySelector('#agente-pergunta');
          frames.push({
            style:Object.fromEntries(['top','left','width','height','max-height'].map(name=>[name,panel.style.getPropertyValue(name)])),
            anchor:{left:rect.left+scrollX,top:rect.top+scrollY,width:rect.width,height:rect.height},
            focus:document.activeElement?.id,selection:[field.selectionStart,field.selectionEnd],
            scroll:scrollY,
            field:field.getBoundingClientRect().toJSON(),
            viewport:{height:step.height,top:visualTop},reveal:Boolean(step.reveal)
          });
        }
      } finally {
        observer.disconnect();
        window.scrollTo=scrollMethods.scrollTo;window.scrollBy=scrollMethods.scrollBy;
        HTMLElement.prototype.focus=nativeFocus;Element.prototype.scrollIntoView=nativeIntoView;
        if(descriptor) Object.defineProperty(window,'innerHeight',descriptor);
        else delete window.innerHeight;
        qaViewportManual=false;
        qaUpdateViewport({height:viewportHeight,width:innerWidth,offsetTop:0,offsetLeft:0,pageTop:scrollY,pageLeft:scrollX,scale:1});
      }
      return {writes,calls,frames};
    }''', {'steps':steps,'innerHeightChanges':inner_height_changes})


def assert_keyboard_stability(page, *, inner_height_changes=False):
    field=page.locator('#agente-pergunta')
    field.fill('Texto com seleção preservada durante o teclado')
    field.evaluate('el=>el.setSelectionRange(6,18)')
    page.wait_for_timeout(100)
    before=keyboard_snapshot(page)
    full_height=page.viewport_size['height']
    steps=[
        {'height':full_height-90,'offsetTop':0,'pan':0},
        {'height':full_height-210,'offsetTop':18,'pan':45},
        {'height':450,'offsetTop':42,'pan':95},
        {'height':375,'offsetTop':70,'pan':130},
        # Suggestion/accessory-bar changes and native pan occur with focus held.
        {'height':401,'offsetTop':58,'pan':145},
        {'height':375,'offsetTop':70,'pan':155},
        {'height':375,'offsetTop':0,'reveal':True},
        {'height':450,'offsetTop':42,'pan':95},
        {'height':full_height-120,'offsetTop':12,'pan':35},
        {'height':full_height,'offsetTop':0,'pan':0},
    ]
    trace=keyboard_trace(page,steps,inner_height_changes=inner_height_changes)
    for frame in trace['frames']:
        assert frame['style']==before['style'], ('Keyboard event rewrote panel geometry',before,frame)
        assert_same_document_rect(frame['anchor'],before['anchor'])
        assert frame['focus']=='agente-pergunta' and frame['selection']==[6,18], frame
        if frame['reveal']:
            assert frame['field']['top']>=frame['viewport']['top'] and frame['field']['bottom']<=frame['viewport']['top']+frame['viewport']['height'], ('Native focus scroll must expose the field',frame)
    assert not trace['writes'], 'Keyboard resize/scroll must not write modal layout: '+str(trace['writes'])
    assert not trace['calls'], 'The browser owns keyboard scrolling/focus: '+str(trace['calls'])
    if page.locator('#modal-agente').get_attribute('data-mode') == 'fullscreen':
        assert any(frame['viewport']['top']>100 for frame in trace['frames']), 'Visual viewport pan must remain possible within fullscreen.'
        assert all(abs(frame['scroll'])<=1 for frame in trace['frames']), 'Fullscreen must not inherit article-length document scrolling.'
    else:
        assert any(frame['scroll']>before['scroll']+100 for frame in trace['frames']), 'Native pan must remain possible.'

    # A hardware/floating keyboard may leave the viewport unchanged. Pinch zoom
    # reduces only the visual viewport width; neither is a reason to recenter.
    before=keyboard_snapshot(page)
    trace=keyboard_trace(page,[
        {'height':full_height,'pan':0},
        {'height':full_height-18,'offsetTop':6,'pan':15},
        {'height':full_height/1.25,'width':page.viewport_size['width']/1.25,'scale':1.25,'offsetTop':45,'offsetLeft':20,'pan':30},
        {'height':full_height,'pan':0},
    ])
    assert not trace['writes'] and not trace['calls'], trace
    for frame in trace['frames']:
        assert frame['style']==before['style'], frame
        assert_same_document_rect(frame['anchor'],before['anchor'])
        assert frame['focus']=='agente-pergunta' and frame['selection']==[6,18], frame
    # Text input itself must not resize or recenter the modal while the caret is
    # active. Long drafts scroll inside the textarea, as in the original modal.
    field_box=rect(page,'#agente-pergunta')
    field.fill('Linha de teste com conteúdo suficiente para preencher a largura.\n'*12)
    field.evaluate('el=>{el.setSelectionRange(el.value.length,el.value.length);el.scrollTop=el.scrollHeight}')
    page.wait_for_timeout(60)
    assert abs(rect(page,'#agente-pergunta')['height']-field_box['height'])<=1
    assert page.locator('#agente-pergunta').evaluate('el=>el.scrollHeight>el.clientHeight && el.scrollTop>0'), 'Long drafts must scroll inside their stable input.'
    assert_same_document_rect(document_rect(page,'#modal-agente'),before['anchor'])
    field.blur()
    page.wait_for_timeout(100)
    assert_same_document_rect(document_rect(page,'#modal-agente'),before['anchor'])


def assert_fullscreen_entry_during_keyboard(page):
    # The user can expand while typing. Some WebKit configurations shorten
    # innerHeight as well as visualViewport; capturing it would leave fullscreen
    # permanently keyboard-sized after the same-width keyboard-close resize.
    window_anchor=document_rect(page,'#modal-agente')
    page.locator('#agente-pergunta').focus()
    result=page.evaluate('''async () => {
      const panel=document.querySelector('#modal-agente'),height=innerHeight;
      const descriptor=Object.getOwnPropertyDescriptor(window,'innerHeight');
      const writes=[];
      const observer=new MutationObserver(records=>records.forEach(record=>writes.push(record.attributeName)));
      const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      qaViewportManual=true;
      let opened,settled;
      try {
        Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>375});
        qaUpdateViewport({height:375,width:innerWidth,offsetTop:55,pageTop:scrollY+55});
        dispatchEvent(new Event('resize'));
        await tick();
        document.querySelector('#agente-expandir').click();
        await tick();
        opened={height:panel.getBoundingClientRect().height,style:panel.getAttribute('style'),mode:panel.dataset.mode};
        observer.observe(panel,{attributes:true,attributeFilter:['style','data-compact']});
        if(descriptor) Object.defineProperty(window,'innerHeight',descriptor);
        else delete window.innerHeight;
        qaUpdateViewport({height,width:innerWidth,offsetTop:0,pageTop:scrollY});
        dispatchEvent(new Event('resize'));
        await tick();
        settled={height:panel.getBoundingClientRect().height,style:panel.getAttribute('style'),mode:panel.dataset.mode};
      } finally {
        observer.disconnect();
        if(descriptor) Object.defineProperty(window,'innerHeight',descriptor);
        else delete window.innerHeight;
        qaViewportManual=false;
        qaUpdateViewport({height,width:innerWidth,offsetTop:0,pageTop:scrollY});
      }
      return {height,opened,settled,writes};
    }''')
    assert result['opened']['mode']=='fullscreen' and result['settled']['mode']=='fullscreen', result
    assert abs(result['opened']['height']-result['height'])<=1, 'Expanding during typing must use the resting layout height: '+str(result)
    assert result['settled']['style']==result['opened']['style'] and not result['writes'], result
    page.locator('#agente-expandir').click()
    assert_same_document_rect(document_rect(page,'#modal-agente'),window_anchor)



def assert_fullscreen_document_isolated(page):
    result=page.evaluate('''() => {
      const root=document.documentElement,body=document.body,panel=document.querySelector('#modal-agente');
      return {height:innerHeight,root:root.scrollHeight,body:body.scrollHeight,scroll:scrollY,
        panel:panel.getBoundingClientRect().toJSON(),rootOverflow:getComputedStyle(root).overflowY,
        bodyPosition:getComputedStyle(body).position,articleDisplay:getComputedStyle(document.querySelector('.container')).display};
    }''')
    assert result['root']<=result['height']+2, 'Fullscreen must not retain the article-sized document: '+str(result)
    assert abs(result['scroll'])<=1 and abs(result['panel']['top'])<=1, result
    assert result['articleDisplay']=='none', 'The hidden article must leave the fullscreen layout.'
    assert result['rootOverflow'] not in ('hidden','clip'), 'Keep native keyboard viewport panning available.'
    assert result['bodyPosition']!='fixed', 'Do not reintroduce a fixed-body keyboard lock.'


def check_fullscreen_scroll_isolation(page):
    page.evaluate("ArticleTutor.close();scrollTo(0,1150)")
    page.wait_for_timeout(100)
    open_question(page,'3-5')
    page.evaluate("SentinelaReadingPosition.save();document.querySelector('#outside-focus').inert=true")
    baseline=page.evaluate('''() => ({scroll:scrollY,height:document.documentElement.scrollHeight,
      rootStyle:document.documentElement.getAttribute('style')||'',bodyStyle:document.body.getAttribute('style')||'',
      articleStyle:document.querySelector('.container').getAttribute('style'),articleInert:document.querySelector('.container').inert})''')
    anchor=document_rect(page,'#modal-agente')
    assert baseline['height']>page.viewport_size['height']*2, baseline
    assert baseline['scroll']>500, 'Exercise a modal opened deep inside a long article.'

    def restored():
        result=page.evaluate('''() => ({scroll:scrollY,height:document.documentElement.scrollHeight,
          rootStyle:document.documentElement.getAttribute('style')||'',bodyStyle:document.body.getAttribute('style')||'',
          articleStyle:document.querySelector('.container').getAttribute('style'),articleInert:document.querySelector('.container').inert})''')
        assert abs(result['scroll']-baseline['scroll'])<=1, ('Fullscreen must restore the exact article position',baseline,result)
        assert abs(result['height']-baseline['height'])<=1, (baseline,result)
        assert page.locator('#outside-focus').evaluate('el=>el.inert'), 'Originally inert siblings must remain inert.'
        for key in ('rootStyle','bodyStyle','articleStyle','articleInert'):
            assert result[key]==baseline[key], (key,baseline,result)

    for cycle in range(2):
        page.locator('#agente-expandir').click()
        assert_fullscreen_document_isolated(page)
        page.evaluate('SentinelaReadingPosition.save()')
        page.wait_for_timeout(230)
        saved=page.evaluate('JSON.parse(localStorage.getItem(SentinelaReadingPosition.key))')
        assert abs(saved['y']-baseline['scroll'])<=1, ('Fullscreen must not overwrite the saved reading anchor',saved,baseline)
        # App modules may append UI while the tutor is open. Such a sibling
        # must not reintroduce the article's scroll or create an empty canvas.
        page.evaluate('''() => {
          const node=document.createElement('div');node.id='qa-late-sibling';
          node.style.height='9000px';document.body.append(node);
        }''')
        assert_fullscreen_document_isolated(page)
        page.evaluate("document.querySelector('#qa-late-sibling').remove()")
        page.evaluate('scrollBy(0,1500)')
        if page.context.browser.browser_type.name == 'chromium':
            page.mouse.move(210,300)
            page.mouse.wheel(0,1500)
        page.wait_for_timeout(100)
        assert_fullscreen_document_isolated(page)
        if cycle==0:
            index=send(page,'Verificar uma conversa longa em tela cheia')
            resolve(page,index,('Resposta de teste para a rolagem da conversa. '*180).strip())
            assert page.locator('#agente-thread').evaluate('el=>el.scrollHeight>el.clientHeight+200'), 'Long chat must scroll inside its own transcript.'
            page.locator('#agente-thread').evaluate('el=>el.scrollTop=el.scrollHeight')
            assert page.locator('#agente-thread').evaluate('el=>el.scrollTop>100')
            assert_fullscreen_document_isolated(page)
            assert_native_composer_reachable(page)
        page.locator('#agente-expandir').click()
        restored()
        assert_same_document_rect(document_rect(page,'#modal-agente'),anchor)

    page.locator('#agente-expandir').click()
    page.locator('#agente-minimizar').click()
    restored()
    assert_within_viewport(page,'#agente-bolinha')
    assert_document_anchor(page,'#agente-bolinha')
    page.locator('#agente-bolinha').click()
    assert_fullscreen_document_isolated(page)
    page.locator('#agente-fechar').click()
    restored()
    assert not page.locator('#modal-agente').is_visible()
    page.evaluate("document.querySelector('#outside-focus').inert=false")
    open_question(page,'3-5')


def check_fullscreen_and_viewport(page):
    anchor=document_rect(page,'#modal-agente')
    for full in (False,True):
        if full:
            page.locator('#agente-expandir').click()
            page.wait_for_function("document.querySelector('#modal-agente').dataset.mode === 'fullscreen'")
            assert_within_viewport(page)
        assert page.evaluate("!['hidden','clip'].includes(getComputedStyle(document.documentElement).overflowY)"), 'Fullscreen must leave native document focus scrolling available.'
        assert_keyboard_stability(page)
        assert_keyboard_stability(page,inner_height_changes=True)
        if full:
            page.locator('#agente-expandir').click()
            page.wait_for_function("document.querySelector('#modal-agente').dataset.mode === 'window'")
            assert_same_document_rect(document_rect(page,'#modal-agente'),anchor)
    assert_fullscreen_entry_during_keyboard(page)
    assert_document_anchor(page,'#modal-agente')
    page.set_viewport_size({'width':320,'height':568})
    page.wait_for_timeout(220)
    assert_within_viewport(page)
    assert_within_viewport(page,'#agente-pergunta')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Narrow screens must not gain horizontal scrolling.'
    page.locator('#agente-minimizar').click()
    page.set_viewport_size({'width':568,'height':320})
    page.wait_for_timeout(220)
    assert_within_viewport(page,'#agente-bolinha')
    page.locator('#agente-bolinha').click()
    assert_within_viewport(page)
    assert_within_viewport(page,'#agente-pergunta')
    assert_native_composer_reachable(page)


def check_cancelled_drag(page):
    for handle, target in [('.modal-agente-header', '#modal-agente'), ('#agente-bolinha', '#agente-bolinha')]:
        if target == '#agente-bolinha': page.locator('#agente-minimizar').click()
        for event_name in ('pointercancel', 'lostpointercapture'):
            start_drag_visual_trace(page, target)
            box = rect(page, handle)
            x, y = box['left'] + min(50, box['width'] / 2), box['top'] + box['height'] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x - 12, y - 12, steps=3)
            expected = document_rect(page, target)
            pointer_id = page.evaluate("qaPointerEvents.filter(e=>e.type==='pointerdown').at(-1).pointerId")
            page.locator(handle).evaluate('''(el,values)=>{
              if(values[0]==='lostpointercapture') el.releasePointerCapture(values[1]);
              else el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:values[1],pointerType:'mouse',bubbles:true}));
            }''', [event_name, pointer_id])
            page.mouse.up()
            assert_drag_visual_trace(page, expected)
            assert page.locator(target).is_visible(), f'{event_name} must keep the current mode.'
            assert not page.locator('.is-dragging').count(), f'{event_name} must clean up drag state.'
    page.wait_for_timeout(350)
    page.locator('#agente-bolinha').click()
    assert page.locator('#modal-agente').is_visible()


def check_touch_drag(page, context):
    session = context.new_cdp_session(page)
    def move(handle, target, dx, dy):
        start_drag_visual_trace(page, target)
        box = rect(page, handle)
        before = rect(page, target)
        scroll = page.evaluate('scrollY')
        document_width = page.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth,innerWidth]')
        start = page.evaluate('qaPointerEvents.length')
        x, y = box['left'] + min(50, box['width'] / 2), box['top'] + box['height'] / 2
        session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for step in range(1, 9):
            session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * step / 8, 'y': y + dy * step / 8}]})
        # CDP can acknowledge the final move before its coalesced pointermove
        # reaches the page. Observe that move before comparing release frames.
        page.wait_for_function('''({target,x,y})=>{
          const box=document.querySelector(target).getBoundingClientRect();
          return Math.abs(box.left-x)<=2 && Math.abs(box.top-y)<=2;
        }''', arg={'target':target,'x':before['left']+dx,'y':before['top']+dy})
        expected = document_rect(page, target)
        session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        assert_drag_visual_trace(page, expected)
        after = rect(page, target)
        events = page.evaluate('start=>qaPointerEvents.slice(start)', start)
        assert any(event['type'] == 'pointerup' and event['pointerType'] == 'touch' for event in events), events
        assert not any(event['type'] == 'pointercancel' for event in events), events
        assert abs(after['left'] - before['left'] - dx) <= 2, (before, after)
        assert abs(after['top'] - before['top'] - dy) <= 2, (before, after)
        assert page.evaluate('scrollY') == scroll, 'Dragging must not pan the article.'
        assert page.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth,innerWidth]') == document_width, 'Touch drag must not widen the article.'

    move('#agente-drag', '#modal-agente', 100, -35)
    drag(page, '#agente-drag', -100, 35)
    page.locator('#agente-minimizar').click()
    move('#agente-bolinha', '#agente-bolinha', -95, 50)
    assert page.locator('#agente-bolinha').is_visible(), 'Touch drag must not restore the window.'
    page.locator('#agente-bolinha').click()
    assert_initial_clearance(page)
    session.detach()


def check_theme(page):
    def styles():
        return page.evaluate('''() => Object.fromEntries(['#agente-enviar','#agente-bolinha','.modal-agente-header','.agente-input-row'].map(selector=>{
          const style=getComputedStyle(document.querySelector(selector));
          return [selector,{background:style.backgroundColor,color:style.color}];
        }))''')

    # The article menu applies the user's global accent on body. Its root
    # --cor-global alias can still refer to the previous study's root value.
    page.evaluate("document.documentElement.style.setProperty('--cor-global','#b34e21');document.body.style.setProperty('--cor-principal-estudo','#0d7669')")
    first = styles()
    page.evaluate("document.body.style.setProperty('--cor-principal-estudo','#b34e21')")
    second = styles()
    assert first['#agente-enviar'] != second['#agente-enviar'], (first, second)
    assert first['#agente-bolinha'] != second['#agente-bolinha'], (first, second)
    assert first['.agente-input-row'] != second['.agente-input-row'], 'Input tint must follow the global color.'
    page.evaluate("document.body.style.removeProperty('--cor-principal-estudo');document.documentElement.style.setProperty('--cor-principal-estudo','initial')")
    fallback = styles()
    assert fallback == second, 'Without the article token, Tutor must follow the global accent.'
    page.evaluate("document.documentElement.dataset.theme='dark'")
    dark = styles()
    assert dark['.modal-agente-header']['background'] != fallback['.modal-agente-header']['background'], (fallback, dark)
    page.evaluate("document.documentElement.dataset.theme='light'")


def check_layout_matrix(browser, engine_name, origin):
    screenshots = Path(os.environ.get('TUTOR_SCREENSHOT_DIR', '/workspace/scratch/tutor-anchor-preview'))
    screenshots.mkdir(parents=True, exist_ok=True)
    cases = [(375, 812, 3, 'light'), (375, 812, 11, 'dark'),
             (430, 873, 3, 'light'), (430, 873, 11, 'dark'),
             (932, 430, 11, 'light'), (1280, 900, 11, 'dark')]
    for width, height, level, theme in cases:
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      is_mobile=width < 1000, has_touch=width < 1000, service_workers='block')
        context.route('**/*', lambda route: route.continue_()
                      if route.request.url.startswith(origin + '/') else route.abort())
        context.add_init_script(MOCKS)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin + FIXTURE_PATH)
        page.wait_for_function('window.ArticleTutor && window.GlobalFontScale')
        page.evaluate('document.fonts.ready')
        page.evaluate('''([level,theme])=>{
          GlobalFontScale.setLevel(level);
          document.documentElement.dataset.theme=theme;
          qaUpdateViewport({width:innerWidth,height:innerHeight});
          scrollTo(0,700);
        }''', [level, theme])
        open_question(page, '3-5')
        assert_initial_clearance(page)
        assert_within_viewport(page, '#agente-pergunta')
        assert_native_composer_reachable(page)
        assert_document_anchor(page, '#modal-agente')
        if engine_name == 'chromium' and width in (375, 430) and level == 3:
            check_touch_drag(page, context)
        initial_size = rect(page, '#modal-agente')
        index = send(page, 'Como aplicar essas ideias no dia a dia?')
        resolve(page, index, 'Procure orientação antes de decidir. Ouça conselhos e coloque o que aprendeu em prática.')
        page.locator('#agente-pergunta').blur()
        page.screenshot(path=str(screenshots / f'{engine_name}-{width}x{height}-nivel{level}-{theme}.png'))
        assert page.locator('#agente-thread').evaluate('el=>el.scrollWidth<=el.clientWidth+1'), 'Reading level must not create horizontal overflow.'
        assert rect(page, '#modal-agente')['width'] == initial_size['width']
        page.locator('#agente-minimizar').click()
        assert_document_anchor(page, '#agente-bolinha')
        page.locator('#agente-bolinha').click()
        assert_initial_clearance(page)
        page.locator('#agente-expandir').click()
        assert_within_viewport(page)
        assert_within_viewport(page, '#agente-pergunta')
        assert_native_composer_reachable(page)
        page.locator('#agente-expandir').click()
        assert_initial_clearance(page)
        assert not errors, errors
        context.close()
    return len(cases)


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873},
                                  is_mobile=True, has_touch=True, service_workers='block')
    context.route('**/*', lambda route: route.continue_()
                  if route.request.url.startswith(origin + '/') else route.abort())
    context.add_init_script(MOCKS)
    context.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true});")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(origin + FIXTURE_PATH + '?d=2026-11-02')
        page.wait_for_function('window.ArticleTutor')
        page.evaluate('document.fonts.ready')
        # WebKit applies the mobile meta viewport after its initial script
        # realm is created; initialise the mock from the settled dimensions.
        page.evaluate('qaUpdateViewport({width:innerWidth,height:innerHeight})')
        check_longpress(page)
        check_conversations(page)
        check_window_and_orb(page)
        check_cancelled_drag(page)
        check_stop_retry_reset_and_keyboard(page)
        check_theme(page)
        check_fullscreen_scroll_isolation(page)
        check_fullscreen_and_viewport(page)
        assert not errors, errors
        cases = check_layout_matrix(browser, engine.name, origin)
        print(json.dumps({'engine': engine.name, 'longpressCancellation': 'passed',
                          'paragraphAndArticleIsolation': 'passed', 'pendingAnswerRouting': 'passed',
                          'draftAndHistoryRetention': 'passed', 'documentAnchoredWindowAndOrb': 'passed',
                          'freeHorizontalDragAndCancellation': 'passed', 'globalThemeColor': 'passed',
                          'dragReleaseOpacityAndNoAnimationReplay': 'passed',
                          'stopRetryResetAndSafeRendering': 'passed', 'keyboardAccessibility': 'passed',
                          'focusPreservation': 'passed', 'nativeKeyboardTimelineAndStableAnchors': 'passed',
                          'fullscreenDocumentIsolationAndRestore': 'passed',
                          'narrowAndLandscapeClamping': 'passed', 'layoutCases': cases}), flush=True)
    finally:
        browser.close()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as playwright:
            check(playwright.chromium, os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin)
    finally:
        server.shutdown()
