"""Browser regression checks for sibling GitHub Pages application isolation.

Run: python tests/test_app_scope.py
Requires Playwright and Chromium. Set WEBKIT_EXECUTABLE to also test WebKit.
Only synthetic data in fresh browser contexts is used; no external network.
"""
import json
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "ass26:"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        fixtures = {
            "/plain.html": ("text/html", "<!doctype html><body>Sibling application</body>"),
            "/scope.html": ("text/html", '<!doctype html><script src="/shared/app-scope.js"></script><body>Assembly application</body>'),
            "/scope-worker.js": ("text/javascript", """
                importScripts('/shared/app-scope.js');
                importScripts('/shared/app-scope.js');
                const request = indexedDB.open('worker-check', 1);
                request.onsuccess = () => {
                    const name = request.result.name;
                    request.result.close();
                    postMessage({name, prefix: AssemblyScope.prefix});
                };
                request.onerror = () => postMessage({error:request.error.message});
            """),
            "/migration-worker.js": ("text/javascript", """
                importScripts('/shared/app-scope.js');
                onmessage = ({data:name}) => {
                    const request = indexedDB.open(name, 2);
                    request.onsuccess = () => {
                        const db=request.result, tx=db.transaction('publications');
                        const read=tx.objectStore('publications').get('bible');
                        tx.oncomplete=()=>{db.close();postMessage({name:db.name,title:read.result.title});};
                        tx.onerror=()=>postMessage({error:tx.error.message});
                    };
                    request.onerror=()=>postMessage({error:request.error.message});
                };
            """),
        }
        if self.path not in fixtures:
            return super().do_GET()
        kind, source = fixtures[self.path]
        data = source.encode()
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


OPEN_DB = """name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
})"""
DELETE_DB = """name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
})"""


def check(browser, origin):
    context = browser.new_context(service_workers="block")
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") else route.abort())
    sibling = context.new_page()
    sibling.goto(origin + "/plain.html")
    sibling.evaluate("""() => {
        localStorage.setItem('sentinela-note', 'keep');
        localStorage.setItem('same-key', 'sibling');
        sessionStorage.setItem('sibling-session', 'keep');
    }""")
    sibling.evaluate(OPEN_DB, "jwpub-iphone-library")
    # Same tab retains the original sessionStorage, allowing its isolation to be verified.
    sibling.goto(origin + "/scope.html")
    assert sibling.evaluate("Object.keys(sessionStorage)") == []
    sibling.evaluate("sessionStorage.setItem('draft', 'assembly')")
    sibling.evaluate("sessionStorage.clear()")
    sibling.goto(origin + "/plain.html")
    assert sibling.evaluate("sessionStorage.getItem('sibling-session')") == "keep"

    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/scope.html")
    assert page.evaluate("AssemblyScope.prefix") == PREFIX
    assert page.evaluate("localStorage.getItem('same-key')") is None
    assert page.evaluate("localStorage.getItem('sentinela-note')") is None
    assert page.evaluate("Object.keys(localStorage)") == []
    page.evaluate("""() => {
        localStorage.setItem('same-key', 'assembly');
        localStorage.propertyWrite = 'value';
        localStorage.setItem('__proto__', 'ordinary stored value');
        sessionStorage.setItem('session-only', 'ok');
    }""")
    assert page.evaluate("localStorage.propertyWrite") == "value"
    assert page.evaluate("localStorage.getItem('__proto__')") == "ordinary stored value"
    assert page.evaluate("localStorage.length") == 3
    assert set(page.evaluate("Object.keys(localStorage)")) == {"same-key", "propertyWrite", "__proto__"}
    assert set(page.evaluate("Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))")) == {"same-key", "propertyWrite", "__proto__"}
    assert page.evaluate("localStorage.key(99)") is None
    page.evaluate("delete localStorage.propertyWrite")
    assert page.evaluate("localStorage.getItem('propertyWrite')") is None
    assert sibling.evaluate("localStorage.getItem('same-key')") == "sibling"
    assert sibling.evaluate("localStorage.getItem('ass26:same-key')") == "assembly"
    assert page.evaluate("localStorage instanceof Storage")

    # The app receives its own logical keys and its public Storage identity.
    page.evaluate("""() => {
        window.received = [];
        addEventListener('storage', event => received.push({key:event.key,
            oldValue:event.oldValue, newValue:event.newValue,
            local:event.storageArea === localStorage}));
    }""")
    sibling.evaluate("localStorage.setItem('other-app-change', 'ignore')")
    sibling.evaluate("localStorage.setItem('ass26:same-key', 'updated')")
    page.wait_for_function("received.length === 1")
    assert page.evaluate("received") == [{"key": "same-key", "oldValue": "assembly", "newValue": "updated", "local": True}]

    # The article fallback replaces the document, which removes Window listeners
    # but leaves the scoped facades in place. Its bootstrap must restore capture.
    page.evaluate("""() => {
        window.originalStorage = localStorage;
        window.originalIndexedDB = indexedDB;
        document.open();
        document.write('<!doctype html><script src="/shared/app-scope.js"><\\/script><body id="replacement">Downloaded article</body>');
        document.close();
    }""")
    page.wait_for_selector('#replacement')
    assert page.evaluate("localStorage === originalStorage && indexedDB === originalIndexedDB")
    page.evaluate("""() => {
        window.received = [];
        addEventListener('storage', event => received.push({key:event.key,
            oldValue:event.oldValue, newValue:event.newValue,
            local:event.storageArea === localStorage}));
        // Refreshing an existing page must not duplicate the listener either.
        AssemblyScope.refresh();
    }""")
    sibling.evaluate("localStorage.setItem('other-app-change', 'after-write')")
    sibling.evaluate("localStorage.setItem('ass26:same-key', 'after-write')")
    page.wait_for_function("received.length === 1")
    assert page.evaluate("received") == [{"key": "same-key", "oldValue": "updated", "newValue": "after-write", "local": True}]
    page.evaluate("localStorage.clear()")
    assert page.evaluate("localStorage.length") == 0
    assert sibling.evaluate("localStorage.getItem('sentinela-note')") == "keep"
    assert sibling.evaluate("localStorage.getItem('same-key')") == "sibling"
    assert sibling.evaluate("localStorage.getItem('other-app-change')") == "after-write"

    page.evaluate(OPEN_DB, "jwpub-iphone-library")
    assert page.evaluate("indexedDB instanceof IDBFactory")
    if page.evaluate("typeof indexedDB.databases === 'function'"):
        assert page.evaluate("indexedDB.databases().then(items => items.map(item => item.name))") == ["jwpub-iphone-library"]
        raw = sibling.evaluate("indexedDB.databases().then(items => items.map(item => item.name))")
        assert "jwpub-iphone-library" in raw and PREFIX + "jwpub-iphone-library" in raw
    page.evaluate(DELETE_DB, "jwpub-iphone-library")
    if sibling.evaluate("typeof indexedDB.databases === 'function'"):
        raw = sibling.evaluate("indexedDB.databases().then(items => items.map(item => item.name))")
        assert "jwpub-iphone-library" in raw and PREFIX + "jwpub-iphone-library" not in raw
    result = page.evaluate("""() => new Promise((resolve, reject) => {
        const worker = new Worker('/scope-worker.js');
        worker.onmessage = event => { worker.terminate(); resolve(event.data); };
        worker.onerror = reject;
    })""")
    assert result == {"name": PREFIX + "worker-check", "prefix": PREFIX}
    assert errors == [], errors
    context.close()


def check_migration(browser, origin):
    context = browser.new_context(service_workers="block")
    page = context.new_page()
    page.goto(origin + "/plain.html")
    page.evaluate("""() => {
        localStorage.setItem('richtext_cache_02-11', 'SENTINELA');
        localStorage.setItem('assembleia-2026:richtext_cache_02-11', 'NOTA ANTERIOR');
        localStorage.setItem('assembleia-2026:supabase_user', '{"id":"conta-existente"}');
        localStorage.setItem('assembleia-2026:2026-sex-0940', 'NOTA CONGRESSO');
        localStorage.setItem('assembleia-2026:asmb_recovery_2026_example', 'RECUPERACAO');
        localStorage.setItem('assembleia-2026:tamanho-fonte-global', '19.36');
        localStorage.setItem('ass26:tamanho-fonte-global', '30');
        sessionStorage.setItem('assembleia-2026:rascunho', 'SESSAO');
    }""")
    create = """({name,title,blob}) => new Promise((resolve,reject) => {
        const request=indexedDB.open(name,2);
        request.onupgradeneeded=()=>{
            const db=request.result, store=db.createObjectStore('publications',{keyPath:'id'});
            store.createIndex('title','title',{unique:true});
            store.put({id:'bible',title,blob:blob ? new Blob(['conteudo biblico']) : new TextEncoder().encode('conteudo biblico'),bytes:new Uint8Array([1,2,3])});
            db.createObjectStore('out-of-line').put({value:'marcador'},'position');
        };
        request.onsuccess=()=>{request.result.close();resolve();};
        request.onerror=()=>reject(request.error);
    })"""
    # This Linux WebKit build cannot seed native IDB Blob values (UnknownError:
    # Error preparing Blob/File data). Chromium covers Blob cloning; both cover
    # typed binary values, schema, indexes, transactions and concurrent workers.
    blob = browser.browser_type.name != 'webkit'
    page.evaluate(create, {"name":"assembleia-2026:jwpub-iphone-library", "title":"Bíblia importada", "blob":blob})
    page.evaluate(create, {"name":"assembleia-2026:existing-db", "title":"Versão antiga", "blob":blob})
    page.evaluate(create, {"name":"ass26:existing-db", "title":"Nova edição preservada", "blob":blob})
    page.goto(origin + "/scope.html")
    assert page.evaluate("localStorage.getItem('richtext_cache_02-11')") == "NOTA ANTERIOR"
    assert page.evaluate("localStorage.getItem('supabase_user')") == '{"id":"conta-existente"}'
    assert page.evaluate("localStorage.getItem('tamanho-fonte-global')") == '30'
    assert page.evaluate("localStorage.getItem('2026-sex-0940')") is None
    assert page.evaluate("localStorage.getItem('legacy-congresso:2026-sex-0940')") == "NOTA CONGRESSO"
    assert page.evaluate("localStorage.getItem('legacy-congresso:asmb_recovery_2026_example')") == "RECUPERACAO"
    assert page.evaluate("sessionStorage.getItem('rascunho')") == "SESSAO"
    result = page.evaluate("""async () => {
        const fromPage=new Promise((resolve,reject)=>{
            const request=indexedDB.open('jwpub-iphone-library',2);
            let upgraded=false;
            request.onupgradeneeded=()=>{upgraded=true;};
            request.onsuccess=async event=>{
                const db=request.result, tx=db.transaction(['publications','out-of-line']);
                const read=tx.objectStore('publications').index('title').get('Bíblia importada');
                const position=tx.objectStore('out-of-line').get('position');
                tx.oncomplete=async()=>{
                    db.close();resolve({name:db.name,title:read.result.title,
                        blob:read.result.blob instanceof Blob ? await read.result.blob.text() : new TextDecoder().decode(read.result.blob),bytes:Array.from(read.result.bytes),position:position.result.value,
                        upgraded,requestIdentity:request instanceof IDBOpenDBRequest,
                        targetIdentity:event.target===request,readyState:request.readyState});
                };
                tx.onerror=()=>reject(tx.error);
            };
            request.onerror=()=>reject(request.error);
        });
        const fromWorker=new Promise((resolve,reject)=>{
            const worker=new Worker('/migration-worker.js');
            worker.onmessage=event=>{worker.terminate();resolve(event.data);};
            worker.onerror=reject;worker.postMessage('jwpub-iphone-library');
        });
        return await Promise.all([fromPage,fromWorker]);
    }""")
    assert result[0] == {"name":"ass26:jwpub-iphone-library","title":"Bíblia importada","blob":"conteudo biblico","bytes":[1,2,3],"position":"marcador","upgraded":False,"requestIdentity":True,"targetIdentity":True,"readyState":"done"}, result
    assert result[1] == {"name":"ass26:jwpub-iphone-library","title":"Bíblia importada"}, result
    read_title="""name=>new Promise((resolve,reject)=>{
        const request=indexedDB.open(name,2);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('publications'),read=tx.objectStore('publications').get('bible');
            tx.oncomplete=()=>{db.close();resolve(read.result.title);};};
        request.onerror=()=>reject(request.error);
    })"""
    assert page.evaluate(read_title, 'existing-db') == 'Nova edição preservada'
    # New edits must win over the old backup on later launches.
    page.evaluate("localStorage.setItem('richtext_cache_02-11','EDITADA')")
    page.reload()
    assert page.evaluate("localStorage.getItem('richtext_cache_02-11')") == "EDITADA"
    page.evaluate("localStorage.clear();sessionStorage.clear()")
    page.evaluate(DELETE_DB, 'jwpub-iphone-library')
    page.reload()
    assert page.evaluate("Object.keys(localStorage)") == []
    assert page.evaluate("Object.keys(sessionStorage)") == []
    empty=page.evaluate("""()=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('jwpub-iphone-library',2);
        let oldVersion;
        request.onupgradeneeded=event=>{oldVersion=event.oldVersion;request.result.createObjectStore('fresh');};
        request.onsuccess=()=>{const db=request.result;resolve({oldVersion,stores:Array.from(db.objectStoreNames)});db.close();};
        request.onerror=()=>reject(request.error);
    })""")
    assert empty == {"oldVersion":0,"stores":["fresh"]}, empty
    # The originals, including a sibling app's keys, remain intact after deletion.
    page.goto(origin + "/plain.html")
    assert page.evaluate("localStorage.getItem('richtext_cache_02-11')") == "SENTINELA"
    assert page.evaluate("localStorage.getItem('assembleia-2026:richtext_cache_02-11')") == "NOTA ANTERIOR"
    assert page.evaluate(read_title, 'assembleia-2026:jwpub-iphone-library') == 'Bíblia importada'
    context.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            engines = [(playwright.chromium, os.environ.get("CHROMIUM_EXECUTABLE", "/usr/bin/chromium"))]
            webkit = os.environ.get("WEBKIT_EXECUTABLE")
            if webkit:
                engines.append((playwright.webkit, webkit))
            for engine, executable in engines:
                with engine.launch(executable_path=executable, headless=True) as browser:
                    check(browser, origin)
                    check_migration(browser, origin)
                    print(json.dumps({"browser": engine.name, "storage_isolation": "passed", "legacy_migration": "passed"}))
    finally:
        server.shutdown()
