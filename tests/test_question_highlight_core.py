"""Isolated question/source/highlight DOM tests, with no model requests.

Run: python tests/test_question_highlight_core.py
Set WEBKIT_EXECUTABLE to add WebKit.
"""
import json
import os
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODULE = '/sentinela/clickable/perguntas-highlights.js'
FIXTURE = '''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:18px/1.6 sans-serif;padding:20px}.paragrafo{margin:20px 0}.private{display:none}</style>
<script>window.qaWrites=[];window.CacheAnotacao={carregar:()=>'',salvar:(id,html)=>qaWrites.push({id,html})};</script>
</head><body data-estudo="02-11"><main><h1 class="estudo-titulo">Confie em Jeová e seja protegido</h1>
<div><p class="pergunta" id="q-1-2"><span>1-2.</span> Em breve, que acontecimentos vão abalar a Terra?</p></div>
<div class="comentarios" contenteditable="true">PRIVATE_NOTE<p class="paragrafo"><span>1</span>PRIVATE_FAKE_PARAGRAPH</p></div>
<p class="paragrafo" id="source-1" data-question-id="q-1-2"><span>1</span> Vivemos nos últimos dias. A fera acabará com as organizações <em>religiosas</em> falsas. (<a class="bbl" href="#bible">Apo. 17:16</a>)<sup><a class="footnote-link" href="#note">*</a></sup> Esse evento marcará o início da grande tribulação.<span class="anotacao private">PRIVATE_ANNOTATION</span></p>
<figure><img alt="Imagem sem solicitação de rede"><figcaption>Veja os parágrafos 1 e 2.</figcaption></figure>
<p class="paragrafo" id="source-2"><span>2</span> As nações atacarão o povo de Jeová. Depois, acontecerá a guerra do Armagedom. Jesus destruirá os maus e abrirá as portas do novo mundo. <mark class="hl-color-purple" data-hl-id="manual-keep">Minha marca manual</mark>.</p>
<div><p class="pergunta" id="q-3"><span>3.</span> (a) O que ajuda nossa fé? (b) Como podemos ajudar outros?</p></div>
<p class="paragrafo" id="source-3" data-question-id="q-3"><span>3</span> Estudar fortalece nossa fé. Podemos ouvir e encorajar nossos irmãos.</p>
<div><p class="pergunta" id="q-4"><span>4.</span> O que é confiança? Por que ela é importante?</p></div>
<p class="paragrafo" id="source-4" data-question-id="q-4"><span>4</span> Confiança é segurança. Ela nos ajuda a agir com coragem.</p>
<div><p class="pergunta" id="q-5"><span>5.</span> Como fortalecer a fé e por que devemos fazer isso?</p></div>
<p class="paragrafo" id="source-5" data-question-id="q-5"><span>5</span> Podemos estudar a Bíblia. A fé nos ajuda a permanecer firmes.</p>
<div><p class="pergunta" id="q-6"><span>6.</span> Que qualidades, como bondade, paciência e amor, precisamos cultivar?</p></div>
<p class="paragrafo" id="source-6" data-question-id="q-6"><span>6</span> Precisamos cultivar bondade, paciência e amor.</p>
</main><script src="/sentinela/mark.js"></script></body></html>'''

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path.startswith('/highlight-core.html'):
            data=FIXTURE.encode();self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        else:
            super().do_GET()

def load(page, origin):
    page.goto(origin+'/highlight-core.html')
    page.evaluate('''async path=>{
      window.hl=await import(path);
      window.source=id=>hl.buildSource(id);
      window.apply=(id,parts)=>hl.applyHighlights(id,{parts},source(id));
      window.colored=id=>[...document.querySelectorAll(`mark[data-ia-owner="${id}"]`)].map(m=>({text:m.textContent,color:[...m.classList].find(c=>c.startsWith('hl-color-')),paragraph:m.closest('.paragrafo').id,part:m.dataset.iaPart}));
    }''',MODULE)

def part(question, paragraph, literal, **extra):
    return dict(question=question,natural_answer='Resposta natural preservada.',literal_smooth='Trecho de leitura preservado.',highlights=[dict(paragraph_number=paragraph,literal_text=literal)],**extra)

def apply(page, question_id, parts):
    return page.evaluate('a=>apply(a.id,a.parts)',dict(id=question_id,parts=parts))

def check_animation(page, origin):
    page.emulate_media(reduced_motion='no-preference')
    load(page, origin)
    pieces = [part('Em breve, que acontecimentos vão abalar a Terra?', 2, 'As nações atacarão o povo de Jeová.'),
              part('Em breve, que acontecimentos vão abalar a Terra?', 1, 'A fera acabará com as organizações religiosas falsas.')]
    # The provider's order differs from reading order, and paragraph1 is split
    # around an em node. Every visible fragment must reveal in reading order.
    timings = page.evaluate('''parts=>{
      apply('q-1-2',parts);
      window.qaSweepMarks=[...document.querySelectorAll('mark[data-ia-owner="q-1-2"]')];
      window.qaSweepAnimations=qaSweepMarks.flatMap(mark=>mark.getAnimations());
      qaSweepAnimations.forEach(animation=>animation.pause());
      return qaSweepAnimations.map(animation=>animation.effect.getTiming());
    }''', pieces)
    assert len(timings) >= 4, 'Fragmented source text must still receive its reveal animation.'
    assert all(timing['duration'] > 0 for timing in timings)
    assert all(timings[i + 1]['delay'] >= timing['delay'] + timing['duration'] - 1
               for i, timing in enumerate(timings[:-1])), timings
    assert page.evaluate("qaWrites.every(row=>row.html===document.getElementById(row.id).innerHTML)"), 'Cache must contain final HTML during animation.'
    assert not page.locator('mark[data-ia-owner][style]').count(), 'Transient reveal state must never be persisted inline.'
    # Regenerating while an earlier sweep is paused must cancel its detached
    # animations, and retain only the newly requested owned marks.
    apply(page, 'q-1-2', [pieces[0]])
    assert page.evaluate("qaSweepAnimations.every(animation=>animation.playState==='idle')")
    assert page.evaluate('qaSweepMarks.every(mark=>!mark.isConnected)')

    load(page, origin)
    animation = page.evaluate('''parts=>{
      apply('q-3',parts);
      window.qaVisualMark=document.querySelector('#source-3 mark[data-ia-owner]');
      window.qaVisualAnimation=qaVisualMark.getAnimations()[0];
      qaVisualAnimation.pause();
      const timing=qaVisualAnimation.effect.getTiming();
      qaVisualAnimation.currentTime=timing.delay+timing.duration/2;
      return {duration:timing.duration,delay:timing.delay};
    }''', [part('O que ajuda nossa fé?', 3, 'Estudar fortalece nossa fé.')])
    assert animation['duration'] > 0
    mark = page.locator('#source-3 mark[data-ia-owner]')
    mark.scroll_into_view_if_needed()
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    paint = mark.evaluate('''el=>{
      const style=getComputedStyle(el);
      return {size:style.backgroundSize,position:style.backgroundPosition,repeat:style.backgroundRepeat};
    }''')
    assert paint['size'].startswith('50%'), paint
    assert paint['position'].startswith('0%') and paint['repeat'] == 'no-repeat', paint
    # Inspect rendered pixels, not just animation metadata: at halfway the
    # left part is yellow, while the right part still has no highlight.
    box = mark.bounding_box()
    image = Image.open(BytesIO(page.screenshot(clip=box))).convert('RGB')
    def yellow_fraction(start, end):
        pixels = [image.getpixel((x, y)) for x in range(start, end)
                  for y in range(1, image.height - 1)]
        return sum(r > 210 and g > 190 and b < 200 for r, g, b in pixels) / len(pixels)
    assert yellow_fraction(2, image.width // 3) > .35, 'Left side must already be painted.'
    assert yellow_fraction(image.width * 2 // 3, image.width - 2) < .05, 'Right side must still be unpainted.'

    page.evaluate('qaVisualAnimation.finish()')
    page.wait_for_function("qaVisualMark.getAnimations().length===0")
    assert mark.evaluate('el=>getComputedStyle(el).backgroundSize') == '100% 100%'
    assert page.evaluate("qaWrites.at(-1).html===document.querySelector('#source-3').innerHTML")

    # Changing a live generated mark to a manual color ends the reveal and
    # immediately hands paint/ownership back to the user's marker.
    page.evaluate('''parts=>{
      apply('q-3',parts);
      window.qaManualMark=document.querySelector('#source-3 mark[data-ia-owner]');
      window.qaManualAnimation=qaManualMark.getAnimations()[0];
      qaManualAnimation.pause();
    }''', [part('O que ajuda nossa fé?', 3, 'Estudar fortalece nossa fé.')])
    page.locator('#source-3 mark[data-ia-owner]').tap()
    page.locator('#hl-custom-menu .hl-color-btn-main').click()
    page.locator('#hl-custom-menu [data-color="pink"]').click()
    page.wait_for_function("qaManualAnimation.playState==='idle'")
    assert page.evaluate("qaManualMark.className==='hl-color-pink' && !qaManualMark.hasAttribute('data-ia-owner')")
    assert page.evaluate("getComputedStyle(qaManualMark).backgroundImage==='none'")

    page.emulate_media(reduced_motion='reduce')
    load(page, origin)
    apply(page, 'q-3', [part('O que ajuda nossa fé?', 3, 'Estudar fortalece nossa fé.')])
    assert page.locator('#source-3 mark[data-ia-owner]').evaluate('el=>el.getAnimations().length') == 0
    assert page.locator('#source-3 mark[data-ia-owner]').evaluate('el=>getComputedStyle(el).backgroundSize') == '100% 100%'
    assert page.evaluate("qaWrites.at(-1).html===document.querySelector('#source-3').innerHTML")
    page.emulate_media(reduced_motion='no-preference')

def check(engine, executable, origin):
    browser=engine.launch(executable_path=executable,headless=True,args=['--no-sandbox'] if engine.name=='chromium' else [])
    context=browser.new_context(viewport=dict(width=430,height=900),has_touch=True,service_workers='block')
    page=context.new_page()
    page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else r.abort())
    load(page,origin)
    bundle=page.evaluate("(()=>{const b=source('q-1-2');return {questionText:b.questionText,paragraphs:b.paragraphs.map(p=>({number:p.number,text:p.text,id:p.id}))}})()")
    assert bundle['questionText']=='Em breve, que acontecimentos vão abalar a Terra?',bundle
    assert [p['number'] for p in bundle['paragraphs']]==[1,2],bundle
    assert 'PRIVATE_' not in json.dumps(bundle),bundle
    assert 'Estudar fortalece' not in json.dumps(bundle)
    assert page.locator('#source-1 em').inner_text()=='religiosas'

    questions=['Em breve, que acontecimentos vão abalar a Terra?', '(a) O que ajuda nossa fé? (b) Como podemos ajudar outros?', 'O que é confiança? Por que ela é importante?', 'Como fortalecer a fé e por que devemos fazer isso?', 'Que qualidades, como bondade, paciência e amor, precisamos cultivar?']
    analyses=page.evaluate('qs=>qs.map(q=>hl.analyzeQuestion(q))',questions)
    assert [a['count'] for a in analyses]==[1,2,2,2,1],analyses
    assert analyses[1]['explicit']
    repeated=page.evaluate('q=>hl.validateQuestionParts([{question:q,natural_answer:"A"},{question:q,natural_answer:"B"}],q)',questions[0])
    assert repeated['questionCount']==1 and {p['hexKey'] for p in repeated['parts']}=={'a'},repeated
    assert [p['natural_answer'] for p in repeated['parts']]==['A','B']

    comma_parts=page.evaluate("""()=>hl.validateQuestionParts([
      {question:'O que é a fé',natural_answer:'A'},
      {question:'como ela nos ajuda?',natural_answer:'B'}
    ], 'O que é a fé, como ela nos ajuda?')""")
    assert comma_parts['questionCount']==2 and [p['hexKey'] for p in comma_parts['parts']]==['a','b'],comma_parts
    quoted=page.evaluate('q=>hl.analyzeQuestion(q)', 'Por que devemos evitar pensar “Como vou sobreviver?”?')
    assert quoted['count']==1,quoted

    wrong_parts=[part('Que acontecimentos vão abalar a Terra?',1,'A fera acabará com as organizações religiosas falsas.',id='1'),part('As nações atacarão o povo de Jeová.',2,'As nações atacarão o povo de Jeová.',id='2')]
    wrong_parts[0]['natural_answer']='Linha 1.\n\nLinha 2.'
    output=apply(page,'q-1-2',wrong_parts)
    colored=page.evaluate("colored('q-1-2')")
    assert colored and {m['color'] for m in colored}=={'hl-color-yellow'},colored
    assert {m['paragraph'] for m in colored}=={'source-1','source-2'},colored
    assert [p['natural_answer'] for p in output['parts']]==[p['natural_answer'] for p in wrong_parts]
    assert all(p['literal_smooth']=='Trecho de leitura preservado.' for p in output['parts'])
    assert page.locator('mark mark').count()==0
    assert page.locator('#source-1 em').inner_text()=='religiosas'
    assert page.locator('a.bbl mark, .footnote-link mark, .anotacao mark, .comentarios mark').count()==0
    assert page.locator('[data-hl-id="manual-keep"]').inner_text()=='Minha marca manual'

    cases=[('q-3',[('O que ajuda nossa fé?',3,'Estudar fortalece nossa fé.'),('Como podemos ajudar outros?',3,'Podemos ouvir e encorajar nossos irmãos.')]),('q-4',[('O que é confiança?',4,'Confiança é segurança.'),('Por que ela é importante?',4,'Ela nos ajuda a agir com coragem.')]),('q-5',[('Como fortalecer a fé',5,'Podemos estudar a Bíblia.'),('por que devemos fazer isso?',5,'A fé nos ajuda a permanecer firmes.')])]
    for question_id,pieces in cases:
        apply(page,question_id,[part(*piece) for piece in pieces])
        colors=page.evaluate('colored',question_id)
        assert {m['color'] for m in colors}=={'hl-color-yellow','hl-color-green'},(question_id,colors)
        assert colors[0]['color']=='hl-color-yellow' and colors[-1]['color']=='hl-color-green'
    # Duplicate words requested by two questions have deterministic ownership:
    # the first authored question wins even when the model returns B before A.
    apply(page,'q-3',[
        part('Como podemos ajudar outros?',3,'Estudar fortalece nossa fé.'),
        part('O que ajuda nossa fé?',3,'Estudar fortalece nossa fé.'),
    ])
    assert {m['color'] for m in page.evaluate("colored('q-3')")}=={'hl-color-yellow'}
    apply(page,'q-6',[part('Que qualidades',6,'bondade'),part('como bondade, paciência e amor',6,'paciência e amor')])
    assert {m['color'] for m in page.evaluate("colored('q-6')")}=={'hl-color-yellow'}

    before=page.locator('#source-1').inner_html()
    for invalid in [part('Que acontecimentos vão abalar a Terra?',1,'As nações atacarão o povo de Jeová.'),part('Que acontecimentos vão abalar a Terra?',1,'A fera certamente destruirá todas as religiões falsas.')]:
        page.evaluate('a=>{try{apply(a.id,a.parts)}catch(e){window.qaError=e.message}}',dict(id='q-1-2',parts=[invalid]))
        assert page.locator('#source-1').inner_html()==before
    # Every candidate must be usable before replacing anything, including the
    # valid candidate preceding a rejected quote or a protected-only range.
    snapshot=page.evaluate("[document.querySelector('#source-1').innerHTML,document.querySelector('#source-2').innerHTML]")
    invalid_sets=[
        [part(questions[0],1,'A fera acabará com as organizações religiosas falsas.'),part(questions[0],2,'Texto inexistente no artigo.')],
        [part(questions[0],1,'Apo. 17:16')],
        [part(questions[0],2,'Minha marca manual')],
        [part(questions[0],1,'A fera acabará com as organizações religiosas falsas.'),part(questions[0],2,'As nações atacarão o povo de Jeo')],
        [part(questions[0],1,'A fera acabará com as organizações religiosas falsas.'),part(questions[0],2,'ções atacarão o povo de Jeová.')],
    ]
    for invalid_parts in invalid_sets:
        page.evaluate('qaWrites.length=0')
        page.evaluate('a=>{try{apply(a.id,a.parts)}catch(e){window.qaError=e.message}}',dict(id='q-1-2',parts=invalid_parts))
        assert page.evaluate("[document.querySelector('#source-1').innerHTML,document.querySelector('#source-2').innerHTML]")==snapshot
        assert page.evaluate('qaWrites.length')==0
    page.evaluate('qaWrites.length=0')
    duplicate=part(questions[0],1,'A fera acabará com as organizações religiosas falsas.')
    duplicate['highlights'] += [duplicate['highlights'][0].copy(),dict(paragraph_number=1,literal_text='organizações religiosas falsas')]
    apply(page,'q-1-2',[duplicate])
    assert page.locator('mark mark').count()==0
    selected=page.evaluate("colored('q-1-2')")
    assert ' '.join(m['text'] for m in selected).count('organizações')==1,selected
    writes=page.evaluate('qaWrites.map(item=>item.id)')
    assert len(writes)==len(set(writes)),writes

    load(page,origin)
    quote=page.evaluate("source('q-1-2').paragraphs.find(p=>p.number===1).text")
    apply(page,'q-1-2',[part(questions[0],1,quote)])
    assert page.locator('a.bbl mark, .footnote-link mark, .anotacao mark, .comentarios mark, mark mark').count()==0
    assert page.locator('a.bbl').get_attribute('href')=='#bible'
    assert page.locator('.footnote-link').get_attribute('href')=='#note'
    assert page.locator('#source-1 > span').first.inner_text()=='1'
    assert page.locator('#source-1 > span').first.locator('mark').count()==0
    apply(page,'q-1-2',[part(questions[0],2,'Jesus destruirá os maus e abrirá as portas do novo mundo. Minha marca manual.')])
    assert page.locator('[data-hl-id="manual-keep"]').get_attribute('class')=='hl-color-purple'
    assert page.locator('mark mark').count()==0

    load(page,origin)
    page.evaluate('''()=>{const m=document.querySelector('[data-hl-id="manual-keep"]');m.className='hl-color-pink';m.dataset.hlId='legacy-edited';m.dataset.iaOwner='q-1-2';m.dataset.iaMode='owned'}''')
    apply(page,'q-1-2',wrong_parts)
    assert page.locator('[data-hl-id="legacy-edited"]').get_attribute('class')=='hl-color-pink'
    generated=page.locator('#source-1 mark[data-ia-owner]').first
    generated.tap()
    page.locator('#hl-custom-menu').wait_for(state='visible')
    page.locator('#hl-custom-menu .hl-color-btn-main').click()
    page.locator('#hl-custom-menu [data-color="purple"]').click()
    edited=page.locator('#source-1 mark.hl-color-purple').first
    edited_id=edited.get_attribute('data-hl-id')
    assert edited.get_attribute('data-ia-owner') is None
    assert edited.get_attribute('data-ia-mode') is None
    apply(page,'q-1-2',[part(questions[0],2,'Depois, acontecerá a guerra do Armagedom.')])
    assert page.locator(f'mark[data-hl-id="{edited_id}"]').count()>0
    assert page.locator(f'mark[data-hl-id="{edited_id}"]').first.get_attribute('class')=='hl-color-purple'
    assert page.locator('mark mark').count()==0
    # A Bible title/reference that is part of the answer's prose may be
    # highlighted; citations in parentheses or an end citation stay unpainted.
    load(page,origin)
    page.evaluate("""()=>{document.querySelector('#source-1').innerHTML='<span>1</span> Jeová promete em <em><a class="bbl" href="#inline">Salmo 91</a></em> proteção. (<a class="bbl" href="#parenthetical">Sal. 91:7</a>) Ele cumpre sua palavra. — <a class="bbl" href="#tail">Sal. 91:1</a>'}""")
    literal=page.evaluate("source('q-1-2').paragraphs.find(p=>p.number===1).text")
    apply(page,'q-1-2',[part(questions[0],1,literal)])
    assert page.locator('a[href="#inline"] mark').count()==1
    assert page.locator('a[href="#inline"]').inner_text()=='Salmo 91'
    assert page.locator('a[href="#parenthetical"] mark, a[href="#tail"] mark').count()==0
    assert page.locator('#source-1 em a').get_attribute('href')=='#inline'
    assert page.locator('mark mark').count()==0

    check_animation(page, origin)
    print(json.dumps(dict(engine=engine.name,sourceScope='passed',semanticQuestionColors='passed',literalMatching='passed',wholeWordBoundaries='passed',manualAndLinkPreservation='passed',safeReplacementAndPersistence='passed',leftToRightRenderedAnimation='passed',animationCancellationAndReducedMotion='passed')),flush=True)
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
