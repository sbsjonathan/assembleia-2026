"""Independent color/recap layers through production writers and marker controls.

Only a synthetic article and mocked model answers are used. No external calls.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
FIXTURE='''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/sentinela/style.css"><style>body{font:18px/1.7 sans-serif;padding:20px}.paragrafo{margin:22px 0}.anotacao{display:block}</style>
</head><body><main><h1 class="estudo-titulo">Confiança e fé</h1>
<p class="pergunta" id="q-1"><span>1.</span> O que devemos fazer?</p>
<p class="paragrafo" id="pg-1"><span>1</span> Confiamos em <a class="bbl" href="#bible" id="bible">Jeová</a>. Oramos <em>antes de decidir.</em> Agimos com fé.</p>
<section class="secao-recapitulacao"><h2 class="titulo-recapitulacao">O que aprendemos sobre:</h2><ul><li id="rcp-1">confiança?<div class="anotacao"><div class="ia-wrapper" id="wrap-1"><div id="response-1"></div></div></div></li><li id="rcp-2">oração?<div class="anotacao"><div class="ia-wrapper" id="wrap-2"><div id="response-2"></div></div></div></li></ul></section>
</main><script>
window.estudoId='qa-layers';window.qaWrites=[];window.qaQueue=[];
window.CacheAnotacao={carregar:id=>localStorage.getItem(id)||'',salvar:(id,html)=>{qaWrites.push({id,html});localStorage.setItem(id,html)}};
window.sentinelaSync={localClearEpoch:()=>0};
const nativeFetch=window.fetch.bind(window);window.fetch=async(url,options)=>{
 if(!String(url).includes('workers.dev'))return nativeFetch(url,options);
 const value=qaQueue.shift();if(!value)throw Error('Unexpected inference');
 return new Response(JSON.stringify({text:JSON.stringify(value)}),{headers:{'Content-Type':'application/json'}});
};
window.qaRecap=async(quote,owner=1)=>{
 qaQueue.push({natural_answer:'Podemos confiar em Jeová e agir com fé.',highlights:quote?[{paragraph_number:1,literal_text:quote}]:[],insufficient_source:!quote});
 await gerarRespostaIA_Recap('rcp-'+owner,document.querySelector('#wrap-'+owner),'response-'+owner);
};
window.qaLayers=text=>{
 const paragraph=document.querySelector('#pg-1'),walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);let node;const entries=[];
 while(node=walker.nextNode())for(const char of node.nodeValue){
  const ancestors=[];let p=node.parentElement;while(p&&p!==paragraph){if(p.tagName==='MARK')ancestors.push(p);p=p.parentElement;}
  entries.push({char,colors:ancestors.filter(m=>[...m.classList].some(c=>c.startsWith('hl-color-'))).map(m=>[...m.classList].find(c=>c.startsWith('hl-color-'))),dots:ancestors.filter(m=>m.classList.contains('ia-underline-recap')).map(m=>m.dataset.iaOwner)});
 }
 const all=entries.map(e=>e.char).join(''),start=all.indexOf(text);if(start<0)throw Error('Text absent: '+text);
 return entries.slice(start,start+text.length).filter(e=>/\\S/.test(e.char));
};
</script><script src="/sentinela/mark.js"></script><script src="/sentinela/clickable/agente_recap.js"></script>
<script type="module">
import * as hl from '/sentinela/clickable/perguntas-highlights.js';
window.qaColor=quote=>hl.applyHighlights('q-1',{parts:[{question:'O que devemos fazer?',highlights:[{paragraph_number:1,literal_text:quote}]}]},hl.buildSource('q-1'));
window.qaReady=true;
</script></body></html>'''

class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.startswith('/mark-layers.html'):
   data=FIXTURE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  else:super().do_GET()

def check(browser,base):
 context=browser.new_context(viewport={'width':430,'height':900},is_mobile=True,has_touch=True,service_workers='block',reduced_motion='reduce')
 context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def load(reset=True):
  page.goto(base+'/mark-layers.html');page.wait_for_function('qaReady')
  if reset:page.evaluate('localStorage.clear()');page.reload();page.wait_for_function('qaReady')
 def color(text):
  result=page.evaluate('text=>qaColor(text)',text);assert result['appliedCount']>0,result
 def recap(text,owner=1):page.evaluate('([text,owner])=>qaRecap(text,owner)',[text,owner])
 def layers(text,colors,dots):
  rows=page.evaluate('qaLayers',text)
  assert rows and all(r['colors']==colors and sorted(r['dots'])==sorted(dots) for r in rows),(text,rows)
 def stable():
  assert page.locator('#pg-1').inner_text()=='1 Confiamos em Jeová. Oramos antes de decidir. Agimos com fé.'
  assert page.locator('#bible').get_attribute('href')=='#bible'
  assert page.locator('#pg-1 em').inner_text()=='antes de decidir.'
  assert page.locator('#pg-1').inner_html()==page.evaluate('localStorage.getItem("pg-1")')
  assert page.evaluate('qaLayers("Confiamos em Jeová. Oramos antes de decidir. Agimos com fé.").every(r=>r.colors.length<=1)')
  assert page.evaluate('[...document.querySelectorAll("#pg-1 .ia-underline-recap")].every(m=>getComputedStyle(m).borderBottomStyle==="dotted")')
  assert page.evaluate('[...document.querySelectorAll("#pg-1 mark")].filter(m=>[...m.classList].some(c=>c.startsWith("hl-color-"))).every(m=>{const s=getComputedStyle(m);return s.backgroundImage!=="none"||s.backgroundColor!=="rgba(0, 0, 0, 0)"})')

 for first in ['recap','color']:
  load()
  if first=='recap':recap('Confiamos em Jeová. Oramos antes de decidir.');color('Oramos antes de decidir. Agimos com fé.')
  else:color('Oramos antes de decidir. Agimos com fé.');recap('Confiamos em Jeová. Oramos antes de decidir.')
  layers('Confiamos em Jeová.',[],['rcp-1']);layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-1']);layers('Agimos com fé.',['hl-color-yellow'],[]);stable()
  # Restoring cached HTML retains both layers and their independent ownership.
  before=page.locator('#pg-1').inner_html();load(False);assert page.locator('#pg-1').inner_html()==before
  layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-1'])
  # Regenerating the color removes only its old range, including fragments that
  # wrap dotted children; regenerating recap likewise preserves colored children.
  color('Confiamos em Jeová.');layers('Oramos antes de decidir.',[],['rcp-1']);layers('Confiamos em Jeová.',['hl-color-yellow'],['rcp-1'])
  recap('Agimos com fé.');layers('Confiamos em Jeová.',['hl-color-yellow'],[]);layers('Agimos com fé.',[],['rcp-1']);stable()

 load();color('Oramos antes de decidir.');recap('Oramos antes de decidir.');recap('Oramos antes de decidir.',2)
 layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-1','rcp-2']);stable()
 recap('Confiamos em Jeová.',1)
 layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-2']);layers('Confiamos em Jeová.',[],['rcp-1']);stable()

 # A manual color remains manual even while recap adds/removes its own layer.
 load();page.locator('#pg-1 em').evaluate('el=>el.innerHTML=\'<mark class="hl-color-purple" data-hl-id="manual" id="manual">antes de decidir.</mark>\'')
 page.locator('#pg-1').evaluate('el=>CacheAnotacao.salvar(el.id,el.innerHTML)')
 recap('Oramos antes de decidir.');color('Oramos antes de decidir. Agimos com fé.')
 layers('antes de decidir.',['hl-color-purple'],['rcp-1']);assert page.locator('#manual').get_attribute('data-ia-owner') is None
 recap('Confiamos em Jeová.');layers('antes de decidir.',['hl-color-purple'],[]);stable()

 # Older saved HTML can hold both effects on one element with only one owner.
 # Refresh removes only the owned effect; the other is preserved conservatively
 # without assigning an invented owner to it.
 load();page.locator('#pg-1 em').evaluate('''el=>el.innerHTML='<mark id="legacy" class="hl-color-yellow ia-highlight ia-underline-recap" data-hl-id="legacy" data-ia-owner="q-1" data-ia-mode="owned">antes de decidir.</mark>' ''')
 page.locator('#pg-1').evaluate('el=>CacheAnotacao.salvar(el.id,el.innerHTML)')
 color('Agimos com fé.')
 layers('antes de decidir.',[],[None]);layers('Agimos com fé.',['hl-color-yellow'],[])
 assert page.locator('#legacy').get_attribute('data-ia-owner') is None;stable()
 load();page.locator('#pg-1 em').evaluate('''el=>el.innerHTML='<mark id="legacy" class="hl-color-purple ia-underline-recap" data-hl-id="legacy" data-ia-owner="rcp-1" data-ia-mode="owned">antes de decidir.</mark>' ''')
 page.locator('#pg-1').evaluate('el=>CacheAnotacao.salvar(el.id,el.innerHTML)')
 recap('Confiamos em Jeová.')
 layers('antes de decidir.',['hl-color-purple'],[]);layers('Confiamos em Jeová.',[],['rcp-1'])
 assert page.locator('#legacy').get_attribute('data-ia-owner') is None;stable()

 # A citation wholly inside a dotted range can still receive a color.
 load();recap('Oramos antes de decidir.');color('Oramos antes de decidir.')
 layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-1']);stable()
 # The normal color trash removes only color, leaving dotted support intact.
 target=page.locator('#pg-1 mark.hl-color-yellow').filter(has_text='Oramos').first
 target.tap();page.locator('#hl-custom-menu .hl-btn-trash').click()
 layers('Oramos antes de decidir.',[],['rcp-1']);stable()
 # Removing a dotted-only mark leaves the source and link in place.
 load(False);page.locator('#pg-1 mark.ia-underline-recap').filter(has_text='Oramos').first.tap()
 page.locator('#hl-custom-menu .hl-btn-trash').click()
 layers('Oramos antes de decidir.',[],[]);stable()

 # Recap regeneration under a currently animating color must not cancel the
 # existing left-to-right sweep or persist a transient animation state.
 load();page.emulate_media(reduced_motion='no-preference')
 page.wait_for_function('!matchMedia("(prefers-reduced-motion: reduce)").matches')
 page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 color('Oramos antes de decidir.');page.evaluate('window.qaAnimations=[...document.querySelectorAll("#pg-1 mark.hl-color-yellow")].flatMap(m=>m.getAnimations());qaAnimations.forEach(a=>a.pause())')
 recap('Oramos antes de decidir.')
 assert page.evaluate('qaAnimations.length>0 && qaAnimations.every(a=>a.playState==="paused")'),page.evaluate('qaAnimations.map(a=>({state:a.playState,time:a.currentTime,connected:a.effect?.target?.isConnected}))')
 assert page.locator('#pg-1 mark[style]').count()==0
 layers('Oramos antes de decidir.',['hl-color-yellow'],['rcp-1']);stable()
 assert not errors,errors
 context.close()

if __name__=='__main__':
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
 try:
  with sync_playwright() as p:
   for name,engine,options in [('chromium',p.chromium,{'executable_path':'/usr/bin/chromium','args':['--no-sandbox']})]+([('webkit',p.webkit,{'executable_path':os.environ['WEBKIT_EXECUTABLE']})] if os.getenv('WEBKIT_EXECUTABLE') else []):
    browser=engine.launch(**options);check(browser,base);browser.close();print(f'PASS {name}: independent color/recap layers, both orders, partial overlap, refresh, manual ownership, cache restore, deletion and animation',flush=True)
 finally:server.shutdown()
