/* An opt-in, on-device visual experiment. No telemetry or user-content access. */
(function initStatusbarDiagnostic() {
    'use strict';
    const VERSION = '2026.11.03.14';
    if (new URLSearchParams(location.search).get('diagnostico') !== 'statusbar') return;
    if (document.documentElement.dataset.statusbarDiagnosticLoader === 'error') return;
    if (window.StatusbarDiagnostic?.documentRoot === document.documentElement) return;
    const root = document.documentElement;
    const source = document.currentScript.src;
    const modes = [
        { id: 'baseline', title: '1 de 4 · Visual atual', help: 'Observe o topo da página. Pode rolar um pouco e voltar. A área do relógio e o cabeçalho estão sólidos ou desfocados?' },
        { id: 'pink', title: '2 de 4 · Faixa rosa', help: 'A faixa ficou rosa, mantendo sua altura. O rosa aparece ATRÁS DO RELÓGIO do iPhone ou somente como uma linha abaixo dele? Essa diferença é importante.' },
        { id: 'no-filters', title: '3 de 4 · Filtros desligados', help: 'Desligamos temporariamente os filtros CSS desta página. Observe se o desfoque superior desapareceu.' },
        { id: 'tall', title: '4 de 4 · Área sólida ampliada', help: 'Ampliamos temporariamente a faixa para 96 pixels. Observe se o desfoque desaparece ou continua sobre a área colorida. Este espaçamento não será salvo.' }
    ];
    const report = {
        type: 'sentinela-statusbar-diagnostic', schemaVersion: 1, diagnosticVersion: VERSION,
        snapshotEncoding: 'JSON Patch operations relative to baseline',
        startedAt: new Date().toISOString(), baseline: null, trials: [], lifecycle: [],
        limitation: 'O DOM não informa se a barra nativa do iOS está desfocada. As respostas visuais são fornecidas pela pessoa usando o aparelho.'
    };
    let disposed = false, busy = false, index = 0, panel, content, title, explanation, note, choices, output, collapse;
    let createdStrip, currentSnapshot, sequence = 0, nativeOverride;
    const originalTest = root.getAttribute('data-statusbar-test');
    let startScroll = { x: scrollX, y: scrollY };
    const isCurrent = () => !disposed && document.documentElement === root;
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const collector = new Promise((resolve, reject) => {
        if (window.StatusbarDiagnosticsData) return resolve(window.StatusbarDiagnosticsData);
        const script = document.createElement('script');
        let settled = false;
        const complete = error => {
            if (settled) return;
            settled = true; clearTimeout(timeout);
            script.onload = script.onerror = null;
            if (error) reject(error); else resolve(window.StatusbarDiagnosticsData);
        };
        const timeout = setTimeout(() => complete(new Error('A medição demorou para carregar. Tente novamente após verificar a atualização.')), 8000);
        script.src = new URL('statusbar-diagnostics-data.js', source).href;
        script.onload = () => complete(window.StatusbarDiagnosticsData ? null : new Error('Coletor indisponível.'));
        script.onerror = () => complete(new Error('Não foi possível carregar a medição.'));
        document.head.append(script);
    });
    // A fast network error can arrive before the initial layout settles.
    collector.catch(() => {});

    function compact(snapshot) {
        const operations = [];
        const pointer = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
        function compare(before, after, path) {
            if (JSON.stringify(before) === JSON.stringify(after)) return;
            const beforeObject = before !== null && typeof before === 'object';
            const afterObject = after !== null && typeof after === 'object';
            if (beforeObject && afterObject && Array.isArray(before) === Array.isArray(after) &&
                (!Array.isArray(before) || before.length === after.length)) {
                for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) operations.push({ op: 'remove', path: path + '/' + pointer(key) });
                for (const key of Object.keys(after)) {
                    const target = path + '/' + pointer(key);
                    if (!Object.hasOwn(before, key)) operations.push({ op: 'add', path: target, value: after[key] });
                    else compare(before[key], after[key], target);
                }
            } else operations.push({ op: 'replace', path, value: after });
        }
        compare(report.baseline, snapshot, '');
        return operations;
    }
    async function sample(mode) {
        const data = await collector;
        return data.collect({ mode, diagnosticVersion: VERSION });
    }
    function lifecycle(event) {
        if (!isCurrent() || report.lifecycle.length >= 30) return;
        report.lifecycle.push({ event: event.type, visibility: document.visibilityState,
            persisted: event.persisted === true, at: new Date().toISOString(), mode: modes[index]?.id || 'finished',
            scrollY, visualTop: window.visualViewport?.offsetTop ?? null, innerHeight });
    }
    function resetExperiment() {
        root.removeAttribute('data-statusbar-test');
        if (createdStrip) { createdStrip.remove(); createdStrip = null; }
        if (nativeOverride !== undefined) {
            if (nativeOverride === null) root.removeAttribute('data-native-statusbar');
            else root.setAttribute('data-native-statusbar', nativeOverride);
            nativeOverride = undefined;
        }
    }
    function restore() {
        resetExperiment();
        if (originalTest !== null) root.setAttribute('data-statusbar-test', originalTest);
    }
    function finish() {
        if (disposed) return;
        const currentDocument = document.documentElement === root;
        disposed = true;
        sequence++;
        restore();
        panel?.remove();
        document.removeEventListener('visibilitychange', lifecycle);
        window.removeEventListener('pageshow', lifecycle);
        window.removeEventListener('pagehide', onPageHide);
        if (!currentDocument) return;
        const url = new URL(location.href);
        url.searchParams.delete('diagnostico');
        history.replaceState(history.state, '', url);
        if (index < modes.length && modes[index].id === 'tall') window.scrollTo(startScroll.x, startScroll.y);
    }
    function onPageHide(event) {
        lifecycle(event);
        // Never leave an experimental surface in a page restored from BFCache.
        restore();
        if (event.persisted) finish();
    }
    function button(label, action, className = '') {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = label; element.className = className;
        element.addEventListener('click', action);
        return element;
    }
    function setBusy(value) {
        busy = value;
        choices.querySelectorAll('button').forEach(button => { button.disabled = value; });
    }
    function copyReport() {
        const data = { ...report, currentChanges: currentSnapshot ? compact(currentSnapshot) : null,
            currentMode: modes[index]?.id || 'finished', pending: busy && index < modes.length, exportedAt: new Date().toISOString() };
        const text = JSON.stringify(data);
        output.value = text;
        // Start clipboard access within the tap; collecting first can lose the
        // user activation required by Safari.
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                if (isCurrent()) note.textContent = 'Copiado. Cole o diagnóstico na nossa conversa.';
            }).catch(manualCopy);
        } else manualCopy();
        function manualCopy() {
            if (!isCurrent()) return;
            output.hidden = false; output.focus(); output.select();
            try {
                if (document.execCommand('copy')) { note.textContent = 'Copiado. Cole o diagnóstico na nossa conversa.'; return; }
            } catch (_) {}
            note.textContent = 'O relatório está selecionado abaixo. Use Copiar e cole na conversa.';
        }
    }
    function buildPanel() {
        if (!isCurrent()) return;
        panel = document.createElement('aside');
        panel.id = 'statusbar-diagnostic-panel';
        panel.setAttribute('aria-labelledby', 'statusbar-diagnostic-title');
        const heading = document.createElement('div'); heading.className = 'sd-heading';
        title = document.createElement('h2'); title.id = 'statusbar-diagnostic-title';
        collapse = button('Recolher', () => {
            const collapsed = panel.classList.toggle('sd-collapsed');
            collapse.textContent = collapsed ? 'Mostrar diagnóstico' : 'Recolher';
            collapse.setAttribute('aria-expanded', String(!collapsed));
        }, 'sd-quiet');
        collapse.setAttribute('aria-expanded', 'true');
        heading.append(title, collapse);
        content = document.createElement('div'); content.className = 'sd-content';
        explanation = document.createElement('p');
        choices = document.createElement('div'); choices.className = 'sd-actions';
        const toolbar = document.createElement('div'); toolbar.className = 'sd-actions sd-toolbar';
        toolbar.append(button('Copiar diagnóstico', copyReport), button('Sair e restaurar', finish, 'sd-quiet'));
        note = document.createElement('p'); note.className = 'sd-note'; note.setAttribute('role', 'status');
        output = document.createElement('textarea'); output.readOnly = true; output.hidden = true;
        output.setAttribute('aria-label', 'Relatório técnico para copiar');
        content.append(explanation, choices, toolbar, note, output);
        panel.append(heading, content); document.body.append(panel);
    }
    async function applyMode(next) {
        if (!isCurrent()) return;
        const request = ++sequence;
        resetExperiment(); index = next;
        currentSnapshot = null;
        if (next >= modes.length) {
            restore(); window.scrollTo(startScroll.x, startScroll.y);
            currentSnapshot = null;
            title.textContent = 'Diagnóstico concluído';
            explanation.textContent = 'O visual original foi restaurado. Copie o relatório e cole na conversa para comparar as medições com o que você viu.';
            choices.hidden = true;
            note.textContent = 'Nenhuma anotação foi lida ou alterada. Nenhum dado foi enviado automaticamente.';
            report.finishedAt = new Date().toISOString();
            return;
        }
        const mode = modes[next];
        title.textContent = mode.title; explanation.textContent = mode.help;
        renderChoices(mode.id);
        if (mode.id !== 'baseline') root.dataset.statusbarTest = mode.id;
        if (['pink', 'tall'].includes(mode.id) && root.dataset.nativeStatusbar !== 'solid') {
            nativeOverride = root.getAttribute('data-native-statusbar');
            root.dataset.nativeStatusbar = 'solid';
        }
        if (['pink', 'tall'].includes(mode.id) && !document.getElementById('app-solid-statusbar')) {
            createdStrip = document.createElement('div'); createdStrip.id = 'app-solid-statusbar';
            createdStrip.setAttribute('aria-hidden', 'true'); document.body.prepend(createdStrip);
            // No inference that the production strip was there: baseline records its absence.
        }
        setBusy(true); note.textContent = 'Preparando a comparação…';
        await wait(500);
        try {
            const snapshot = await sample(mode.id);
            if (!isCurrent() || request !== sequence) return;
            currentSnapshot = snapshot;
            note.textContent = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
                ? 'Teste temporário no app instalado. Observe o topo antes de responder.'
                : 'Este teste está no navegador. Para reproduzir o problema, use Salvar → Diagnóstico da barra superior dentro do app instalado.';
        } catch (error) {
            if (isCurrent()) note.textContent = 'Falha na medição: ' + error.message;
        } finally { if (isCurrent() && request === sequence) setBusy(false); }
    }
    function renderChoices(mode) {
        choices.replaceChildren();
        const options = mode === 'pink'
            ? [['Rosa atrás do relógio', 'pink-behind-clock'], ['Só uma linha abaixo', 'pink-page-only'], ['Não apareceu rosa', 'pink-not-visible'], ['Não sei', 'unsure']]
            : [['Está sólido', 'solid'], ['Continua desfocado', 'blurred'], ['Não sei / pular', 'unsure']];
        for (const [label, value] of options) choices.append(button(label, () => answer(value), options[0][1] === value ? 'sd-primary' : ''));
    }
    async function answer(observation) {
        if (busy || !isCurrent() || index >= modes.length) return;
        setBusy(true);
        const mode = modes[index].id;
        try {
            const snapshot = await sample(mode);
            if (!isCurrent()) return;
            report.trials.push({ mode, observation, at: new Date().toISOString(),
                temporaryStripCreated: !!createdStrip, nativeMarkerForced: nativeOverride !== undefined,
                snapshotChanges: compact(snapshot) });
        } catch (error) {
            if (!isCurrent()) return;
            report.trials.push({ mode, observation, measurementError: error.message });
        }
        if (isCurrent()) await applyMode(index + 1);
    }
    async function start() {
        await wait(400);
        try {
            // Capture the failing page before adding any diagnostic UI or styles.
            report.baseline = await sample('baseline-before-panel');
            if (!isCurrent()) return;
            startScroll = { x: scrollX, y: scrollY };
            currentSnapshot = report.baseline;
            buildPanel();
            title.textContent = modes[0].title; explanation.textContent = modes[0].help;
            renderChoices('baseline');
            note.textContent = 'Medição inicial concluída. O visual ainda não foi alterado.';
            document.addEventListener('visibilitychange', lifecycle);
            window.addEventListener('pageshow', lifecycle);
            window.addEventListener('pagehide', onPageHide);
        } catch (error) {
            if (!isCurrent()) return;
            report.measurementError = error.message;
            buildPanel(); title.textContent = 'Diagnóstico indisponível';
            explanation.textContent = error.message + ' Verifique a atualização e tente novamente.';
            choices.hidden = true;
        }
    }
    window.StatusbarDiagnostic = { documentRoot: root, close: finish, version: VERSION };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
