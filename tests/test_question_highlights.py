"""Question-highlight regressions through the production generation entry point.

Synthetic Gemini responses exercise source extraction, validation, DOM marking,
manual ownership and transport. No AI or Supabase requests leave the browser.
Run with WEBKIT_EXECUTABLE to include WebKit as well as Chromium.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
QUESTION = 'Em breve, que acontecimentos vão abalar a Terra?'
FIRST = 'Jeová irá colocar no coração dos governantes o “pensamento dele”, ou seja, de dar “à fera [a ONU] o reino que possuem”.'
SECOND = 'Daí a fera, cheia de poder e com total apoio de todos os governos, acabará com as organizações religiosas falsas de uma vez por todas.'
THIRD = 'Nações do mundo todo vão trabalhar juntas num ataque total ao povo de Jeová.'
SATAN = '“Influenciadas por Satanás, as nações vão tentar eliminar da Terra os adoradores verdadeiros e, junto com eles, a adoração pura.”'
FOURTH = 'Então, o momento mais importante de todos irá acontecer: a guerra do Armagedom. Jesus vai liderar seu exército celestial, o que inclui os 144 mil, para destruir os maus e abrir para nós as portas do novo mundo justo de Jeová.'

FIXTURE = '''<!doctype html><html lang="pt-BR" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perguntas — fixture de marcação</title>
<link rel="stylesheet" href="/sentinela/style.css">
<style>body{margin:0;padding:18px}.pergunta{margin-top:28px}.paragrafo{font-size:18px;line-height:1.65}.anotacao{display:block;max-height:none!important}.qa-spacer{height:300px}</style>
</head><body data-estudo="02-11"><main>
<h1 class="estudo-titulo">Confie em Jeová e seja protegido</h1>
<div><p class="pergunta" id="p-1-2"><span>1–2.</span> Em breve, que acontecimentos vão abalar a Terra?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-1-2"><button class="btn-gerar-ia">Gerar</button><div id="r-1-2"></div></div></div>
<div class="comentarios" contenteditable="true">PRIVATE_USER_NOTE</div>
<p class="paragrafo" id="pg-1" data-question-id="p-1-2"><span>1</span> VIVEMOS nos últimos dos últimos dias. Em breve, acontecerão coisas que vão abalar o mundo. Jeová irá colocar no coração dos <mark class="hl-color-purple" data-hl-id="manual-existing" id="manual-existing">governantes</mark> o “pensamento dele”, ou seja, de dar “à fera [a ONU] o reino que possuem”.<a class="footnote-link" id="note-1" href="#note">*</a> (<a class="bbl" id="bible-1" href="#bible">Apo. 17:17</a>) Daí a fera, cheia de poder e com total apoio de todos os governos, acabará com as organizações religiosas falsas de uma vez por todas. (<a class="bbl" href="#bible2">Apo. 17:16</a>) Esse evento irá marcar o início da grande tribulação. Mas e depois?</p>
<figure><figcaption>Uma figura sem imagem interrompe o mapeamento legado.</figcaption></figure>
<p class="paragrafo" id="pg-2"><span>2</span> Teremos mais acontecimentos marcantes. Nações do mundo todo vão trabalhar juntas num ataque total ao povo de Jeová. (<a class="bbl" href="#bible3">Eze. 38:14-16</a>) Por quê? O livro <em id="book-title">A Adoração Pura de Jeová É Restaurada!</em> explica: “Influenciadas por Satanás, as nações vão tentar eliminar da Terra os adoradores verdadeiros e, junto com eles, a adoração pura.” Então, o momento mais importante de todos irá acontecer: a guerra do Armagedom. Jesus vai liderar seu exército celestial, o que inclui os 144 mil, para destruir os maus e abrir para nós as portas do novo mundo justo de Jeová.</p>
<div><p class="pergunta" id="p-3"><span>3.</span> (a) O que fortalece nossa confiança? (b) Por que isso é importante?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-3"><button class="btn-gerar-ia">Gerar</button><div id="r-3"></div></div></div>
<p class="paragrafo" id="pg-3" data-question-id="p-3"><span>3</span> A oração fortalece nossa confiança. Ela nos ajuda a continuar firmes. <span class="anotacao">PRIVATE_INLINE_NOTE</span></p>
<div><p class="pergunta" id="p-4"><span>4.</span> Como mostramos confiança, e por que isso nos ajuda?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-4"><button class="btn-gerar-ia">Gerar</button><div id="r-4"></div></div></div>
<p class="paragrafo" id="pg-4" data-question-id="p-4"><span>4</span> Mostramos confiança por obedecer. Isso nos protege de decisões ruins.</p>
<div><p class="pergunta" id="p-5"><span>5.</span> Ao estudar, como podemos ler, meditar e aplicar o que aprendemos?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-5"><button class="btn-gerar-ia">Gerar</button><div id="r-5"></div></div></div>
<p class="paragrafo" id="pg-5" data-question-id="p-5"><span>5</span> Podemos ler com atenção. Devemos meditar nas lições e colocá-las em prática.</p>
<div><p class="pergunta" id="p-6"><span>6.</span> O que devemos lembrar?</p></div>
<p class="paragrafo" id="pg-6" data-question-id="p-6"><span>6</span> OUTSIDE_SELECTED_SOURCE</p>
<div><p class="pergunta" id="p-7"><span>7.</span> O que vamos ver neste estudo?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-7"><button class="btn-gerar-ia">Gerar</button><div id="r-7"></div></div></div>
<p class="paragrafo" id="pg-7" data-question-id="p-7"><span>7</span> Neste estudo, vamos analisar o <a class="bbl" id="bible-salmo-source" href="#salmo91">Salmo 91</a> e responder às seguintes perguntas: Que tipo de proteção Jeová nos promete? Como Jeová nos protege hoje? E como ele vai nos proteger no futuro? Mas antes, vamos ter uma visão geral do <a class="bbl" id="bible-salmo-tail" href="#salmo91-tail">Salmo 91</a>.</p>
<div><p class="pergunta" id="p-8"><span>8.</span> (a) O que fortalece a fé? (b) Como podemos compreender melhor? (c) Por que devemos agir?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-8"><button class="btn-gerar-ia">Gerar</button><div id="r-8"></div></div></div>
<p class="paragrafo" id="pg-8" data-question-id="p-8"><span>8</span> A oração fortalece a fé. Meditar esclarece o que aprendemos. Agir mostra que confiamos em Jeová.</p>
<div><p class="pergunta" id="p-9"><span>9.</span> O que devemos fazer? Como podemos ajudar? Por que isso é valioso?</p></div>
<div class="anotacao"><div class="ia-wrapper" id="wrapper-9"><button class="btn-gerar-ia">Gerar</button><div id="r-9"></div></div></div>
<p class="paragrafo" id="pg-9" data-question-id="p-9"><span>9</span> Devemos ouvir com atenção. Podemos oferecer encorajamento. Isso fortalece nossos irmãos.</p>
<div class="qa-spacer"></div>
</main>
<script src="/sentinela/clickable/agente_perguntas.js"></script>
<script src="/sentinela/mark.js"></script>
</body></html>'''

MOCKS = '''(() => {
  window.qaRequests = [];
  window.qaResponses = [];
  window.qaNaturalResponses = [];
  window.qaNaturalDefault = {sub_questions:[{question:'',natural_answer:'Resposta natural preservada.',literal_smooth:''}]};
  window.qaSaves = [];
  window.qaStored = {};
  window.qaDeferred = [];
  window.CacheAnotacao = {
    salvar(id, html) {qaSaves.push({id,html});qaStored[id]=html;},
    carregar(id) {return qaStored[id] || '';}
  };
  const nativeFetch = fetch.bind(window);
  window.fetch = async (input, options={}) => {
    const url = String(input?.url || input);
    if (!url.includes('workers.dev')) return nativeFetch(input,options);
    const request = JSON.parse(options.body || '{}');
    const kind = request.prompt?.startsWith('Extraia somente') ? 'highlight' : 'natural';
    qaRequests.push({...request,qaKind:kind});
    const item = kind === 'highlight' ? qaResponses.shift() : (qaNaturalResponses.shift() || {payload:qaNaturalDefault});
    if (!item) throw new Error('Unexpected synthetic Gemini request');
    if (item.defer) await new Promise(resolve=>qaDeferred.push({kind,resolve}));
    if (item.reject) throw new TypeError(item.reject);
    const text = typeof item.text === 'string' ? item.text : JSON.stringify(item.payload);
    return new Response(JSON.stringify(item.error ? {error:item.error} : {text,model:request.modelName}), {
      status:item.status||200,headers:{'Content-Type':'application/json'}
    });
  };
  window.qaRun = async number => {
    const id='p-'+number, wrapper=document.getElementById('wrapper-'+number), response='r-'+number;
    return gerarRespostaIA(id,wrapper,response);
  };
})();'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith('/highlight-fixture.html'):
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def part(question, paragraph, quote, **extra):
    return {'question': question, 'natural_answer': 'Resposta natural preservada.',
            'literal_smooth': quote, 'highlights': [{'paragraph_number': paragraph, 'literal_text': quote}], **extra}


def queue(page, payload=None, **extra):
    page.evaluate('''item => {
      qaResponses.push(item);
      if (item.payload?.sub_questions) qaNaturalDefault={sub_questions:item.payload.sub_questions.map(({highlights,...part})=>part)};
    }''', {'payload':payload, **extra})


def run(page, number, payload):
    queue(page, payload)
    page.evaluate('number => qaRun(number)', number)
    page.wait_for_function('number => !document.querySelector("#wrapper-"+number).classList.contains("ia-loading")', arg=number)


def reset_fixture(page, origin):
    page.goto(origin + '/highlight-fixture.html?d=2026-11-02', wait_until='domcontentloaded')
    page.wait_for_function("typeof gerarRespostaIA === 'function'")
    # Each scenario owns an isolated synthetic transport state. Remove only
    # test-created provider cooldowns so a429 case cannot affect later cases.
    page.evaluate("Object.keys(localStorage).filter(key=>key.startsWith('__sentinela_perguntas_cooldown__:')).forEach(key=>localStorage.removeItem(key))")


def assert_exact_coverage(page, selector, quotes):
    """Check every non-space character, including boundaries across DOM nodes.

    Existing manual marks retain ownership. Everything else in an approved
    excerpt must be generated, and no character outside it may be generated.
    """
    result = page.locator(selector).evaluate('''(paragraph,quotes)=>{
      const text=paragraph.textContent;
      const expected=new Set();
      for(const quote of quotes){
        const start=text.indexOf(quote);
        if(start<0||text.indexOf(quote,start+1)!==-1) return {error:'Invalid coverage fixture',quote};
        for(let i=start;i<start+quote.length;i++) expected.add(i);
      }
      const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);
      let node,offset=0;
      while((node=walker.nextNode())){
        const mark=node.parentElement.closest('mark');
        const generated=Boolean(mark?.hasAttribute('data-ia-owner'));
        const manual=Boolean(mark&&!generated);
        for(let i=0;i<node.nodeValue.length;i++){
          if(!/\\S/.test(node.nodeValue[i])||manual) continue;
          if(generated!==expected.has(offset+i)) return {
            error:generated?'Unexpected highlighted character':'Missing highlighted character',
            excerpt:text.slice(Math.max(0,offset+i-28),offset+i+48),character:node.nodeValue[i]
          };
        }
        offset+=node.nodeValue.length;
      }
      return null;
    }''', quotes)
    assert result is None, (selector, result)


def check_single_question(page):
    original = page.evaluate('''() => {
      window.qaBibleClicks=0;
      window.qaBibleNode=document.getElementById('bible-1');
      qaBibleNode.addEventListener('click',event=>{event.preventDefault();qaBibleClicks++});
      return [...document.querySelectorAll('.paragrafo')].map(p=>p.textContent);
    }''')
    # A buggy model may still divide the answers by paragraph. Both copied
    # question clauses point to the same authored question, so color stays yellow.
    payload = {'sub_questions': [
        part(QUESTION, 1, FIRST, id='1', title='Primeiro parágrafo'),
        part(QUESTION, 2, THIRD, id='2', title='Segundo parágrafo')
    ]}
    payload['sub_questions'][0]['highlights'].append({'paragraph_number':1,'literal_text':SECOND})
    payload['sub_questions'][1]['highlights'].append({'paragraph_number':2,'literal_text':SATAN})
    payload['sub_questions'][1]['highlights'].append({'paragraph_number':2,'literal_text':FOURTH})
    run(page, '1-2', payload)
    assert page.locator('#pg-1 mark[data-ia-owner]').count() > 0
    assert page.locator('#pg-2 mark[data-ia-owner]').count() > 0, 'Figure must not discard paragraph 2.'
    assert page.locator('#pg-1 mark.hl-color-green, #pg-2 mark.hl-color-green').count() == 0
    assert page.locator('#pg-1 mark.hl-color-blue, #pg-2 mark.hl-color-blue').count() == 0
    assert_exact_coverage(page, '#pg-1', [FIRST, SECOND])
    assert_exact_coverage(page, '#pg-2', [THIRD, SATAN, FOURTH])
    assert page.locator('mark mark').count() == 0, 'Never nest generated marks over manual marks.'
    assert page.locator('#manual-existing').get_attribute('class') == 'hl-color-purple'
    assert page.locator('#manual-existing').get_attribute('data-ia-owner') is None
    assert page.locator('.bbl mark, .footnote-link mark, mark .bbl, mark .footnote-link').count() == 0
    assert page.locator('.paragrafo > span:first-child mark').count() == 0
    assert original == page.evaluate("[...document.querySelectorAll('.paragrafo')].map(p=>p.textContent)")
    assert page.evaluate("qaBibleNode === document.getElementById('bible-1')")
    page.locator('#bible-1').click()
    assert page.evaluate('qaBibleClicks') == 1
    assert 'Resposta natural preservada.' in page.locator('#r-1-2 .ia-tab-natural').inner_text()
    assert page.locator('#r-1-2 .ia-tab-btn').count() >= 2
    request = page.evaluate("qaRequests.find(row=>row.qaKind==='highlight')")
    assert request['isJson'] is True
    assert request['modelName'] == 'gemini-3.5-flash-lite'
    assert request['imagePart'] is None and not request.get('tools')
    prompt = request['prompt']
    assert QUESTION in prompt and THIRD in prompt
    assert 'PRIVATE_' not in prompt and 'OUTSIDE_SELECTED_SOURCE' not in prompt
    assert '1–2. Em breve' not in prompt
    assert 'anchor_start' not in prompt and 'anchor_end' not in prompt
    assert 'natural_answer' not in prompt and 'literal_smooth' not in prompt
    natural_request = page.evaluate("qaRequests.find(row=>row.qaKind==='natural')")
    assert natural_request['modelName'] == 'gemini-3.5-flash-lite'
    assert 'natural_answer' in natural_request['prompt']
    assert 'highlights' not in natural_request['prompt']
    saves = page.evaluate("qaSaves.filter(row => ['pg-1','pg-2'].includes(row.id))")
    assert len(saves) == 2, 'Commit paragraph changes once, not once per fragment.'
    assert {row['id'] for row in saves} == {'pg-1','pg-2'}
    assert all('<mark' in row['html'] for row in saves)


def check_compound_questions(page):
    run(page, '3', {'sub_questions': [
        part('O que fortalece nossa confiança?', 3, 'A oração fortalece nossa confiança.'),
        part('Por que isso é importante?', 3, 'Ela nos ajuda a continuar firmes.')
    ]})
    assert 'A oração fortalece nossa confiança.' in page.locator('#pg-3 mark.hl-color-yellow').all_text_contents()
    assert 'Ela nos ajuda a continuar firmes.' in page.locator('#pg-3 mark.hl-color-green').all_text_contents()
    assert page.locator('#pg-3 .anotacao mark').count() == 0
    run(page, '4', {'sub_questions': [
        part('Como mostramos confiança', 4, 'Mostramos confiança por obedecer.'),
        part('por que isso nos ajuda?', 4, 'Isso nos protege de decisões ruins.')
    ]})
    assert page.locator('#pg-4 mark.hl-color-yellow').count() > 0
    assert page.locator('#pg-4 mark.hl-color-green').count() > 0
    run(page, '5', {'sub_questions': [
        part('Ao estudar, como podemos ler, meditar e aplicar o que aprendemos?', 5, 'Podemos ler com atenção.', id='1'),
        part('meditar e aplicar o que aprendemos?', 5, 'Devemos meditar nas lições e colocá-las em prática.', id='2')
    ]})
    assert page.locator('#pg-5 mark.hl-color-yellow').count() > 0
    assert page.locator('#pg-5 mark.hl-color-green').count() == 0, 'List commas do not make independent questions.'


def check_three_question_colors(page):
    cases = [
      ('8', [
        ('O que fortalece a fé?', 'A oração fortalece a fé.'),
        ('Como podemos compreender melhor?', 'Meditar esclarece o que aprendemos.'),
        ('Por que devemos agir?', 'Agir mostra que confiamos em Jeová.')
      ]),
      ('9', [
        ('O que devemos fazer?', 'Devemos ouvir com atenção.'),
        ('Como podemos ajudar?', 'Podemos oferecer encorajamento.'),
        ('Por que isso é valioso?', 'Isso fortalece nossos irmãos.')
      ])
    ]
    for number, questions in cases:
        parts = [part(question, int(number), quote, natural_answer=f'Resposta natural {index + 1} preservada.')
                 for index, (question, quote) in enumerate(questions)]
        # Model order is not the authored question order. Colors must follow
        # the latter even when the provider returns C, A, B.
        run(page, number, {'sub_questions': [parts[2], parts[0], parts[1]]})
        for color, (_, quote) in zip(['yellow','green','blue'], questions):
            assert quote in page.locator(f'#pg-{number} mark.hl-color-{color}').all_text_contents()
        natural = page.locator(f'#r-{number} .ia-tab-natural').inner_text()
        assert all(f'Resposta natural {index + 1} preservada.' in natural for index in range(3))


def check_overview_answer(page):
    quote = 'Neste estudo, vamos analisar o Salmo 91 e responder às seguintes perguntas: Que tipo de proteção Jeová nos promete? Como Jeová nos protege hoje? E como ele vai nos proteger no futuro?'
    page.evaluate("""() => {
      window.qaOverviewLink=document.getElementById('bible-salmo-source');
      window.qaOverviewClicks=0;
      qaOverviewLink.addEventListener('click',event=>{event.preventDefault();qaOverviewClicks++});
    }""")
    run(page, '7', {'sub_questions': [part('O que vamos ver neste estudo?', 7, quote)]})
    assert page.locator('#pg-7 mark.hl-color-yellow').count() > 0
    assert page.locator('#pg-7 mark.hl-color-green, #pg-7 mark.hl-color-blue').count() == 0
    assert page.locator('#bible-salmo-source mark.hl-color-yellow').count() > 0, 'A Bible name that is part of the answer is not a disposable citation.'
    assert page.locator('#bible-salmo-tail mark').count() == 0
    assert not any('Mas antes' in text for text in page.locator('#pg-7 mark').all_text_contents())
    assert_exact_coverage(page, '#pg-7', [quote])
    assert page.evaluate("qaOverviewLink===document.getElementById('bible-salmo-source')")
    page.locator('#bible-salmo-source').click()
    assert page.evaluate('qaOverviewClicks') == 1


def check_invalid_and_exact(page):
    before = page.locator('#pg-1').inner_html()
    before_two = page.locator('#pg-2').inner_html()
    page.evaluate('qaSaves.length=0')
    run(page, '1-2', {'sub_questions': [part(QUESTION, 6, 'OUTSIDE_SELECTED_SOURCE')]})
    assert page.locator('#pg-1').inner_html() == before
    assert page.locator('#pg-2').inner_html() == before_two
    assert page.locator('#pg-6 mark').count() == 0
    assert not page.evaluate("qaSaves.some(row=>row.id==='pg-1'||row.id==='pg-2')")
    # An invalid fragment must not replace a complete previous result with an
    # incomplete subset. Validate the entire marking transaction first.
    run(page, '1-2', {'sub_questions': [part(QUESTION, 2, THIRD), part(QUESTION, 1, 'Trecho que não existe no artigo.')]})
    assert page.locator('#pg-1').inner_html() == before
    assert page.locator('#pg-2').inner_html() == before_two
    # A valid substring is not sufficient when it cuts a word in half. Keep
    # the previous complete answer atomically if either endpoint is truncated.
    for quote in [SECOND[:-4], SECOND[2:]]:
        run(page, '1-2', {'sub_questions': [part(QUESTION, 2, THIRD), part(QUESTION, 1, quote)]})
        assert page.locator('#pg-1').inner_html() == before
        assert page.locator('#pg-2').inner_html() == before_two
    for number, quote in [(1, 'Apo. 17:17'), (1, 'governantes')]:
        run(page, '1-2', {'sub_questions': [part(QUESTION, number, quote)]})
        assert page.locator('#pg-1').inner_html() == before
        assert page.locator('#pg-2').inner_html() == before_two
    # Similarity must not expand a paraphrase to a vaguely matching sentence.
    run(page, '1-2', {'sub_questions': [part(QUESTION, 1, 'Jeová coloca no coração dos governantes outra ideia, de destruir o reino que possuem.')]})
    assert page.locator('#pg-1').inner_html() == before
    queue(page, text='{broken JSON')
    page.evaluate("qaRun('1-2')")
    page.wait_for_function("!document.querySelector('#wrapper-1-2').classList.contains('ia-loading')")
    assert page.locator('#pg-1').inner_html() == before
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()
    # Literal HTML in a natural answer remains inert rather than becoming DOM.
    run(page, '1-2', {'sub_questions': [part(QUESTION, 2, THIRD, natural_answer='<img src=x onerror="window.qaInjected=1"> **Texto**')]})
    assert page.locator('#r-1-2 img').count() == 0
    assert page.evaluate('window.qaInjected || 0') == 0
    assert '<img src=x' in page.locator('#r-1-2 .ia-tab-natural').inner_text()


def check_manual_recolor(page):
    generated = page.locator('#pg-2 mark[data-ia-owner]').first
    generated.scroll_into_view_if_needed()
    generated.tap()
    page.locator('#hl-custom-menu .hl-color-btn-main').click()
    page.locator('#hl-custom-menu .hl-palette [data-color="pink"]').click()
    # Manual ownership must survive the next IA generation, even after recoloring
    # a mark originally created by the IA.
    pink_text = page.locator('#pg-2 mark.hl-color-pink').all_text_contents()
    assert pink_text
    assert page.locator('#pg-2 mark.hl-color-pink[data-ia-owner]').count() == 0
    run(page, '1-2', {'sub_questions': [part(QUESTION, 2, FOURTH)]})
    assert page.locator('#pg-2 mark.hl-color-pink').all_text_contents() == pink_text
    assert page.locator('mark mark').count() == 0


def check_fallback_and_inflight(page, origin):
    reset_fixture(page, origin)
    payload = {'sub_questions': [part(QUESTION, 2, THIRD)]}
    queue(page, status=503, error='Synthetic temporary service failure')
    queue(page, payload)
    page.evaluate("qaRun('1-2')")
    page.wait_for_function("!document.querySelector('#wrapper-1-2').classList.contains('ia-loading')")
    assert page.evaluate("qaRequests.filter(row=>row.qaKind==='highlight').map(row=>row.modelName)") == ['gemini-3.5-flash-lite','gemini-3.5-flash-lite']
    assert page.locator('#pg-2 mark.hl-color-yellow').count() > 0
    reset_fixture(page, origin)
    queue(page, payload, defer=True)
    page.evaluate("() => {window.qaFirst=qaRun('1-2');window.qaSecond=qaRun('1-2');}")
    page.wait_for_function("qaRequests.some(row=>row.qaKind==='highlight') && qaDeferred.length===1")
    page.wait_for_timeout(100)
    assert page.evaluate("qaRequests.filter(row=>row.qaKind==='highlight').length") == 1, 'Repeated taps must share one highlight request.'
    assert page.evaluate("qaRequests.filter(row=>row.qaKind==='natural').length") == 1, 'Repeated taps must share one natural request.'
    page.evaluate('qaDeferred[0].resolve()')
    page.evaluate('Promise.all([qaFirst,qaSecond])')
    page.wait_for_function("!document.querySelector('#wrapper-1-2').classList.contains('ia-loading')")
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()
    assert page.locator('#pg-2 mark.hl-color-yellow').count() > 0


def check_terminal_extraction_failures(page, origin):
    payload = {'sub_questions': [part(QUESTION, 2, THIRD)]}
    for status in (404, 429):
        reset_fixture(page, origin)
        run(page, '1-2', payload)
        before = page.locator('#pg-2').inner_html()
        saved = page.evaluate("qaStored['pg-2']")
        page.evaluate('qaRequests.length=0;qaSaves.length=0')
        queue(page, status=status, error='Synthetic permanent model error' if status == 404 else 'Synthetic quota exceeded')
        page.evaluate("qaRun('1-2')")
        assert page.evaluate("qaRequests.filter(row=>row.qaKind==='highlight').map(row=>row.modelName)") == ['gemini-3.5-flash-lite'], 'Client errors must not retry or silently change the selector.'
        assert page.locator('#pg-2').inner_html() == before
        assert page.evaluate("qaStored['pg-2']") == saved
        assert not page.evaluate("qaSaves.some(row=>row.id==='pg-2')")
        assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()


def check_independent_requests(page, origin):
    reset_fixture(page, origin)
    payload = {'sub_questions': [part(QUESTION, 2, THIRD)]}
    queue(page, payload)
    page.evaluate("qaNaturalResponses.push({payload:qaNaturalDefault,defer:true})")
    page.evaluate("() => {window.qaGeneration=qaRun('1-2');}")
    page.wait_for_function("document.querySelector('#pg-2 mark[data-ia-owner]') && qaDeferred.some(item=>item.kind==='natural')")
    assert page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()
    assert page.evaluate("qaRequests.filter(row=>row.qaKind==='highlight').length") == 1
    # The literal extraction can finish while the independent natural response
    # is still waiting; it is not delayed by the legacy generation path.
    page.evaluate("qaDeferred.find(item=>item.kind==='natural').resolve()")
    page.evaluate('qaGeneration')
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()

    reset_fixture(page, origin)
    queue(page, payload)
    page.evaluate("qaNaturalResponses.push(...Array.from({length:2},()=>({status:503,error:'Synthetic natural service failure'})))")
    page.evaluate("qaRun('1-2')")
    assert page.locator('#pg-2 mark.hl-color-yellow').count() > 0
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()
    assert 'Os destaques foram atualizados.' in page.locator('#r-1-2 .ia-inline-note:not(.ia-status-error)').inner_text()
    assert 'destaques' not in page.locator('#r-1-2 .ia-status-error').inner_text()

    before = page.locator('#pg-2').inner_html()
    queue(page, status=503, error='Synthetic highlight service failure')
    queue(page, status=503, error='Synthetic highlight fallback failure')
    page.evaluate("qaNaturalResponses.push({payload:{sub_questions:[{question:'Em breve, que acontecimentos vão abalar a Terra?',natural_answer:'NATURAL_SEM_DESTAQUE',literal_smooth:''}]}})")
    page.evaluate("qaRun('1-2')")
    assert page.locator('#pg-2').inner_html() == before
    assert 'NATURAL_SEM_DESTAQUE' in page.locator('#r-1-2 .ia-tab-natural').inner_text()
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()


def check_response_shapes_and_validation_fallback(page, origin):
    # The live provider may return a top-level array even with JSON mode. All
    # supported envelopes must preserve both written and extractive answers.
    for shape in ('envelope', 'array', 'part'):
        reset_fixture(page, origin)
        natural = {'question': QUESTION, 'natural_answer': 'NATURAL_' + shape,
                   'literal_smooth': THIRD}
        highlight = {'question': QUESTION, 'highlights': [{'paragraph_number': 2, 'literal_text': THIRD}]}
        wrap = lambda item: {'sub_questions': [item]} if shape == 'envelope' else [item] if shape == 'array' else item
        queue(page, wrap(highlight))
        page.evaluate('payload=>qaNaturalResponses.push({payload})', wrap(natural))
        page.evaluate("qaRun('1-2')")
        assert 'NATURAL_' + shape in page.locator('#r-1-2 .ia-tab-natural').inner_text()
        assert not page.locator('#r-1-2 .ia-status-error').count()
        assert_exact_coverage(page, '#pg-2', [THIRD])
        assert len(page.evaluate('qaRequests')) == 2, 'Valid alternate JSON envelopes must not require retries.'

    reset_fixture(page, origin)
    valid = {'sub_questions': [part(QUESTION, 2, THIRD, natural_answer='RECUPERADO_APOS_JSON_INVALIDO')]}
    queue(page, text='{"sub_questions":[')
    queue(page, valid)
    page.evaluate('''payload=>qaNaturalResponses.push(
      {text:'{"sub_questions":['},{payload}
    )''', valid)
    page.evaluate("qaRun('1-2')")
    assert 'RECUPERADO_APOS_JSON_INVALIDO' in page.locator('#r-1-2 .ia-tab-natural').inner_text()
    assert_exact_coverage(page, '#pg-2', [THIRD])
    for kind in ('natural', 'highlight'):
        expected = ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite' if kind == 'highlight' else 'gemini-3.1-flash-lite']
        assert page.evaluate('kind=>qaRequests.filter(row=>row.qaKind===kind).map(row=>row.modelName)', kind) == expected
    assert not page.locator('#r-1-2 .ia-status-error').count()

    # Failed regeneration is transient UI, not a replacement for the last
    # written response or the correctly saved highlights.
    saved = page.evaluate("qaStored['r-1-2']")
    before = page.locator('#pg-2').inner_html()
    page.evaluate('qaSaves.length=0')
    queue(page, status=503, error='Synthetic extraction unavailable')
    queue(page, status=503, error='Synthetic extraction fallback unavailable')
    page.evaluate('''()=>qaNaturalResponses.push(
      {payload:{error:'unexpected result'}},
      {payload:{sub_questions:[{question:'',natural_answer:'   ',literal_smooth:''}]}}
    )''')
    page.evaluate("qaRun('1-2')")
    assert 'RECUPERADO_APOS_JSON_INVALIDO' in page.locator('#r-1-2 .ia-tab-natural').inner_text()
    assert page.locator('#r-1-2 .ia-status-error').count() == 1
    assert page.locator('#pg-2').inner_html() == before
    assert page.evaluate("qaStored['r-1-2']") == saved
    assert not page.evaluate("qaSaves.some(row=>row.id==='r-1-2'||row.id==='pg-2')")
    assert not page.locator('#wrapper-1-2 .btn-gerar-ia').is_disabled()


def check_recorded_public_responses(page, origin):
    """Replay real public-source output through the DOM and persistence path.

    This complements the exact manual-gold fixture: small introductory words
    may be omitted by the model, but all five answer facts must remain complete.
    """
    fixture = json.loads((ROOT / 'tests/fixtures/question-highlights-public-2026522.json').read_text())
    payloads = {case['question']: case['payload'] for case in fixture['cases']}
    reset_fixture(page, origin)
    queue(page, payloads['1-2'])
    page.evaluate('''()=>qaNaturalResponses.push({payload:{sub_questions:[{
      question:'Em breve, que acontecimentos vão abalar a Terra?',
      natural_answer:'Resposta escrita simulada para o replay público.',literal_smooth:''
    }]}})''')
    page.evaluate("qaRun('1-2')")
    assert_exact_coverage(page, '#pg-1', [FIRST, SECOND.removeprefix('Daí ')])
    assert_exact_coverage(page, '#pg-2', [THIRD, SATAN[1:-1], FOURTH.split(': ', 1)[1]])
    assert page.locator('#pg-1 mark[data-ia-owner]:not(.hl-color-yellow), #pg-2 mark[data-ia-owner]:not(.hl-color-yellow)').count() == 0
    assert page.locator('#pg-1 a.bbl mark, #pg-2 a.bbl mark, #pg-2 #book-title mark, .footnote-link mark').count() == 0
    assert not page.locator('#r-1-2 .ia-status-error').count()
    assert page.evaluate("qaStored['pg-2']===document.querySelector('#pg-2').innerHTML")

    # The suite's overview fixture uses ID7 to keep the independent two-part
    # question test. Relabel its displayed source to3 to replay the real model
    # payload unchanged, including the original paragraph_number.
    reset_fixture(page, origin)
    page.evaluate('''()=>{
      document.querySelector('#p-7 > span').textContent='3.';
      const number=document.querySelector('#pg-7 > span');
      number.textContent='3';
      number.insertAdjacentHTML('afterend',' Será que precisamos ficar com medo do julgamento divino que em breve virá sobre este mundo mau? Não! Por quê? Porque Jeová promete que vai nos proteger. Ele deixou essa promessa registrada em sua Palavra: “Mil cairão ao seu lado, e dez mil à sua direita; mas nada o atingirá.” (<a class="bbl" id="overview-support" href="#sal91-7">Sal. 91:7</a>)');
    }''')
    queue(page, payloads['3'])
    page.evaluate('''()=>qaNaturalResponses.push({payload:{sub_questions:[{
      question:'O que vamos ver neste estudo?',
      natural_answer:'Resposta escrita simulada para o replay público.',literal_smooth:''
    }]}})''')
    page.evaluate("qaRun('7')")
    quote = 'vamos analisar o Salmo 91 e responder às seguintes perguntas: Que tipo de proteção Jeová nos promete? Como Jeová nos protege hoje? E como ele vai nos proteger no futuro?'
    assert_exact_coverage(page, '#pg-7', [quote])
    assert page.locator('#pg-7 mark[data-ia-owner]:not(.hl-color-yellow)').count() == 0
    assert page.locator('#bible-salmo-source mark.hl-color-yellow').count() > 0
    assert page.locator('#overview-support mark, #bible-salmo-tail mark').count() == 0
    assert not any('Mas antes' in text for text in page.locator('#pg-7 mark').all_text_contents())
    assert not page.locator('#r-7 .ia-status-error').count()


def check_tab_and_scroll_retention(page, origin):
    question = 'Ao estudar, como podemos ler, meditar e aplicar o que aprendemos?'
    for valid in [True, False]:
        reset_fixture(page, origin)
        quote = 'Podemos ler com atenção.' if valid else 'Uma frase inexistente no artigo.'
        queue(page, {'sub_questions':[part(question,5,quote)]}, defer=True)
        natural = {'sub_questions':[part(question,5,'Podemos ler com atenção.', literal_smooth='Trecho literal preservado para leitura. ' * 80)]}
        page.evaluate('payload=>qaNaturalResponses.push({payload})', natural)
        page.evaluate("() => {window.qaGeneration=qaRun('5');}")
        page.wait_for_function("document.querySelector('#r-5 .ia-tab-natural') && qaDeferred.some(item=>item.kind==='highlight')")
        page.locator('#r-5 .ia-tab-btn').filter(has_text='Trecho Exato').click()
        before = page.evaluate("""() => {
          const response=document.getElementById('r-5');
          response.style.maxHeight='140px';response.style.overflow='auto';
          response.scrollTop=65;
          window.qaLiteralNode=response.querySelector('.ia-tab-literal');
          return response.scrollTop;
        }""")
        assert before > 10
        page.evaluate("qaDeferred.find(item=>item.kind==='highlight').resolve()")
        page.evaluate('qaGeneration')
        assert page.locator('#r-5 .ia-tab-literal').evaluate("node=>node.classList.contains('active')")
        assert not page.locator('#r-5 .ia-tab-natural').evaluate("node=>node.classList.contains('active')")
        assert abs(page.locator('#r-5').evaluate('node=>node.scrollTop') - before) < 1
        if valid:
            assert page.evaluate("qaLiteralNode===document.querySelector('#r-5 .ia-tab-literal')"), 'Unchanged response HTML must keep its nodes.'
        else:
            assert not page.evaluate("qaLiteralNode===document.querySelector('#r-5 .ia-tab-literal')"), 'Warning fixture must exercise an actual re-render.'


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width':430,'height':873}, has_touch=True, service_workers='block')
    context.add_init_script(MOCKS)
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin + '/') else route.abort())
    page = context.new_page()
    reset_fixture(page, origin)
    check_single_question(page)
    check_compound_questions(page)
    check_three_question_colors(page)
    check_overview_answer(page)
    check_invalid_and_exact(page)
    check_manual_recolor(page)
    check_fallback_and_inflight(page, origin)
    check_terminal_extraction_failures(page, origin)
    check_independent_requests(page, origin)
    check_response_shapes_and_validation_fallback(page, origin)
    check_recorded_public_responses(page, origin)
    check_tab_and_scroll_retention(page, origin)
    print(json.dumps({'engine':engine.name,'singleQuestionAcrossParagraphs':'passed',
      'semanticDoubleQuestions':'passed','threeQuestionsInAuthoredColorOrder':'passed','linkedOverviewAndAnswerBoundary':'passed','exactSourceAndReferenceExclusion':'passed',
      'naturalAnswerAndManualMarksPreserved':'passed','invalidPayloadSafety':'passed',
      'fallbackAndInflightDeduplication':'passed','terminalExtractionErrorsDoNotSwitchModel':'passed','alternateJsonShapesAndValidatedRetry':'passed','failedRegenerationPreservesSavedAnswer':'passed','recordedPublicModelCoverage':'passed','independentHighlightAndNaturalFailures':'passed','activeTabAndScrollRetention':'passed','perParagraphPersistence':'passed'}),flush=True)
    browser.close()


def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            check(p.chromium,os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),origin)
            if os.environ.get('WEBKIT_EXECUTABLE'):
                check(p.webkit,os.environ['WEBKIT_EXECUTABLE'],origin)
    finally:
        server.shutdown()


if __name__=='__main__':
    main()
