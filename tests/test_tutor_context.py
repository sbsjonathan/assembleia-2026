"""Tutor source isolation on the worker/clickable DOM, with no live AI calls.

Run: python tests/test_tutor_context.py
Set WEBKIT_EXECUTABLE to also exercise WebKit.
"""
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MODULE = '/sentinela/clickable/agente-modal/agente-contexto.js'
# This is the worker's source structure after clickable.js groups each question.
# A raw figure interrupts its legacy data-question-id assignment in group 3–5.
FIXTURE = '''<!doctype html><html><head><meta charset="utf-8"><title>A Sentinela</title>
<script id="sentinela-reading-position" data-study-date="2026-11-02"></script></head>
<body data-estudo="02-11"><div class="container" data-hope4-article="2026530">
<header class="barra-estudo"><div>2 A 8 DE NOVEMBRO DE 2026</div></header><main>
<h1 class="estudo-titulo">Confie em Jeová e seja protegido</h1>
<div id="ia-2026530-1"><div><p class="pergunta" id="p-2026530-1"><span>1.</span> Qual é a esperança?</p></div>
<div class="anotacao"><div class="ia-wrapper"><div class="clickable">PRIVATE_AI_RESPONSE</div></div></div>
<div class="comentarios" contenteditable="true">PRIVATE_USER_NOTE
<p class="paragrafo"><span>1</span> PRIVATE_FAKE_PARAGRAPH</p>
<figure><img src="/private.png"><figcaption>Veja o parágrafo 1.</figcaption></figure></div>
<p class="paragrafo" data-question-id="p-2026530-1"><span>1</span> PRIMEIRO: A <em>esperança</em> traz <span>confiança</span>. (<a class="bbl"><strong>Sal. 91:9</strong></a>)
<span class="comentarios">PRIVATE_INLINE</span><button>PRIVATE_CONTROL</button></p></div>
<figure><img src="/one.png" alt="Fonte do primeiro parágrafo"><figcaption>Confiança (Veja o parágrafo 1.)</figcaption></figure>
<div id="ia-2026530-2"><div><p class="pergunta" id="p-2026530-2"><span>2.</span> Como agir?</p></div>
<p class="paragrafo" data-question-id="p-2026530-2"><span>2</span> SEGUNDO: Podemos agir com bondade.</p></div>
<div id="ia-2026530-3-5"><div><p class="pergunta" id="p-2026530-3-5"><span>3–5.</span> Que exemplos ensinam? (<a class="bbl">Prov. 16:20</a>)</p></div>
<p class="paragrafo" data-question-id="p-2026530-3-5"><span>3</span> TERCEIRO: O primeiro exemplo.</p></div>
<figure><img src="/range.png" alt="Três exemplos"><figcaption>Exemplos (Veja os parágrafos 3–5.)</figcaption></figure>
<p class="paragrafo"><span>4</span> QUARTO: O segundo exemplo com <strong><em>ênfase</em></strong>.</p>
<p class="paragrafo"><span>5</span> QUINTO: O terceiro exemplo.</p>
<div><p class="pergunta" id="p-2026530-10"><span>10.</span> O que aprendemos?</p></div>
<p class="paragrafo" data-question-id="p-2026530-10"><span>10</span> DÉCIMO: Outro assunto.</p>
<figure><img src="/ten.png"><figcaption>Outra imagem (Veja o parágrafo 10.)</figcaption></figure>
</main></div></body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith('/slow-image'):
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', '3')
            self.end_headers()
            self.wfile.flush()
            time.sleep(0.3)
            try:
                self.wfile.write(bytes([1, 2, 3]))
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected when the tested image request is cancelled.
            return
        if self.path.startswith('/tutor-fixture.html'):
            data = FIXTURE.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    page = browser.new_page(service_workers='block')
    page.route('**/*', lambda route: route.continue_()
               if route.request.url.startswith(origin + '/') and not route.request.url.endswith('.png')
               else route.abort())
    page.goto(origin + '/tutor-fixture.html?d=2026-11-02&token=PRIVATE_TOKEN')
    page.evaluate('''async path => {
        window.tutorContext = await import(path);
        window.readContext = number => tutorContext.buildContext(document.querySelector('#p-2026530-' + number + ' > span'));
    }''', MODULE)

    one = page.evaluate("readContext('1')")
    two = page.evaluate("readContext('2')")
    group = page.evaluate("readContext('3-5')")
    ten = page.evaluate("readContext('10')")
    assert all(context['ready'] for context in [one, two, group, ten])
    assert one['title'] == 'Parágrafo 1'
    assert [p['number'] for p in one['paragraphs']] == [1]
    assert one['paragraphs'][0]['text'] == 'PRIMEIRO: A esperança traz confiança. (Sal. 91:9)'
    assert [p['number'] for p in two['paragraphs']] == [2]
    assert group['title'] == 'Parágrafos 3–5'
    assert [p['number'] for p in group['paragraphs']] == [3, 4, 5]
    assert 'ênfase' in group['paragraphs'][1]['text']
    assert 'Prov. 16:20' in group['question']
    assert len({context['id'] for context in [one, two, group, ten]}) == 4
    assert [image['src'] for image in one['images']] == [origin + '/one.png']
    assert [image['src'] for image in ten['images']] == [origin + '/ten.png']
    assert [image['src'] for image in group['images']] == [origin + '/range.png']
    assert 'PRIVATE_' not in json.dumps([one, two, group, ten])
    assert 'SEGUNDO' not in json.dumps(one) and 'DÉCIMO' not in json.dumps(one, ensure_ascii=False)
    # Extraction does not edit the page or destroy the user's annotations.
    assert page.locator('.comentarios').first.inner_text().startswith('PRIVATE_USER_NOTE')
    assert page.locator('.paragrafo em').count() == 2

    prompt = page.evaluate('''() => {
        const one = readContext('1'), two = readContext('2');
        return tutorContext.buildPrompt({context: one, question: 'Como aplicar?', messages: [
            {role:'user', text:'Conversa deste trecho', contextId:one.id},
            {role:'assistant', text:'Conversa de outro trecho', contextId:two.id}
        ]});
    }''')
    assert 'Conversa deste trecho' in prompt
    assert 'Conversa de outro trecho' not in prompt
    assert 'PRIMEIRO' in prompt and 'SEGUNDO' not in prompt and 'PRIVATE_' not in prompt
    assert 'Fora do contexto deste parágrafo/trecho' in prompt
    assert 'outro parágrafo' in prompt
    assert 'somente a pergunta do estudo e os parágrafos selecionados' in prompt

    # Every source identity dimension must isolate another study, even on the
    # same reusable estudo.html URL and with repeated paragraph/question labels.
    identities = page.evaluate('''() => {
        const initial = readContext('1').id;
        const container = document.querySelector('[data-hope4-article]');
        container.dataset.hope4Article = '2026531';
        const article = readContext('1').id;
        container.dataset.hope4Article = '2026530';
        const marker = document.querySelector('#sentinela-reading-position');
        marker.dataset.studyDate = '2027-11-02';
        const date = readContext('1').id;
        marker.dataset.studyDate = '2026-11-02';
        document.querySelector('h1').textContent = 'Outro estudo';
        const title = readContext('1').id;
        document.querySelector('h1').textContent = 'Confie em Jeová e seja protegido';
        history.replaceState(null, '', '?d=2026-11-02&token=DIFFERENT_PRIVATE_TOKEN#v1');
        return {initial, article, date, title, restored:readContext('1').id};
    }''')
    assert len({identities[key] for key in ['initial', 'article', 'date', 'title']}) == 4
    assert identities['restored'] == identities['initial']
    unavailable = page.evaluate('''() => {
        const first = document.querySelector('.paragrafo[data-question-id="p-2026530-1"]');
        const second = document.querySelector('.paragrafo[data-question-id="p-2026530-2"]');
        first.dataset.questionId = 'missing'; second.dataset.questionId = 'missing';
        const one = readContext('1'), two = readContext('2');
        first.dataset.questionId = 'p-2026530-1'; second.dataset.questionId = 'p-2026530-2';
        return {one, two};
    }''')
    assert not unavailable['one']['ready'] and not unavailable['two']['ready']
    assert unavailable['one']['id'] == one['id']
    assert unavailable['two']['id'] == two['id']
    assert unavailable['one']['id'] != unavailable['two']['id']

    # Normalize punctuation to the same identity without matching 1 to 10.
    for label in ['3-5.', '3 – 5.', '3—5.', '3, 4 e 5.']:
        value = page.evaluate('''label => {
            document.querySelector('#p-2026530-3-5 > span').textContent = label;
            return readContext('3-5');
        }''', label)
        assert value['id'] == group['id'] and value['numbers'] == [3, 4, 5]

    # Missing, conflicting, duplicated and malformed context fails closed.
    for mutation in [
        "document.querySelector('#p-2026530-1').nextElementSibling?.remove(); document.querySelector('.paragrafo[data-question-id=\"p-2026530-1\"]').remove();",
        "document.querySelector('.paragrafo[data-question-id=\"p-2026530-1\"]').dataset.questionId='p-2026530-10';",
        "const p=document.querySelector('.paragrafo[data-question-id=\"p-2026530-1\"]'); p.after(p.cloneNode(true));",
        "document.querySelector('#p-2026530-1 > span').textContent='1 ou todos';",
    ]:
        result = page.evaluate('''mutation => {
            const backup = document.body.innerHTML;
            new Function(mutation)();
            const context = readContext('1');
            let rejected = false;
            try { tutorContext.buildPrompt({context, question:'teste'}); } catch (_) { rejected = true; }
            document.body.innerHTML = backup;
            return {context, rejected};
        }''', mutation)
        assert not result['context']['ready'] and result['rejected']
        assert result['context']['paragraphs'] == []

    # Actual attachment builder is tested with local synthetic responses only.
    attachments = page.evaluate('''async () => {
        const context = readContext('1');
        const nativeFetch = window.fetch;
        const requests = [];
        window.fetch = async (url, options) => {
            requests.push({url, credentials: options.credentials});
            return new Response(new Uint8Array([1,2,3]), {headers:{'Content-Type':'image/png'}});
        };
        const noImages = await tutorContext.collectImageParts(context, 'Explique o texto');
        const images = await tutorContext.collectImageParts(context, 'Explique a imagem');
        context.images.push(...Array.from({length:5}, (_, i) => ({src:'/extra-' + i + '.png'})));
        const limited = await tutorContext.collectImageParts(context, 'Explique a foto');
        window.fetch = async () => new Response(new Uint8Array(3), {headers:{'Content-Type':'image/png','Content-Length':String(5 * 1024 * 1024)}});
        const large = await tutorContext.collectImageParts(context, 'Explique a imagem');
        window.fetch = async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), {headers:{'Content-Type':'image/png'}});
        const largeChunked = await tutorContext.collectImageParts(context, 'Explique a imagem');
        window.fetch = async () => new Response('not an image', {headers:{'Content-Type':'text/html'}});
        const wrongType = await tutorContext.collectImageParts(context, 'Explique a imagem');
        window.fetch = async () => { throw new TypeError('Network failed'); };
        const inaccessible = await tutorContext.collectImageParts(context, 'Explique a imagem');
        const controller = new AbortController(); controller.abort();
        let aborted = false;
        try { await tutorContext.collectImageParts(context, 'Explique a imagem', controller.signal); }
        catch (error) { aborted = error.name === 'AbortError'; }
        window.fetch = nativeFetch;
        return {noImages, images, limited, large, largeChunked, wrongType, inaccessible, aborted, requests};
    }''')
    assert attachments['noImages'] == []
    assert attachments['images'] == [{'inlineData': {'mimeType': 'image/png', 'data': 'AQID'}}]
    assert len(attachments['limited']) == 2
    assert attachments['large'] == attachments['largeChunked'] == attachments['wrongType'] == attachments['inaccessible'] == []
    assert attachments['aborted']
    assert len(attachments['requests']) == 3
    assert all(request['credentials'] == 'omit' for request in attachments['requests'])
    boundaries = page.evaluate('''async () => {
        const context = readContext('1');
        context.images = [{src:'/slow-image?external'}];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25);
        let aborted = false;
        try { await tutorContext.collectImageParts(context, 'Explique a imagem', controller.signal); }
        catch (error) { aborted = error.name === 'AbortError'; }
        clearTimeout(timer);
        // Use the real slow local HTTP response, accelerating only the module's
        // 10-second deadline so this boundary check does not take 10 seconds.
        const nativeTimeout = window.setTimeout;
        window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 10000 ? 25 : delay, ...args);
        context.images = [{src:'/slow-image?deadline'}];
        const timeoutParts = await tutorContext.collectImageParts(context, 'Explique a imagem');
        window.setTimeout = nativeTimeout;
        return {aborted, timeoutParts};
    }''')
    assert boundaries == {'aborted': True, 'timeoutParts': []}
    browser.close()
    return {'engine': engine.name, 'sourceScopes': [1, 2, '3–5', 10], 'privacy': 'passed', 'images': 'bounded and scoped', 'missingContext': 'rejected'}


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        origin = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as playwright:
            results = [check(playwright.chromium, os.getenv('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'), origin)]
            if os.getenv('WEBKIT_EXECUTABLE'):
                results.append(check(playwright.webkit, os.environ['WEBKIT_EXECUTABLE'], origin))
        print(json.dumps(results, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
