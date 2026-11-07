"""Assembly's current-week navigation and existing offline-study regression checks.

Run: python tests/test_current_study.py
Set WEBKIT_EXECUTABLE to additionally exercise WebKit.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/assembleia-2026/'
FIXTURE = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="/assembleia-2026/shared/app-scope.js"></script>
<link rel="stylesheet" href="/assembleia-2026/navbar/navbar-unified.css"></head>
<body><main><p>Navigation fixture</p></main>
<script src="/assembleia-2026/sentinela/artigos/article-runtime.js"></script>
<script src="/assembleia-2026/navbar/navbar-unified.js"></script></body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if urlsplit(self.path).path == PREFIX + 'current-study-fixture.html':
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path.startswith(PREFIX):
            self.path = '/' + self.path[len(PREFIX):]
        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass  # A navigation/context close can cancel a stylesheet response.


def clock_script(instant):
    return '''(() => {
        const NativeDate = Date;
        window.studyClock = NativeDate.parse(%s);
        window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [window.studyClock])); }
            static now() { return window.studyClock; }
        };
    })();''' % json.dumps(instant)


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    errors = []
    remote = []
    profiles = []

    def context_at(instant, timezone='UTC', fake_article=True):
        options = dict(viewport={'width': 430, 'height': 873},
                       timezone_id=timezone, service_workers='block')
        if engine.name == 'webkit' and not fake_article:
            # WPE's ephemeral contexts discard CacheStorage entries at navigation.
            # An installed PWA uses persistent storage, as does this cache fixture.
            profile = TemporaryDirectory(prefix='ass26-current-study-')
            profiles.append(profile)
            context = engine.launch_persistent_context(profile.name, executable_path=executable,
                                                       headless=True, **options)
        else:
            context = browser.new_context(**options)
        context.add_init_script(clock_script(instant))

        def route(request):
            if request.request.url.startswith(origin + '/'):
                return request.continue_()
            remote.append(request.request.url)
            return request.abort()

        context.route('**/*', route)
        if fake_article:
            context.route('**/sentinela/artigos/estudo.html?d=*',
                          lambda request: request.fulfill(status=200, content_type='text/html', body=FIXTURE))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(origin + PREFIX + 'current-study-fixture.html')
        page.wait_for_function('window.AssemblyCurrentStudy && document.querySelector(".bottom-navbar")')
        return context, page

    cases = [
        ('2026-11-07T15:00:00Z', 'UTC', '2026-11-02'),
        ('2026-11-08T23:59:59Z', 'UTC', '2026-11-02'),
        ('2026-11-09T00:00:00Z', 'UTC', '2026-11-09'),
        ('2027-01-01T12:00:00Z', 'UTC', '2026-12-28'),
        ('2024-01-01T00:01:00Z', 'UTC', '2024-01-01'),
        ('2026-11-09T00:15:00+14:00', 'Pacific/Kiritimati', '2026-11-09'),
        ('2026-11-08T23:15:00-08:00', 'America/Los_Angeles', '2026-11-02'),
        ('2026-03-08T23:59:00-04:00', 'America/New_York', '2026-03-02'),
        ('2026-03-09T00:01:00-04:00', 'America/New_York', '2026-03-09'),
        ('2026-11-01T23:59:00-05:00', 'America/New_York', '2026-10-26'),
    ]
    for instant, timezone, monday in cases:
        context, page = context_at(instant, timezone)
        page.evaluate('''() => {
            history.replaceState(null, '', '?semana=01-01');
            window.semanaAtual = '15-06';
            window.carousel = {getVisibleWeek: () => '20-07'};
        }''')
        expected = origin + PREFIX + 'sentinela/artigos/estudo.html?d=' + monday
        assert page.evaluate('AssemblyCurrentStudy.url()') == expected, (instant, timezone)
        page.locator('.navbar-item[data-page="watchtower"]').click()
        page.wait_for_url(expected)
        assert page.url == expected
        context.close()

    # Historical articles/references must not override the navbar's current week.
    for source in ['sentinela/artigos/estudo.html?d=2026-06-15',
                   'sentinela/artigos/estudo.html?d=2026-11-02',
                   'biblia/biblia.html?studyView=reference&from=article&returnTo=estudo.html%3Fd%3D2026-06-15']:
        context, page = context_at('2026-11-07T15:00:00Z')
        page.evaluate('''source => {
            history.replaceState(null, '', '/assembleia-2026/' + source);
            window.semanaAtual = '15-06';
            document.body.dataset.studyReferenceContext = 'article';
            document.addEventListener('sentinela:return-to-article', () => {
                throw new Error('Navbar returned to a historical study');
            });
        }''', source)
        page.locator('.navbar-item[data-page="watchtower"]').click()
        page.wait_for_url(origin + PREFIX + 'sentinela/artigos/estudo.html?d=2026-11-02')
        page.wait_for_function("document.body.dataset.studyReferenceContext !== 'article'")
        context.close()

    # A compatibility call from an old downloaded document cannot choose an old week.
    context, page = context_at('2026-11-07T15:00:00Z')
    page.evaluate("irParaSentinelaAcao('15-06')")
    page.wait_for_url(origin + PREFIX + 'sentinela/artigos/estudo.html?d=2026-11-02')
    context.close()

    # The same running PWA crosses midnight without reloading its controllers.
    context, page = context_at('2026-11-08T23:59:00Z')
    assert page.evaluate('AssemblyCurrentStudy.date()') == '2026-11-02'
    page.evaluate('''() => {
        studyClock = Date.parse('2026-11-09T00:01:00Z');
        window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
    }''')
    page.locator('.navbar-item[data-page="watchtower"]').click()
    page.wait_for_url(origin + PREFIX + 'sentinela/artigos/estudo.html?d=2026-11-09')
    context.close()

    # The programme's 14:05 shortcut is created before midnight but opened later.
    context, page = context_at('2026-11-08T23:59:00Z')
    page.goto(origin + PREFIX + 'index.html')
    page.wait_for_selector('.is-shortcut-note', state='attached')
    page.locator('#tab-tarde').click()
    page.locator('[data-note-id="ca-copgm27:atalho:sentinela"]').click()
    assert page.evaluate("document.querySelector('.is-shortcut-note').__specialConfig.url").endswith('d=2026-11-02')
    page.evaluate('''() => {
        window.semanaAtual = '15-06';
        studyClock = Date.parse('2026-11-09T00:01:00Z');
        window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
    }''')
    page.locator('.is-shortcut-note .expand-handle-asmb').click()
    page.wait_for_url(origin + PREFIX + 'sentinela/artigos/estudo.html?d=2026-11-09')
    context.close()

    # Exercise the actual cache-first fallback with a pre-existing downloaded study.
    context, page = context_at('2026-11-07T15:00:00Z', fake_article=False)
    context.add_init_script("Object.defineProperty(Navigator.prototype, 'onLine', {get: () => false});")
    cached = '''<!doctype html><html lang="pt-BR"><head><title>Downloaded study</title></head>
    <body data-estudo="02-11"><main><p class="paragrafo" id="saved-study">Saved study opened offline</p></main>
    <script src="../../navbar/navbar-unified.js"></script></body></html>'''
    page.evaluate('''async html => {
        const runtime = SentinelaArticleRuntime;
        const cache = await caches.open(runtime.CACHE_NAME);
        await cache.put(runtime.cacheKey('2026-11-02'), new Response(html, {
            headers: {'Content-Type': 'text/html; charset=utf-8'}
        }));
    }''', cached)
    requests_before = len(remote)
    page.locator('.navbar-item[data-page="watchtower"]').click()
    try:
        page.wait_for_selector('#saved-study')
    except Exception:
        print(json.dumps({'engine': engine.name, 'url': page.url, 'errors': errors,
                          'body': page.locator('body').inner_text(),
                          'cacheNames': page.evaluate('caches.keys()')}, ensure_ascii=False))
        raise
    assert page.locator('#saved-study').inner_text() == 'Saved study opened offline'
    assert page.evaluate('AssemblyScope.prefix') == 'ass26:'
    assert page.url == origin + PREFIX + 'sentinela/artigos/estudo.html?d=2026-11-02'
    assert not any('workers.dev' in url for url in remote[requests_before:]), remote[requests_before:]

    # Already reading the current article: retain the document and reading position.
    page.evaluate("window.studyDocumentMarker = 'preserved'")
    page.locator('.navbar-item[data-page="watchtower"]').click()
    assert page.evaluate('window.studyDocumentMarker') == 'preserved'

    # Missing offline weeks remain on the article route with a useful notice.
    page.goto(origin + PREFIX + 'current-study-fixture.html')
    page.evaluate("studyClock = Date.parse('2026-11-09T00:01:00Z')")
    page.locator('.navbar-item[data-page="watchtower"]').click()
    page.wait_for_selector('#retry-study')
    assert page.locator('.aviso h1').inner_text() == 'Estudo indisponível'
    assert 'ainda não está salvo neste aparelho' in page.locator('.aviso p').inner_text()
    assert '/sentinela/artigos/estudo.html?d=2026-11-09' in page.url
    assert page.locator('a[href*="estudos.html"]').count() == 0
    context.close()
    browser.close()
    for profile in profiles:
        profile.cleanup()
    assert not errors, errors
    return {'engine': engine.name, 'calendarCases': len(cases), 'historicalContext': True,
            'resumeAtMidnight': True, 'programmeShortcutAtMidnight': True, 'existingOfflineStudy': True,
            'unavailableStudyNotice': True, 'errors': errors}


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            results = [check(playwright.chromium, '/usr/bin/chromium', origin)]
            if os.environ.get('WEBKIT_EXECUTABLE'):
                results.append(check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin))
            print(json.dumps(results, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
