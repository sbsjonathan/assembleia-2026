"""Objective/section agents: public-source scope, validated fallbacks and safe updates.

The production entry points run against synthetic Worker responses. No AI,
Supabase, or other external request leaves the browser.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = '''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px sans-serif;margin:20px}.ia-loading{opacity:.8}.anotacao{display:block}.paragrafo{line-height:1.5}</style></head><body data-estudo="35"><main>
<h1 class="estudo-titulo" id="intro">Confiança que orienta nossas decisões<button>PRIVATE_TITLE_BUTTON</button></h1>
<div class="objetivo" id="obj-35"><p class="objetivo-texto">Entender como a confiança orienta nossas decisões.<span class="anotacao">PRIVATE_OBJECTIVE</span></p></div>
<p class="citacao">“Confie em Jeová.” — <a class="bbl">Provérbios 3:5</a></p>
<div class="anotacao"><div class="ia-wrapper" id="wo"><div id="ro"></div></div></div>
<div class="anotacao"><div class="ia-wrapper" id="wi"><div id="ri"></div></div></div>
<div class="group"><p class="paragrafo" id="pg-1"><span>1</span> A introdução apresenta FONTE_AAA e o tema da confiança. <mark>O estudo trata de decisões.</mark></p></div>
<section><div><h2 class="subtitulo" id="sub-1">Ouça antes de decidir<button>PRIVATE_SECTION_BUTTON</button></h2></div>
<div class="anotacao"><div class="ia-wrapper" id="ws"><div id="rs"></div></div></div>
<div><p class="pergunta"><span>2–3.</span> Como podemos decidir?</p></div>
<div class="ia-container"><p class="paragrafo" id="pg-2"><span>2</span> Ouvir os conselhos de Jeová fortalece a confiança. <a class="bbl">Provérbios 3:5</a> <span class="comentarios">PRIVATE_INLINE</span></p>
<div class="comentarios"><p class="paragrafo"><span>99</span> PRIVATE_PARAGRAPH</p></div>
<p class="paragrafo" id="pg-3"><span>3</span> Agir de acordo com esses conselhos ajuda a tomar boas decisões. <em>A ação demonstra confiança.</em></p></div>
</section>
<section><div><h2 class="subtitulo" id="sub-2">Apoie outras pessoas</h2></div><p class="paragrafo" id="pg-4"><span>4</span> Oferecer encorajamento pode fortalecer outras pessoas. OUTSIDE_FIRST_SECTION</p></section>
<div class="secao-recapitulacao">Recapitulação</div>
<div class="anotacao"><p class="paragrafo">PRIVATE_GENERATED_SOURCE</p></div>
<div contenteditable="true"><p class="paragrafo">PRIVATE_EDITOR</p></div>
<dialog><p class="paragrafo"><span>8</span>PRIVATE_DIALOG</p></dialog><div role="dialog"><p class="paragrafo"><span>9</span>PRIVATE_ROLE_DIALOG</p></div>
</main>
<script>window.estudoId='35';window.semanaAtual='02-11';window.sentinelaSync={localClearInProgress:false};</script>
<script src="/sentinela/clickable/agente-obj.js"></script><script src="/sentinela/clickable/agente-sub.js"></script></body></html>'''
MOCKS = '''(() => {
 window.qaRequests=[];window.qaResponses=[];window.qaSaves=[];window.qaDeferred=[];
 window.CacheAnotacao={salvar(id,html){qaSaves.push({id,html});}};
 const nativeFetch=fetch.bind(window);
 window.fetch=async(input,options={})=>{
  if(!String(input).includes('workers.dev'))return nativeFetch(input,options);
  const request=JSON.parse(options.body);qaRequests.push(request);
  const item=qaResponses.shift();if(!item)throw new Error('Unexpected synthetic request');
  if(item.defer)await new Promise(resolve=>qaDeferred.push(resolve));
  if(item.reject)throw new TypeError(item.reject);
  return new Response(JSON.stringify(item.error?{error:item.error}:{text:item.text??JSON.stringify(item.payload),model:request.modelName}),{status:item.status||200,headers:{'Content-Type':'application/json'}});
 };
 window.qaRun=kind=>kind==='obj'?gerarRespostaIA_Objetivo('obj-35',document.getElementById('wo'),'ro'):gerarRespostaIA_Subtitulo(kind==='intro'?'intro':'sub-1',document.getElementById(kind==='intro'?'wi':'ws'),kind==='intro'?'ri':'rs');
})();'''
OBJ={'visao_geral':['O estudo mostra como a confiança orienta nossas decisões.','Ouvir e agir se complementam nos exemplos apresentados.'], 'aplicacao_pratica':['Podemos considerar os conselhos antes de decidir.','Podemos encorajar outras pessoas quando precisarem.']}
SUB={'destaque':'A confiança se mostra ao ouvir e agir.', 'visao_geral':['Ouvir os conselhos fornece uma base para a decisão.','Agir conforme o conselho demonstra a confiança mencionada.']}
MODELS=['gemini-3.1-flash-lite-preview','gemini-3-flash-preview','gemini-2.5-flash']

class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path.startswith('/qa-obj-sub.html'):
   data=FIXTURE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  else:super().do_GET()

def queue(page,payload=None,**extra):page.evaluate('item=>qaResponses.push(item)',{'payload':payload,**extra})
def source(request):return json.loads(request['prompt'].split('=== FONTE (JSON) ===\n',1)[1].split('\n=== FIM DA FONTE ===',1)[0])
def run(browser,base):
 context=browser.new_context(viewport={'width':430,'height':873})
 context.add_init_script(MOCKS)
 context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
 page=context.new_page()
 def reset():
  page.goto(base+'/qa-obj-sub.html',wait_until='domcontentloaded');page.evaluate('localStorage.clear()')
 reset()
 for kind,payload,target in [('obj',OBJ,'ro'),('sub',SUB,'rs'),('intro',SUB,'ri')]:
  queue(page,payload);page.evaluate('kind=>qaRun(kind)',kind)
  request=page.evaluate('qaRequests.at(-1)');material=source(request)
  assert 'PRIVATE_' not in request['prompt'],request['prompt']
  assert request['modelName']==MODELS[0] and request['isJson']
  expected=[1,2,3,4] if kind=='obj' else [2,3] if kind=='sub' else [1]
  assert [p['numero'] for p in material['paragrafos']]==expected,material
  assert all(not p['texto'].startswith(str(p['numero'])+' ') for p in material['paragrafos'])
  assert page.locator('#'+target+' .ia-tabs-container').count()==1
  if kind=='obj':assert material['objetivo']=='Entender como a confiança orienta nossas decisões.'
  if kind=='sub':assert 'OUTSIDE_FIRST_SECTION' not in request['prompt']
 # Identical sources reuse the cache; private edits do not invalidate it.
 before=page.evaluate('qaRequests.length')
 page.evaluate("document.querySelector('.comentarios').append(' PRIVATE_CHANGED')")
 page.evaluate("qaRun('obj')");page.evaluate("qaRun('sub')")
 assert page.evaluate('qaRequests.length')==before
 # Equal-length changes invalidate the source fingerprint.
 page.evaluate("document.querySelector('#pg-1').innerHTML=document.querySelector('#pg-1').innerHTML.replace('FONTE_AAA','FONTE_BBB')")
 queue(page,OBJ);page.evaluate("qaRun('obj')")
 assert page.evaluate('qaRequests.length')==before+1
 assert 'FONTE_BBB' in page.evaluate('qaRequests.at(-1).prompt')
 # Same section ID in a different article is not a cache hit.
 page.evaluate("window.estudoId='36'");queue(page,SUB);page.evaluate("qaRun('sub')")
 assert page.evaluate('qaRequests.length')==before+2
 for kind,payload,target in [('obj',OBJ,'ro'),('sub',SUB,'rs')]:
  reset();queue(page,payload);page.evaluate('kind=>qaRun(kind)',kind)
  cache_key='qa:obj:35' if kind=='obj' else 'qa:sub:sub-1'
  cached=page.evaluate('key=>localStorage.getItem(key)',cache_key)
  # An unchanged destination can reuse its auxiliary cache.
  page.evaluate('({target,cached})=>localStorage.setItem(target,JSON.parse(cached).html)',{'target':target,'cached':cached})
  page.evaluate('kind=>qaRun(kind)',kind);assert page.evaluate('qaRequests.length')==1
  # A newer cloud response invalidates only reuse, without erasing either value.
  remote='<p>Resposta atualizada na nuvem.</p>'
  page.evaluate('({target,remote})=>localStorage.setItem(target,remote)',{'target':target,'remote':remote})
  if kind=='sub':
   page.evaluate('remote=>localStorage.setItem("r-sub-1",remote)',remote)
   assert page.evaluate('AgenteSubResumo.getCachedHTML("sub-1")')==''
  assert page.evaluate('key=>localStorage.getItem(key)',cache_key)==cached
  assert page.evaluate('target=>localStorage.getItem(target)',target)==remote
  queue(page,payload);page.evaluate('kind=>qaRun(kind)',kind)
  assert page.evaluate('qaRequests.length')==2
  reset()
  unsupported={**payload,'visao_geral':['A base está nos parágrafos 98 a 99.']}
  queue(page,unsupported);queue(page,payload);page.evaluate('kind=>qaRun(kind)',kind)
  assert page.evaluate('qaRequests.map(r=>r.modelName)')==MODELS[:2]
  assert '98' not in page.locator('#'+target+' .ia-tabs-container').inner_text()
  reset()
  queue(page,{'visao_geral':[{'texto':'invalid'}],'destaque':{},'aplicacao_pratica':[]})
  queue(page,text='{"visao_geral":[')
  queue(page,[payload])
  page.evaluate('kind=>qaRun(kind)',kind)
  assert page.evaluate('qaRequests.map(r=>r.modelName)')==MODELS
  assert page.locator('#'+target+' .ia-tabs-container').count()==1
  # Keep previous good output and selected tab while an update is pending.
  page.evaluate("document.querySelector('#pg-2').append(' Fonte atualizada.')")
  queue(page,payload,defer=True)
  assert page.evaluate('''kind=>{const first=qaRun(kind);window.qaDone=first;return first===qaRun(kind);}''',kind)
  page.wait_for_function('qaDeferred.length===1')
  assert page.locator('#'+target+' .ia-tabs-container').count()==1
  page.locator('#'+target+' .ia-tab-btn').nth(1).click()
  page.evaluate('qaDeferred.shift()()');page.evaluate('qaDone')
  assert page.locator('#'+target+' .ia-tab-btn').nth(1).evaluate("el=>el.classList.contains('active')")
  assert page.evaluate('qaRequests.length')==4
  # All invalid responses retain the old answer; error text is never persisted.
  page.evaluate("document.querySelector('#pg-2').append(' Mais contexto.')")
  previous=page.locator('#'+target+' .ia-tabs-container').inner_text();saves=page.evaluate('qaSaves.length')
  for _ in MODELS:queue(page,{'visao_geral':[], 'aplicacao_pratica':[1], 'destaque':7})
  page.evaluate('kind=>qaRun(kind)',kind)
  assert page.locator('#'+target+' .ia-tabs-container').inner_text()==previous
  assert page.locator('#'+target+' [data-analysis-status="error"]').count()==1
  assert page.evaluate('qaSaves.length')==saves
  # Oversize inputs fail explicitly before any RPC, rather than slicing an article.
  page.evaluate("document.querySelector('#pg-2').append(' texto original'.repeat(4000))")
  requests=page.evaluate('qaRequests.length');page.evaluate('kind=>qaRun(kind)',kind)
  assert page.evaluate('qaRequests.length')==requests
  assert 'limite' in page.locator('#'+target+' [data-analysis-status="error"]').inner_text()
  assert page.locator('#'+target+' .ia-tabs-container').inner_text()==previous
  # A persisted clear epoch suppresses late success even if the transient flag is false.
  reset();queue(page,payload,defer=True)
  page.evaluate('kind=>{window.qaDone=qaRun(kind)}',kind);page.wait_for_function('qaDeferred.length===1')
  page.evaluate("localStorage.setItem('ass26_sentinela_clear_35','42');qaDeferred.shift()()")
  page.evaluate('qaDone')
  assert page.evaluate('qaSaves.length')==0 and page.locator('#'+target+' .ia-tabs-container').count()==0
  # A deleted output or replaced source must not be resurrected either.
  reset();queue(page,payload,defer=True)
  page.evaluate('kind=>{window.qaDone=qaRun(kind)}',kind);page.wait_for_function('qaDeferred.length===1')
  page.evaluate("document.querySelector('#pg-2').append(' Outra fonte.');qaDeferred.shift()()")
  page.evaluate('qaDone')
  assert page.evaluate('qaSaves.length')==0 and page.locator('#'+target+' .ia-tabs-container').count()==0
  # Clearing during an invalid response also prevents further model attempts.
  reset();queue(page,text='not-json',defer=True)
  page.evaluate('kind=>{window.qaDone=qaRun(kind)}',kind);page.wait_for_function('qaDeferred.length===1')
  page.evaluate("localStorage.setItem('ass26_sentinela_clear_all','100');qaDeferred.shift()()")
  page.evaluate('qaDone');assert page.evaluate('qaRequests.length')==1
  # Cloud apply may update storage but leave a focused response DOM intact.
  # A late result must neither overwrite that newer value nor start a fallback.
  for late in [{'payload':payload},{'text':'not-json'}]:
   reset()
   old='<button id="qa-focused-tab">Aba em foco</button><p>Resposta anterior visível.</p>'
   remote='<p>Resposta mais recente recebida da nuvem.</p>'
   page.evaluate('''({target,old})=>{document.getElementById(target).innerHTML=old;localStorage.setItem(target,old);}''',{'target':target,'old':old})
   page.evaluate('item=>qaResponses.push(item)',{**late,'defer':True})
   page.evaluate('kind=>{window.qaDone=qaRun(kind)}',kind);page.wait_for_function('qaDeferred.length===1')
   page.locator('#qa-focused-tab').focus()
   page.evaluate('({target,remote})=>localStorage.setItem(target,remote)',{'target':target,'remote':remote})
   page.evaluate('qaDeferred.shift()()');page.evaluate('qaDone')
   assert page.evaluate('target=>localStorage.getItem(target)',target)==remote
   assert page.locator('#'+target).inner_html()==old
   assert page.locator('#qa-focused-tab').evaluate('el=>document.activeElement===el')
   assert page.evaluate('qaSaves.length')==0 and page.evaluate('qaRequests.length')==1
  # Optional QA cache quota errors do not suppress the annotation store save.
  reset();page.evaluate("""()=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('qa:'))throw new DOMException('Quota','QuotaExceededError');return native.call(this,key,value);};}""")
  queue(page,payload);page.evaluate('kind=>qaRun(kind)',kind)
  assert page.evaluate('qaSaves.length')==1 and page.locator('#'+target+' .ia-tabs-container').count()==1
 context.close()

if __name__=='__main__':
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  with sync_playwright() as p:
   engines=[('chromium',p.chromium,{'executable_path':os.getenv('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),'args':['--no-sandbox']})]
   if os.getenv('WEBKIT_EXECUTABLE'):engines.append(('webkit',p.webkit,{'executable_path':os.environ['WEBKIT_EXECUTABLE']}))
   for name,engine,options in engines:
    browser=engine.launch(**options);run(browser,base);browser.close();print(f'PASS {name}: objective/section source scope, prompt budgets, schema fallback, cache, dedup, clear/edit races and preserved answers',flush=True)
 finally:server.shutdown()
