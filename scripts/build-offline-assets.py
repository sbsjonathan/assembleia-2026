#!/usr/bin/env python3
"""Regenerate after every source edit: file hashes and release must match the SW exactly."""
import json, hashlib, re
from pathlib import Path
import sys
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
# The approved v1 sources are immutable; only their version-switch entry is new.
v1_manifest=json.loads((root/'richtext-v1/manifest.json').read_text())
for record in v1_manifest['files']:
    actual=hashlib.sha256((root/record['snapshot']).read_bytes()).hexdigest()
    if actual != record['sha256']:
        raise SystemExit('Notes v1 snapshot changed: '+record['snapshot'])
exclude={'sw.js','offline-assets.json','biblia/sw.js','biblia/manifest.webmanifest'}
extensions={'.html','.css','.js','.json','.png','.jpg','.jpeg','.svg','.webp','.gif','.woff2','.wasm','.txt'}
app=[]
for f in root.rglob('*'):
    if not f.is_file(): continue
    p=f.relative_to(root).as_posix()
    if p in exclude or p.startswith('biblia/bundled/') or '/testes/' in p or p.startswith(('.', 'tests/', 'scripts/')) or f.suffix not in extensions: continue
    app.append(p)
shell=[
    'index.html','estudos.html','shared/app-scope.js','stylep.css','atualizar.html','home-layout.js','main.js','styles.css','manifest.json',
    'sentinela/artigos/estudo.html','sentinela/artigos/article-runtime.js','sentinela/artigos/reading-position.js',
    'navbar/navbar-unified.css','navbar/navbar-unified.js','navbar/network-sensor.js',
    'assets/icons/icon-192.png','assets/icons/icon-512.png','assets/icons/apple-touch-icon.png',
    'assets/icons/favicon-32.png','assets/icons/maskable-icon-512.png',
    'biblia/biblia.html','biblia/legacy-routes.js','biblia/app.js','biblia/styles.css','biblia/integration.js','biblia/integration.css',
    'biblia/reader-worker.js','biblia/reader-cache.js','biblia/bundled-bible.js','biblia/chapter-layout.js','biblia/publication-sections.js',
    'biblia/publication-media.js','biblia/audio-source.js','biblia/audio-player.js',
    'biblia/text-actions.js','biblia/read-along.js',
    'biblia/search-client.js','biblia/search-panel.js','biblia/search-panel.css',
    'biblia/search-worker.js','biblia/search-core.js','biblia/search-extract.js','biblia/search/builtin.json.gz',
    'biblia/vendor/sql-wasm.js','biblia/vendor/sql-wasm.wasm','biblia/vendor/fflate.js',
    'biblia/fonts/fonts.css',
]
shell+=['sentinela/style.css','sentinela/imagem.js','sentinela/imagem/swiper-zoom.js','sentinela/imagem/swiper-zoom.css','worker/worker.html','worker/worker.js','sentinela/biblia/scriptbbl.js','sentinela/biblia/stylebbl.css','shared/typography.js','shared/typography.css','shared/statusbar.js','shared/statusbar.css','shared/statusbar-diagnostics.js','shared/statusbar-diagnostics.css','shared/statusbar-diagnostics-data.js','diagnostico-statusbar.html','diagnostico-pwa/index.html','diagnostico-pwa/manifest.json','diagnostico-pwa/teste.js','diagnostico-pwa/teste.css','biblia/dialog-motion.js','biblia/interaction-motion.js','biblia/interaction-motion.css','sentinela/menu/menu.js']
shell+=['sentinela/clickable/'+name for name in ['clickable.js','clickable.css','agente_perguntas.js','agente_recap.js','agente-obj.js','agente-sub.js']]
# Tutor UI and its context parser must upgrade together, including downloaded articles.
shell+=['sentinela/clickable/agente-modal/'+name for name in ['agente-modal.js','agente-modal.css','agente-contexto.js']]
# Notes code and its persistence bridge must upgrade atomically with the new shell.
shell+=sorted(f.relative_to(root).as_posix() for d in ['richtext','save','richtext-v1','save-v1'] for f in (root/d).rglob('*') if f.is_file() and f.suffix in {'.html','.css','.js'})
shell+=sorted(f.relative_to(root).as_posix() for d in ['programacao','assembleia'] for f in (root/d).rglob('*') if f.is_file() and f.suffix in {'.html','.css','.js','.jpeg','.png'})
shell+=sorted(f.relative_to(root).as_posix() for f in (root/'biblia/fonts').glob('*.woff2'))
# Corrected source chapters used by the Notes verse preview.
shell+=['sentinela/biblia/data/'+name+'.json' for name in ['joao','salmos','lamentacoes','mateus','marcos','lucas','atos','romanos']]
# These bridge files are produced by the integration task before deployment.
app=sorted(set(app+shell))
missing=[p for p in app if not(root/p).is_file()]
if missing:
    raise SystemExit('Missing critical app files: '+', '.join(missing))
match=re.search(r"const APP_VERSION = '([^']+)'", (root/'sw.js').read_text())
if not match: raise SystemExit('APP_VERSION was not found in sw.js')
output={'version':match.group(1),'shell':sorted(set(shell)),'app':app,
        'revisions':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in app}}
(root/'offline-assets.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'version':output['version'],'shell':len(output['shell']),'app':len(app),'missing':missing},ensure_ascii=False))
