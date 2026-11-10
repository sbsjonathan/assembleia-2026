"""Recap source, citation and lifecycle regressions; no inference calls are made."""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MODELS = ['gemini-3.1-flash-lite-preview','gemini-3-flash-preview','gemini-2.5-flash']
FIXTURE = '''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main><h1 class="estudo-titulo">Confie em Jeová</h1>
<p class="paragrafo">CÂNTICOS: 127 e 88</p><p class="paragrafo"><strong>O QUE VAMOS VER</strong></p>
<p class="paragrafo" id="pg-1"><span>1</span> A <mark id="manual" class="hl-color-green" data-hl-id="manual">oração</mark> <mark id="other-agent" data-ia-owner="p-1" class="hl-color-yellow">fortalece</mark> a fé. <span id="source-clause">Podemos confiar em Jeová.</span><button>PRIVATE_BUTTON</button><span class="comentarios" contenteditable="true">PRIVATE_INLINE_NOTE</span></p>
<p class="paragrafo" id="pg-2"><span>2</span> <mark class="ia-underline-recap" data-ia-owner="rcp-1" data-ia-mode="owned">Jeová protege os fiéis.</mark> O <a class="bbl" id="bible-link" href="#biblia">Salmo 91</a> explica essa proteção.<a class="footnote-link" href="#fn">PRIVATE_FOOTNOTE_MARKER</a></p>
<p class="paragrafo" id="pg-3"><span>3</span> Agimos com fé. Agimos com fé.</p>
<div class="secao-recapitulacao"><h2 class="titulo-recapitulacao">O que aprendemos sobre:</h2><ul class="lista-recapitulacao"><li id="rcp-1">confiar em Jeová?<div class="anotacao"><div class="ia-wrapper" id="wrapper"><div id="response"><div class="ia-recap-container"><div class="ia-recap-answer">Resposta anterior.</div><div class="ia-recap-refs"><button class="ia-ref-chip" data-target-paragraph="2">§ 2</button></div></div></div><button>PRIVATE_GENERATE_BUTTON</button></div></div><div class="comentarios" contenteditable="true">PRIVATE_RECAP_COMMENT</div></li></ul></div>
</main><article><p class="paragrafo"><span>99</span>OUTSIDE_ARTICLE</p></article>
<div class="agente-overlay"><p class="paragrafo"><span>98</span>PRIVATE_TUTOR_REPLY</p></div>
<script>
window.estudoId='qa-recap';window.qaRequests=[];window.qaQueue=[];window.qaSaved=[];window.qaDeferred=[];window.qaEpoch=0;
window.sentinelaSync={localClearInProgress:false,localClearEpoch:()=>qaEpoch};
window.CacheAnotacao={salvar:(id,html)=>qaSaved.push({id,html})};
const nativeFetch=fetch.bind(window);window.fetch=async(input,options)=>{
 if(!String(input).includes('workers.dev'))return nativeFetch(input,options);
 const body=JSON.parse(options.body);qaRequests.push(body);const item=qaQueue.shift();if(!item)throw Error('Unexpected model request');
 if(item.defer)await new Promise(resolve=>qaDeferred.push(resolve));
 if(item.reject)throw Error(item.reject);
 return new Response(JSON.stringify(item.error?{error:item.error}:{text:item.text??JSON.stringify(item.payload)}),{status:item.status||200,headers:{'Content-Type':'application/json'}});
};
window.qaRun=()=>gerarRespostaIA_Recap('rcp-1',document.querySelector('#wrapper'),'response');
</script><script src="/sentinela/clickable/agente_recap.js"></script></body></html>'''

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path.split('?')[0]=='/recap-fixture.html':
            body=FIXTURE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()

def payload(quote='A oração fortalece a fé.',number=1,answer='Podemos fortalecer nossa fé por meio da oração.'):
    return {'natural_answer':answer,'highlights':[{'paragraph_number':number,'literal_text':quote}]}

def run_suite(browser,base):
    context=browser.new_context(viewport={'width':430,'height':873},is_mobile=True,has_touch=True,service_workers='block')
    context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    def reset():
        page.goto(base+'/recap-fixture.html',wait_until='load')
        page.evaluate('localStorage.clear()')
    def queue(*items):page.evaluate('(items)=>qaQueue.push(...items)',list(items))
    def start():page.evaluate('void (window.qaTask=qaRun())');page.wait_for_function('qaDeferred.length===1')
    def finish():page.evaluate('qaDeferred.shift()()');page.evaluate('qaTask')
    def saved():return page.evaluate('qaSaved')

    reset()
    # Cached reference chips work before any new inference or per-response wiring.
    page.locator('.ia-ref-chip').click();assert 'paragrafo-destaque' in page.locator('#pg-2').get_attribute('class')
    page.evaluate('window.scrollTo(0,0)')
    original=page.locator('#pg-1').inner_text()
    mark_state='el=>({text:el.textContent,attributes:[...el.attributes].map(a=>[a.name,a.value])})'
    manual=page.locator('#manual').evaluate(mark_state)
    other=page.locator('#other-agent').evaluate(mark_state)
    queue({'payload':payload()})
    page.evaluate('qaRun()')
    request=page.evaluate('qaRequests[0]')
    assert request['modelName']==MODELS[0]
    prompt=request['prompt'];assert 'O que aprendemos sobre:' in prompt and 'confiar em Jeová?' in prompt
    assert 'Confie em Jeová' in prompt and all(f'"number":{number}' in prompt for number in [1,2,3])
    for secret in ['PRIVATE_','OUTSIDE_ARTICLE','Resposta anterior.']:
        assert secret not in prompt,prompt
    assert 'anchor_start' not in prompt and 'anchor_end' not in prompt
    assert 'CÂNTICOS' not in prompt and 'O QUE VAMOS VER' not in prompt
    assert 'Podemos confiar em Jeová.' in prompt and 'Salmo 91' in prompt
    assert page.locator('.ia-recap-answer').inner_text()==payload()['natural_answer']
    assert page.locator('#pg-1').inner_text()==original
    assert page.locator('#manual').evaluate(mark_state)==manual
    assert page.locator('#other-agent').evaluate(mark_state)==other
    assert page.locator('#manual > mark.ia-underline-recap').count()==1
    assert page.locator('#other-agent > mark.ia-underline-recap').count()==1
    assert page.locator('mark.ia-underline-recap mark.ia-underline-recap').count()==0
    assert page.locator('#pg-2 mark[data-ia-owner="rcp-1"]').count()==0
    ids=[row['id'] for row in saved()];assert sorted(ids)==['pg-1','pg-2','response'],ids

    reset()
    # Invalid JSON and a wrong paragraph citation trigger the unchanged fallback order.
    queue({'text':'{"natural_answer":'}, {'payload':payload(number=2)}, {'payload':[payload()]})
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.map(r=>r.modelName)')==MODELS
    assert page.locator('.ia-recap-answer').inner_text()==payload()['natural_answer']

    reset()
    # An overlong answer is retried intact rather than cut mid-sentence.
    long_answer='A oração fortalece a fé. ' * 13
    assert len(long_answer.split())>60
    queue({'payload':payload(answer=long_answer)}, {'payload':payload()})
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.map(r=>r.modelName)')==MODELS[:2]
    assert page.locator('.ia-recap-answer').inner_text()==payload()['natural_answer']
    assert '60 palavras' in page.evaluate('qaRequests[0].prompt')
    assert page.locator('#manual > mark.ia-underline-recap').count()==1

    reset()
    # The short-answer limit does not shorten the exact supporting quotation.
    long_quote=('Oramos antes de decidir e confiamos em Jeová. ' * 9).strip()
    page.locator('#pg-3').evaluate('(el,text)=>{el.innerHTML="<span>3</span> ";el.append(text)}',long_quote)
    queue({'payload':payload(quote=long_quote,number=3)})
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.length')==1
    assert page.locator('#pg-3 .ia-underline-recap').inner_text()==long_quote

    reset()
    # Repeated/ambiguous quotes, invented text and word fragments must never be guessed.
    before=page.locator('#response').inner_html();old_marks=page.locator('#pg-2').inner_html()
    queue({'payload':payload('Agimos com fé.',3)}, {'payload':payload('A oração fortaleceu a fé.')}, {'payload':payload('ração fortalece a fé.')})
    page.evaluate('qaRun()')
    assert page.locator('#response').inner_html()==before and page.locator('#pg-2').inner_html()==old_marks
    assert page.locator('.ia-recap-status.ia-status-error').count()==1 and saved()==[]

    reset()
    queue({'payload':payload(), 'defer':True});start()
    page.evaluate('void (window.qaSecond=qaRun())')
    assert page.evaluate('qaRequests.length')==1
    assert page.locator('.ia-recap-answer').inner_text()=='Resposta anterior.'
    finish();assert page.locator('.ia-recap-answer').inner_text()==payload()['natural_answer']

    reset()
    before=page.locator('#response').inner_html()
    queue({'payload':payload(),'defer':True});start()
    page.evaluate('qaEpoch++;sentinelaSync.localClearInProgress=true;document.querySelector("#response").replaceChildren();')
    finish();assert page.locator('#response').inner_html()=='' and saved()==[]

    reset()
    page.evaluate('window.sentinelaSync=undefined')
    before=page.locator('#response').inner_html()
    queue({'payload':payload(),'defer':True});start()
    page.evaluate('localStorage.setItem("ass26_sentinela_clear_qa-recap",String(Date.now()))')
    finish();assert page.locator('#response').inner_html()==before and saved()==[]

    reset()
    # Sync may update storage while leaving a focused response's DOM unchanged.
    page.evaluate('localStorage.setItem("response","Resposta armazenada anterior.")')
    before=page.locator('#response').inner_html();old_marks=page.locator('#pg-2').inner_html()
    queue({'payload':payload(),'defer':True});start()
    page.evaluate('localStorage.setItem("response","Resposta mais nova da nuvem.")')
    finish()
    assert page.locator('#response').inner_html()==before and page.locator('#pg-2').inner_html()==old_marks
    assert page.evaluate('localStorage.getItem("response")')=='Resposta mais nova da nuvem.' and saved()==[]

    reset()
    # The underline writer also saves entire paragraph HTML; protect a newer
    # cloud paragraph when sync deliberately leaves the focused DOM unchanged.
    page.locator('#pg-1').evaluate('(el)=>localStorage.setItem(el.id,el.innerHTML)')
    before=page.locator('#response').inner_html();old_marks=page.locator('#pg-2').inner_html()
    queue({'payload':payload(),'defer':True});start()
    page.evaluate('localStorage.setItem("pg-1","<span>1</span> Marcação mais nova da nuvem.")')
    finish()
    assert page.locator('#response').inner_html()==before and page.locator('#pg-2').inner_html()==old_marks
    assert page.evaluate('localStorage.getItem("pg-1")')=='<span>1</span> Marcação mais nova da nuvem.' and saved()==[]

    reset()
    # A saved local mark already present in the DOM is preserved, not rejected.
    page.locator('#pg-1').evaluate('(el)=>localStorage.setItem(el.id,el.innerHTML)')
    queue({'payload':payload(),'defer':True});start()
    page.locator('#source-clause').evaluate('''(el)=>{
      el.innerHTML='<mark id="new-local-mark" class="hl-color-purple" data-hl-id="new-local">Podemos confiar em Jeová.</mark>';
      const paragraph=el.closest('.paragrafo');localStorage.setItem(paragraph.id,paragraph.innerHTML);
    }''')
    finish()
    assert page.locator('.ia-recap-answer').inner_text()==payload()['natural_answer']
    assert page.locator('#new-local-mark').get_attribute('data-hl-id')=='new-local'
    assert any(row['id']=='pg-1' and 'new-local-mark' in row['html'] for row in saved())

    reset()
    before=page.locator('#response').inner_html()
    queue({'payload':payload(),'defer':True});start()
    page.evaluate('document.querySelector("#source-clause").textContent="Podemos confiar em Jesus."')
    finish();assert page.locator('#response').inner_html()==before and saved()==[]

    reset()
    # A grounded refusal is explicit; an unsupported unreferenced answer is retried.
    queue({'payload':{'natural_answer':'Resposta sem fundamento.','highlights':[]}},
          {'payload':{'natural_answer':'O trecho fornecido não explica esse assunto.','insufficient_source':True,'highlights':[]}})
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.length')==2
    assert page.locator('.ia-recap-answer').inner_text()=='O trecho fornecido não explica esse assunto.'
    assert page.locator('.ia-ref-chip').count()==0

    reset()
    # Exact source matching supports a real line break and canonical accents.
    page.locator('#pg-3').evaluate('(el)=>el.innerHTML="<span>3</span> A unia\\u0303o traz paz.<br>Podemos cultivar a união."')
    original=page.locator('#pg-3').inner_text()
    queue({'payload':payload('A união traz paz. Podemos cultivar a união.',3)})
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.length')==1
    assert page.locator('#pg-3 .ia-underline-recap').count()==2
    assert page.locator('#pg-3 br').count()==1 and page.locator('#pg-3').inner_text()==original

    reset()
    # An ambiguous numbered source must not silently choose the first copy.
    page.evaluate('document.querySelector("main").append(document.querySelector("#pg-1").cloneNode(true))')
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.length')==0
    assert page.locator('.ia-recap-status.ia-status-error').count()==1

    reset()
    before=page.locator('#response').inner_html()
    page.evaluate('document.querySelector("#pg-3").append(document.createTextNode("Texto muito longo. ".repeat(3000)))')
    page.evaluate('qaRun()')
    assert page.evaluate('qaRequests.length')==0 and page.locator('#response').inner_html()==before
    assert 'limite' in page.locator('.ia-recap-status').inner_text()

    for key in ['response','pg-1']:
        reset()
        before=page.locator('#response').inner_html()
        page.evaluate('''key=>{
          const get=Storage.prototype.getItem;Storage.prototype.getItem=function(name){
            if(name===key)throw new DOMException('Storage unavailable','SecurityError');return get.call(this,name);
          };
        }''',key)
        page.evaluate('qaRun()')
        assert page.evaluate('qaRequests.length')==0 and page.locator('#response').inner_html()==before and saved()==[]
    assert not errors,errors
    context.close()

if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            for name,engine,options in [('chromium',p.chromium,{'executable_path':'/usr/bin/chromium','args':['--no-sandbox']})]+([('webkit',p.webkit,{'executable_path':os.environ['WEBKIT_EXECUTABLE']})] if os.getenv('WEBKIT_EXECUTABLE') else []):
                browser=engine.launch(**options);run_suite(browser,base);browser.close();print(f'PASS {name}: recap source, exact support, unchanged model fallbacks, protected marks, cached chips, dedup, clear/edit races and input bounds',flush=True)
    finally:server.shutdown()
