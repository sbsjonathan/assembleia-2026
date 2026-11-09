"""Pontos altos through the production programme and agent; synthetic notes only.

Checks source fidelity/scope, balanced long-note excerpts, schema/fallbacks,
concurrency and preservation of saved results after edits, deletion and failures.
No Gemini or Supabase requests leave the test browser.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RESULT='ca-copgm27:pontos-altos'
MORNING='ca-copgm27:nota:confiar-de-todo-coracao'
AFTERNOON='ca-copgm27:nota:orientar-filhos'
MODELS=['gemini-3.1-flash-lite','gemini-3.5-flash','gemini-2.5-flash-lite']
SUMMARY='Confiar em Jeová envolve orar antes de decidir. Orientar os filhos exige escutá-los com paciência, como registrado nas anotações.'
BEFORE='Pontos altos anteriores preservados.'
MOCKS='''(() => {
  window.qaRequests=[];window.qaResponses=[];window.qaHeld=[];
  window.ASSEMBLEIA_IA_CONFIG={workerUrl:'/highpoints-test',timeoutMs:10000};
  const nativeFetch=fetch.bind(window),nativeSet=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(window.qaFailSave&&String(key).endsWith('ca-copgm27:pontos-altos'))throw new DOMException('Synthetic quota','QuotaExceededError');return nativeSet.call(this,key,value);};
  window.fetch=async(input,options={})=>{
    if(String(input)!=='/highpoints-test')return nativeFetch(input,options);
    const request=JSON.parse(options.body);qaRequests.push(request);
    const item=qaResponses.shift();if(!item)throw new Error('Unexpected IA request');
    if(item.hold)await new Promise(resolve=>qaHeld.push(resolve));
    if(item.reject)throw new TypeError('Synthetic network failure');
    return new Response(JSON.stringify(item.error?{error:item.error}:{text:item.text??JSON.stringify(item.payload),model:request.models[0]}),{status:item.status||200,headers:{'Content-Type':'application/json'}});
  };
})();'''

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass

def run(engine,executable,origin):
    browser=engine.launch(executable_path=executable,headless=True,args=['--no-sandbox'] if engine.name=='chromium' else [])
    context=browser.new_context(viewport={'width':430,'height':873},is_mobile=True,has_touch=True,service_workers='block')
    context.add_init_script(MOCKS)
    context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(origin) else route.abort())
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(origin+'/index.html',wait_until='domcontentloaded')
    page.wait_for_function('window.AssembleiaIA&&document.querySelectorAll(".clickable-asmb").length===17')
    page.evaluate('''()=>{
      localStorage.setItem('supabase_user',JSON.stringify({nome:'PRIVATE_ACCOUNT_NAME'}));
      window.qaRun=(period='unico')=>AssembleiaIA.gerarPontosAltosDia(period,document.querySelector('.pontos-altos-wrapper'),'ca-copgm27:pontos-altos');
      window.qaSeed=(id,html)=>AssembleiaIA.saveFullDraft(id,html);
      const duplicate=document.querySelector('.clickable-asmb').cloneNode(true);duplicate.id='qa-duplicate';document.body.append(duplicate);
      const other=document.createElement('div');other.id='qa-other';other.className='clickable-asmb';other.dataset.id='other-program:nota:test';document.body.append(other);
      qaSeed('other-program:nota:test','OTHER_PROGRAM_MUST_NOT_LEAK');
      qaSeed('ca-copgm27:pergunta:confiar-de-todo-coracao','REVIEW_ANSWER_MUST_NOT_LEAK');
    }''')
    def seed(key,html):page.evaluate('([id,html])=>qaSeed(id,html)',[key,html])
    def queue(payload=None,**kwargs):page.evaluate('(item)=>qaResponses.push(item)',{'payload':payload,**kwargs})
    def output():return page.locator('[id="'+RESULT+'"]').inner_html()
    def stored():return page.evaluate('(key)=>localStorage.getItem(key)',RESULT)
    def request_count():return page.evaluate('qaRequests.length')
    def previous():
        page.evaluate('([key,value])=>{localStorage.setItem(key,value);document.getElementById(key).innerHTML=value}',[RESULT,BEFORE])
    def reset_requests():page.evaluate('qaRequests=[];qaResponses=[];qaHeld=[]')
    def success(ids=None,**kwargs):queue({'pontos_altos':SUMMARY,'fontes':ids or ['n1','n2']},**kwargs)
    def generate(period='unico'):page.evaluate('(period)=>qaRun(period)',period)
    def status():return page.locator('.pontos-altos-status').text_content()
    def no_private(request):
        assert 'PRIVATE_ACCOUNT_NAME' not in json.dumps(request)
        assert 'REVIEW_ANSWER_MUST_NOT_LEAK' not in request['prompt']
        assert 'OTHER_PROGRAM_MUST_NOT_LEAK' not in request['prompt']
        assert 'GENERATED_SUMMARY_MUST_NOT_LEAK' not in request['prompt']
        assert 'STALE_TEXT_MUST_NOT_LEAK' not in request['prompt']

    previous();generate();assert request_count()==0 and output()==BEFORE and stored()==BEFORE
    seed(MORNING,'<p>Orar antes de decidir ajuda a confiar em Jeová.</p><div class="children" hidden><p>Comparar as decisões com a Bíblia evita agir por impulso.</p></div>')
    seed(AFTERNOON,'<p>Escutar os filhos com paciência ajuda a orientá-los.</p>')
    page.evaluate('''id=>{const value=JSON.parse(localStorage.getItem(id));value.fullText='STALE_TEXT_MUST_NOT_LEAK';value.summaryText='GENERATED_SUMMARY_MUST_NOT_LEAK';value.hasSummary=true;localStorage.setItem(id,JSON.stringify(value));}''',MORNING)
    success(hold=True)
    page.evaluate('qaJob=qaRun();qaJobDuplicate=qaRun();void 0')
    assert page.evaluate('qaJob===qaJobDuplicate')
    assert request_count()==1 and output()==BEFORE and stored()==BEFORE
    assert page.locator('.btn-gerar-pontos-altos').is_disabled()
    first=page.evaluate('qaRequests[0]');source=json.loads(first['prompt'])
    assert first['models']==[MODELS[0]] and first['isJson'] is True
    assert len(source['anotacoes'])==2 and source['periodo']=='Assembleia completa' and 'tema' not in source
    assert [note['periodo'] for note in source['anotacoes']]==['Manhã','Tarde']
    assert 'Comparar as decisões' in source['anotacoes'][0]['trechos'][0]
    assert 'corpo' not in source['anotacoes'][0]['discurso']
    assert not any(note['parcial'] for note in source['anotacoes'])
    assert 'somente' in first['systemInstruction'].lower() and 'menos se' in first['systemInstruction']
    no_private(first)
    page.evaluate('qaHeld.shift()();qaJob')
    assert output()==SUMMARY and stored()==SUMMARY and not page.locator('.btn-gerar-pontos-altos').is_disabled()

    page.evaluate("document.getElementById('qa-duplicate').remove();document.getElementById('qa-other').remove()")

    # Invalid successful HTTP response falls through the same configured queue.
    reset_requests();previous();queue({'pontos_altos':{'wrong':'type'},'fontes':['n1']});success()
    generate();assert [r['models'][0] for r in page.evaluate('qaRequests')]==MODELS[:2]
    assert stored()==SUMMARY
    reset_requests();previous()
    for value in ['not JSON','{"pontos_altos":"Resumo sem fontes válidas."}',json.dumps({'pontos_altos':SUMMARY,'fontes':['not-a-source']})]:queue(text=value)
    generate();assert [r['models'][0] for r in page.evaluate('qaRequests')]==MODELS
    assert stored()==BEFORE and output()==BEFORE and 'Não foi possível' in status(), {'stored':stored(),'output':output(),'status':status(),'wrapper':page.locator('.pontos-altos-wrapper').inner_html()}
    reset_requests();previous();queue(status=403,error='Synthetic denied')
    generate();assert request_count()==1 and output()==BEFORE and stored()==BEFORE

    # Optional explicit period is respected; the real programme keeps unico.
    reset_requests();success(['n1']);generate('manha')
    source=json.loads(page.evaluate('qaRequests[0].prompt'))
    assert len(source['anotacoes'])==1 and source['anotacoes'][0]['periodo']=='Manhã'

    # Changing a source or the destination while a result is in flight cannot
    # overwrite the current local/cloud version, even if the server ignores abort.
    reset_requests();previous();success(hold=True)
    page.evaluate('qaJob=qaRun();void 0')
    seed(AFTERNOON,'<p>Nova anotação de tarde que ainda precisa ser analisada.</p>')
    page.evaluate('qaHeld.shift()();qaJob')
    assert output()==BEFORE and stored()==BEFORE and 'mudaram' in status()
    reset_requests();previous();success(hold=True)
    page.evaluate('qaJob=qaRun();void 0')
    page.evaluate('(key)=>{localStorage.setItem(key,"Resultado mais recente da nuvem.");window.dispatchEvent(new CustomEvent("assembleia:cloudapplied",{detail:{keys:[key]}}))}',RESULT)
    page.evaluate('qaHeld.shift()();qaJob')
    assert output()=='Resultado mais recente da nuvem.' and stored()==output()
    reset_requests();previous();success(hold=True)
    page.evaluate('qaJob=qaRun();void 0')
    page.evaluate('''keys=>{keys.forEach(key=>localStorage.removeItem(key));window.dispatchEvent(new CustomEvent('assembleia:cloudapplied',{detail:{keys}}));}''',[MORNING,AFTERNOON,RESULT])
    page.evaluate('qaHeld.shift()();qaJob')
    assert stored() is None and SUMMARY not in output() and BEFORE not in output()

    # Long notes share the budget; both opening and closing lessons survive.
    seed(MORNING,'<p>ABERTURA_MANHA: a oração deve orientar as decisões.</p>'+('<p>A confiança se fortalece ao aplicar conselhos com paciência e atenção.</p>'*700)+'<p>FECHO_MANHA: confiar exige agir segundo o conselho aprendido.</p>')
    seed(AFTERNOON,'<p>ABERTURA_TARDE: escutar os filhos melhora a comunicação.</p>'+('<p>Entender as dificuldades dos filhos exige atenção e escuta paciente.</p>'*700)+'<p>FECHO_TARDE: dê tempo para os filhos expressarem os sentimentos.</p>')
    reset_requests();success();generate();source=json.loads(page.evaluate('qaRequests[0].prompt'))
    assert len(source['anotacoes'])==2 and all(note['parcial'] for note in source['anotacoes'])
    assert sum(len(text) for note in source['anotacoes'] for text in note['trechos'])<=16000
    for note,period in zip(source['anotacoes'],['MANHA','TARDE']):
        assert f'ABERTURA_{period}' in note['trechos'][0] and f'FECHO_{period}' in note['trechos'][-1]
    assert 'Baseado em trechos das anotações mais longas.' in output() and stored()==output()

    # A storage failure cannot enqueue a generated replacement to overwrite the
    # previous answer later on focus, while real note-draft retry remains intact.
    reset_requests();previous();success();page.evaluate('qaFailSave=true');generate();page.evaluate('qaFailSave=false;window.dispatchEvent(new Event("focus"))')
    assert output()==BEFORE and stored()==BEFORE
    assert 'resultado anterior foi mantido' in status()
    assert page.evaluate('AssembleiaIA.config.thresholdChars')==50
    assert page.evaluate('AssembleiaIA.config.modelFallbacks')==MODELS
    assert not errors,errors
    context.close();browser.close()
    return {'sources':'morning+afternoon; canonical rich notes; no account/review/other-program/generated text',
            'validations':'schema, model order, singleflight, source/destination races, deletion, balanced excerpts, storage failure'}

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            report={'chromium':run(p.chromium,'/usr/bin/chromium',origin)}
            if os.getenv('WEBKIT_EXECUTABLE'):report['webkit']=run(p.webkit,os.environ['WEBKIT_EXECUTABLE'],origin)
            print(json.dumps(report,ensure_ascii=False,indent=2))
    finally:server.shutdown()
