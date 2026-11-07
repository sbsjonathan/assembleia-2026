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
PREFIX = "assembleia-2026:"


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
    assert sibling.evaluate("localStorage.getItem('assembleia-2026:same-key')") == "assembly"
    assert page.evaluate("localStorage instanceof Storage")

    # The app receives its own logical keys and its public Storage identity.
    page.evaluate("""() => {
        window.received = [];
        addEventListener('storage', event => received.push({key:event.key,
            oldValue:event.oldValue, newValue:event.newValue,
            local:event.storageArea === localStorage}));
    }""")
    sibling.evaluate("localStorage.setItem('other-app-change', 'ignore')")
    sibling.evaluate("localStorage.setItem('assembleia-2026:same-key', 'updated')")
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
    sibling.evaluate("localStorage.setItem('assembleia-2026:same-key', 'after-write')")
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
                    print(json.dumps({"browser": engine.name, "storage_isolation": "passed"}))
    finally:
        server.shutdown()
