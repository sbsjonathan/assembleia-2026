"""Programme -> full editor -> summary, failure recovery and native Back checks.

Run python tests/test_program_summary.py; WEBKIT_EXECUTABLE adds WebKit.
Only synthetic notes and a local fixture service are used.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NOTE = 'ca-copgm27:nota:confiar-de-todo-coracao'
TEXT = 'Confiar em Jeová envolve buscar a orientação dele antes de decidir. A oração e a leitura da Bíblia ajudam a aplicar seus conselhos todos os dias.'
SUMMARY = 'Confiar em Jeová envolve buscar e aplicar sua orientação.'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass


def check(engine, executable, origin):
    browser = engine.launch(executable_path=executable, headless=True,
                            args=['--no-sandbox'] if engine.name == 'chromium' else [])
    context = browser.new_context(viewport={'width': 430, 'height': 873},
                                  is_mobile=True, has_touch=True, service_workers='block')
    context.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true});")
    context.add_init_script("""(() => {
        const NativeDate=Date, started=NativeDate.now(), afternoon=new NativeDate('2026-11-07T15:19:00').getTime();
        window.Date=class extends NativeDate {
            constructor(...args){super(...(args.length?args:[afternoon+NativeDate.now()-started]));}
            static now(){return afternoon+NativeDate.now()-started;}
        };
    })();""")
    context.add_init_script('window.ASSEMBLEIA_IA_CONFIG=' + json.dumps({
        'workerUrl': origin + '/summary-test', 'timeoutMs': 10000
    }))
    service = {'mode': 'success', 'requests': [], 'held': []}

    def route(request):
        if request.request.url == origin + '/summary-test':
            body = request.request.post_data_json
            service['requests'].append(body)
            assert body['prompt'] and body['models'] and body['isJson'] is False
            assert body['generationConfig']['maxOutputTokens'] > 0
            if service['mode'] == 'held':
                service['held'].append(request)
            elif service['mode'] == 'error':
                request.fulfill(status=503, content_type='application/json', body='{"error":"Synthetic temporary failure"}')
            else:
                request.fulfill(status=200, content_type='application/json',
                                body=json.dumps({'text': SUMMARY, 'model': 'fixture-summary'}))
        elif request.request.url.startswith(origin + '/'):
            request.continue_()
        else:
            request.abort()

    context.route('**/*', route)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_default_timeout(12000)
    page.goto(origin + '/index.html')
    page.wait_for_function("document.querySelectorAll('.clickable-asmb').length===17")
    assert page.locator('#tab-tarde').get_attribute('aria-selected') == 'true'
    page.locator('#tab-manha').click()
    trigger = page.locator('[data-note-id="' + NOTE + '"]')
    note = page.locator('[data-note-id="' + NOTE + '"] + .anotacao-asmb')
    inline = note.locator('.clickable-asmb')

    def record():
        return page.evaluate('(id)=>AssembleiaIA.readRecord(id)', NOTE)

    def open_full():
        if not inline.is_visible():
            trigger.click(position={'x': 4, 'y': 4})
        page.wait_for_timeout(300)
        # Plain notes reveal their handle on focus; summaries keep it visible.
        if note.locator('.expand-handle-asmb').evaluate('(el)=>getComputedStyle(el).pointerEvents==="none"'):
            inline.tap()
        note.locator('.expand-handle-asmb').tap()
        page.wait_for_url('**/fullsc.html?*')
        page.wait_for_selector('#editor .editable')

    def wait_inline(status):
        page.wait_for_url('**/index.html*')
        page.wait_for_function('({id,status})=>window.AssembleiaIA && AssembleiaIA.readRecord(id).status===status',
                               arg={'id': NOTE, 'status': status})
        page.wait_for_function('(id)=>document.querySelector(`[data-id="${id}"]`)?.closest(".anotacao-asmb")?.classList.contains("ativa")', arg=NOTE)
        page.wait_for_timeout(300)
        assert inline.is_visible() and note.get_attribute('class').find('ativa') >= 0
        if status == 'summarized':
            page.wait_for_function('(id)=>document.querySelector(`[data-id="${id}"]`)?.classList.contains("is-summary")', arg=NOTE)
            assert inline.inner_text() == SUMMARY, {'visible': inline.inner_text(), 'html': inline.inner_html(), 'record': record()}
            assert inline.get_attribute('contenteditable') == 'false'
        return record()

    # Real touch handle while the old inline editor still owns the native focus.
    trigger.click(position={'x': 4, 'y': 4})
    page.wait_for_timeout(300)
    inline.fill('Rascunho inicial que será ampliado.')
    page.evaluate('''() => window.addEventListener('pagehide', () => {
        sessionStorage.setItem('qa-inline-focused-at-exit', String(!!document.activeElement?.closest?.('.clickable-asmb')));
    }, {once:true})''')
    open_full()
    assert page.evaluate('sessionStorage.getItem("qa-inline-focused-at-exit")') == 'false'
    page.locator('#editor .editable').first.fill(TEXT)
    page.locator('#fullscBack').click()
    saved = wait_inline('summarized')
    assert saved['fullText'] == TEXT and TEXT in saved['fullHtml']
    assert saved['lastAgentText'] == TEXT and saved['hasSummary']
    assert len(service['requests']) == 1
    assert service['requests'][0]['prompt'] == TEXT
    # Focusing another control after returning must never flush the old draft.
    page.locator('#tab-manha').focus()
    page.wait_for_timeout(300)
    assert record()['fullText'] == TEXT and record()['hasSummary']
    open_full()
    assert TEXT in page.locator('#editor').inner_text()
    page.locator('#fullscBack').click()
    wait_inline('summarized')
    assert len(service['requests']) == 1, 'Unchanged successful notes reuse their summary'

    # A failed summary must be retryable even if a legacy record incorrectly
    # stored the failed text as the successful comparison baseline.
    open_full()
    failure_text = TEXT + ' O discurso mostrou exemplos de paciência e perseverança em situações difíceis.'
    page.locator('#editor .editable').first.fill(failure_text)
    service['mode'] = 'error'
    page.locator('#fullscBack').click()
    failed = wait_inline('error_api')
    assert failed['fullText'] == failure_text and not failed['hasSummary']
    assert failed['lastAgentText'] == TEXT
    page.evaluate('''id=>{const r=AssembleiaIA.readRecord(id);r.lastAgentText=r.fullText;AssembleiaIA.writeRecord(id,r);}''', NOTE)
    open_full()
    service['mode'] = 'success'
    page.locator('#fullscBack').click()
    retried = wait_inline('summarized')
    assert retried['fullText'] == failure_text and retried['hasSummary']
    assert len(service['requests']) == 3

    # Browser Back/iPhone history gesture must enqueue just like the close button.
    open_full()
    history_text = TEXT + ' A aplicação pessoal inclui pensar nas consequências antes de fazer escolhas.'
    page.locator('#editor .editable').first.fill(history_text)
    page.go_back(wait_until='domcontentloaded')
    saved = wait_inline('summarized')
    assert saved['fullText'] == history_text and saved['hasSummary']
    assert len(service['requests']) == 4

    # Restoring full-screen through Forward must re-enable persistence/close.
    page.go_forward(wait_until='domcontentloaded')
    page.wait_for_selector('#editor .editable')
    forward_text = TEXT + ' Há valor em ouvir os conselhos da Bíblia e praticá-los em família.'
    page.locator('#editor .editable').first.fill(forward_text)
    page.locator('#fullscBack').click()
    assert wait_inline('summarized')['fullText'] == forward_text
    assert len(service['requests']) == 5

    # Short notes are transcribed, not sent to the service, and rich collapsed
    # branches/mixed root text are all included in summary extraction.
    open_full()
    page.locator('#editor .editable').first.fill('Fé.')
    page.locator('#fullscBack').click()
    assert wait_inline('idle')['fullText'] == 'Fé.'
    assert inline.inner_text() == 'Fé.' and len(service['requests']) == 5

    # The full-screen return must not call the service at/below 50 characters,
    # including when a previously summarized note is shortened again.
    expected_requests = len(service['requests'])
    for length, summarize in [(49, False), (50, False), (51, True), (50, False)]:
        text = 'Anotação de teste: ' + 'a' * (length - len('Anotação de teste: '))
        open_full()
        page.locator('#editor .editable').first.fill(text)
        page.locator('#fullscBack').click()
        saved = wait_inline('summarized' if summarize else 'idle')
        assert saved['fullText'] == text and len(saved['fullText']) == length
        expected_requests += int(summarize)
        assert len(service['requests']) == expected_requests, (length, service['requests'])
        if not summarize:
            assert not saved['hasSummary'] and inline.inner_text() == text
    extracted = page.evaluate('''()=>{
        const html='Antes <b>negrito</b> e depois<div class="node-toggle"><button class="toggle-arrow">▶</button><span class="toggle-title">Fé</span><div class="children" hidden><div class="node-paragraph"><span class="paragraph-content">Conteúdo recolhido completo.</span></div><div class="node-toggle"><span class="toggle-title">Filho</span><div class="children" hidden>Outra lição.</div></div></div></div><button class="text-plus">+</button>';
        return AssembleiaIA.htmlToText(html);
    }''')
    for text in ['Antes negrito e depois', 'Fé', 'Conteúdo recolhido completo.', 'Filho', 'Outra lição.']:
        assert extracted.count(text) == 1, extracted
    assert '▶' not in extracted and '+' not in extracted

    # An older request cannot replace a newer full-text revision or stop its job.
    service['mode'] = 'held'
    page.evaluate('''()=>{
        const id='ca-copgm27:qa:summary-race';
        window.qaFirstText='Primeira versão de uma anotação longa para resumo, com detalhes suficientes.';
        window.qaSecondText='Segunda versão completamente diferente, com novos detalhes importantes.';
        AssembleiaIA.queueSummaryFromFull(id,qaFirstText);
        window.qaFirstJob=AssembleiaIA.processPendingSummary(id);
    }''')
    page.wait_for_timeout(100)
    assert len(service['held']) == 1
    page.evaluate('''()=>{
        const id='ca-copgm27:qa:summary-race';
        AssembleiaIA.saveFullDraft(id,qaSecondText);
        AssembleiaIA.queueSummaryFromFull(id,qaSecondText);
        window.qaSecondJob=AssembleiaIA.processPendingSummary(id);
    }''')
    page.wait_for_timeout(100)
    assert len(service['held']) == 2
    service['held'][0].fulfill(status=200, content_type='application/json', body='{"text":"Old response"}')
    page.evaluate('qaFirstJob')
    state = page.evaluate("AssembleiaIA.readRecord('ca-copgm27:qa:summary-race')")
    assert state['status'] == 'pending' and not state['hasSummary'] and state['fullText'].startswith('Segunda')
    service['held'][1].fulfill(status=200, content_type='application/json', body='{"text":"New response"}')
    page.evaluate('qaSecondJob')
    state = page.evaluate("AssembleiaIA.readRecord('ca-copgm27:qa:summary-race')")
    assert state['summaryText'] == 'New response' and state['fullText'].startswith('Segunda')

    # Returning from Questions overrides the current afternoon only once. A
    # normal new opening must still follow the current programme marker.
    service['mode'] = 'success'
    page.locator('#tab-perguntas').click()
    question_id = 'ca-copgm27:pergunta:confiar-de-todo-coracao'
    question_trigger = page.locator('[data-note-id="' + question_id + '"]')
    question_note = page.locator('[data-note-id="' + question_id + '"] + .anotacao-asmb')
    question_trigger.click(position={'x': 4, 'y': 4})
    page.wait_for_timeout(300)
    question_note.locator('.clickable-asmb').click()
    question_note.locator('.expand-handle-asmb').tap()
    page.wait_for_url('**/fullsc.html?*')
    page.locator('#editor .editable').first.fill(TEXT)
    page.locator('#fullscBack').click()
    page.wait_for_url('**/index.html*')
    page.wait_for_function('(id)=>window.AssembleiaIA?.readRecord(id).hasSummary', arg=question_id)
    page.wait_for_timeout(300)
    assert page.locator('#tab-perguntas').get_attribute('aria-selected') == 'true'
    assert 'ativa' in question_note.get_attribute('class')
    assert question_note.locator('.clickable-asmb').inner_text() == SUMMARY
    assert page.evaluate('sessionStorage.getItem("assembleia-fullsc-return")') is None
    page.goto(origin + '/index.html')
    page.wait_for_function('window.AssemblyProgram?.activeTab()==="tarde"')
    assert page.locator('#tab-tarde').get_attribute('aria-selected') == 'true'
    assert not errors, errors
    browser.close()
    return {'engine': engine.name, 'touchHandoff': True, 'fullTextPreserved': True,
            'summaryDisplayed': True, 'unchangedSuccessReused': True, 'failedRequestRetried': True,
            'nativeHistoryExit': True, 'forwardRestore': True, 'shortTranscription': True, 'summaryThreshold50': True,
            'collapsedAndMixedText': True, 'staleResponseIgnored': True, 'oneShotTabReturn': True, 'errors': errors}


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
