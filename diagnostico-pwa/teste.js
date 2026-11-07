(function initInstallationComparison() {
    'use strict';
    const VERSION = '2026.11.03.14';
    const phaseParameter = new URLSearchParams(location.search).get('instalacao');
    const phase = ['atual', 'teste'].includes(phaseParameter) ? phaseParameter : 'nao-informada';
    const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const byId = id => document.getElementById(id);
    const solidButton = byId('solid-button');
    const blurredButton = byId('blurred-button');
    const copyReportButton = byId('copy-report');
    const reportStatus = byId('report-status');
    const reportOutput = byId('report-output');
    let preparedReport = '';

    byId('browser-warning').hidden = standalone;
    byId('return-link').hidden = phase !== 'atual';
    byId('phase-label').textContent = phase === 'atual'
        ? 'Comparação pelo ícone atual'
        : phase === 'teste' ? 'Comparação pelo ícone de teste' : 'Comparação da barra superior';

    // The copied link never carries arbitrary query parameters or a fragment.
    // Both launch paths use the same document and manifest; only this label differs.
    const testURL = new URL('./index.html', location.href);
    testURL.search = '?instalacao=teste';
    testURL.hash = '';
    byId('test-url').value = testURL.href;

    function compactElement(element) {
        if (!element) return null;
        const styleKeys = ['position', 'paddingTop', 'paddingBottom', 'backgroundColor',
            'backgroundImage', 'opacity', 'zIndex', 'overflow', 'filter',
            'backdropFilter', 'webkitBackdropFilter', 'transform'];
        return {
            rect: element.rect,
            style: Object.fromEntries(styleKeys.map(key => [key, element.style[key]])),
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight
        };
    }

    async function recordObservation(result) {
        solidButton.disabled = true;
        blurredButton.disabled = true;
        copyReportButton.disabled = true;
        preparedReport = '';
        reportOutput.value = '';
        byId('report-details').hidden = true;
        reportStatus.textContent = 'Preparando relatório…';
        try {
            if (!window.StatusbarDiagnosticsData?.collect) throw new Error('Collector unavailable');
            const snapshot = await window.StatusbarDiagnosticsData.collect({
                mode: 'installation-comparison', diagnosticVersion: VERSION
            });
            const report = {
                type: 'sentinela-pwa-installation-comparison',
                version: VERSION,
                phase,
                // This is the phase declared by the link, not proof of which icon launched it.
                phaseSource: 'url-parameter',
                visualResult: result,
                standalone,
                collectedAt: snapshot.collectedAt,
                device: snapshot.device,
                viewport: snapshot.viewport,
                safeAreas: snapshot.safeAreas,
                units: snapshot.units,
                elements: {
                    root: compactElement(snapshot.elements.root),
                    body: compactElement(snapshot.elements.body),
                    header: compactElement(snapshot.elements.bibleHeader),
                    strip: compactElement(snapshot.elements.strip)
                },
                headerTextRectangles: snapshot.headerTextRectangles.bibleHeader,
                meta: snapshot.document.meta,
                errors: snapshot.errors,
                limitation: 'native-blur-not-observable-from-dom'
            };
            preparedReport = JSON.stringify(report, null, 2);
            reportOutput.value = preparedReport;
            byId('report-details').hidden = false;
            copyReportButton.disabled = false;
            reportStatus.textContent = standalone
                ? 'Relatório pronto. Toque em Copiar relatório e cole na conversa.'
                : 'Relatório pronto, mas esta medição é do navegador. A comparação precisa ser feita pelo ícone da tela de início.';
        } catch (_) {
            reportStatus.textContent = 'Não foi possível preparar o relatório. Reabra esta página com internet e tente novamente.';
        } finally {
            solidButton.disabled = false;
            blurredButton.disabled = false;
        }
    }

    function selectForManualCopy(field, feedback) {
        if (field === reportOutput) byId('report-details').open = true;
        field.focus();
        field.select();
        field.setSelectionRange(0, field.value.length);
        feedback.textContent = 'O texto está selecionado. Toque em Copiar no menu do iPhone.';
    }

    function copyPreparedText(text, field, feedback, success) {
        if (!text) return;
        // Start clipboard access directly during this tap. Measuring first would
        // lose the iPhone's user activation while awaiting the collector.
        if (navigator.clipboard?.writeText) {
            try {
                navigator.clipboard.writeText(text).then(() => {
                    feedback.textContent = success;
                }, () => selectForManualCopy(field, feedback));
            } catch (_) { selectForManualCopy(field, feedback); }
        } else { selectForManualCopy(field, feedback); }
    }

    solidButton.addEventListener('click', () => recordObservation('solido'));
    blurredButton.addEventListener('click', () => recordObservation('desfocado'));
    copyReportButton.addEventListener('click', () => {
        copyPreparedText(preparedReport, reportOutput, reportStatus, 'Relatório copiado. Agora cole na conversa.');
    });
    byId('copy-test-url').addEventListener('click', () => {
        copyPreparedText(testURL.href, byId('test-url'), byId('url-status'), 'Endereço copiado. Abra o Safari e cole na barra de endereço.');
    });
})();
