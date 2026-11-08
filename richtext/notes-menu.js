/* An in-flow editing panel. The original keyboard toolbar keeps its own layout. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const editor = document.getElementById('editor');
  const scroller = document.getElementById('editorScroll');
  const toolbar = document.getElementById('kbdToolbar');
  const trigger = document.querySelector('.bottom-navbar [data-page="notes"]');
  if (!editor || !scroller || !toolbar || !trigger) return;

  const tools = [
    ['undo', 'Desfazer', 'Desfazer'], ['redo', 'Refazer', 'Refazer'],
    ['bold', 'Negrito', 'Negrito'], ['italic', 'Itálico', 'Itálico'],
    ['list', 'Bullet', 'Lista'], ['orderedList', 'Numerada', null], ['toggle', 'Toggle', 'Inserir Bloco de Toggle'],
    ['font', 'Fonte', 'Tamanho da Fonte'], ['textColor', 'Cor do texto', 'Cor do texto'],
    ['backgroundColor', 'Destaque', 'Cor de fundo'], ['reset', 'Limpar formato', 'Resetar formatação'],
    ['reader', 'Leitura', 'Modo Bíblia']
  ];
  const sources = new Map(tools.map(([key, , label]) => [key, label ? toolbar.querySelector(`[aria-label="${label}"]`) : null]));
  const numberedIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h1v4M3 7h2M3 11c0-2 3-2 3 0 0 1-3 2-3 3h3M3 18h3l-2 2c3-1 3 3-1 2M10 5h11M10 12h11M10 19h11"/></svg>';
  function toolButton(key, iconOnly = false) {
    const [, label] = tools.find(tool => tool[0] === key);
    return `<button type="button" class="notes-tool${iconOnly ? ' notes-tool--icon-only' : ''}" data-notes-action="${key}" aria-label="${label}" title="${label}"><span class="notes-tool-icon" aria-hidden="true">${sources.get(key)?.innerHTML || numberedIcon}</span>${iconOnly ? '' : `<span>${label}</span>`}</button>`;
  }
  const groups = [
    ['history', 'Histórico', ['undo', 'redo']],
    ['format', 'Texto', ['bold', 'italic', 'font']],
    ['colors', 'Cores', ['textColor', 'backgroundColor', 'reset']],
    ['lists', 'Listas', ['list', 'orderedList', 'toggle']]
  ];
  const panel = document.createElement('section');
  panel.id = 'notes-tools'; panel.className = 'notes-tools';
  panel.setAttribute('aria-label', 'Ferramentas de Anotações');
  panel.setAttribute('aria-hidden', 'true'); panel.inert = true;
  panel.innerHTML = `<div class="notes-tools-clip"><div class="notes-tools-card">
    <header><span>Editar anotação</span><div>${toolButton('reader', true)}<button type="button" id="notes-tools-close" aria-label="Recolher ferramentas">⌃</button></div></header>
    <div class="notes-tools-groups">${groups.map(([key, label, keys]) => `<div class="notes-tools-group" data-notes-group="${key}" role="group" aria-labelledby="notes-group-${key}">
      <span class="notes-group-label" id="notes-group-${key}">${label}</span><div class="notes-tools-group-actions" style="--tool-count:${keys.length}">${keys.map(key => toolButton(key)).join('')}</div>
    </div>`).join('')}</div>
    <div id="notes-tools-font" hidden>
      <div class="notes-block-styles" role="group" aria-label="Estilo do parágrafo">
        <button type="button" data-notes-style="normal">Normal</button><button type="button" data-notes-style="h1">Título</button>
        <button type="button" data-notes-style="h2">Subtítulo</button><button type="button" data-notes-style="h3">Seção</button>
      </div>
      <div class="notes-font-control"><label for="notes-tools-font-level">Tamanho da fonte global</label>
        <div class="notes-font-preview" aria-hidden="true"><span>A</span><span>A</span></div>
        <div class="notes-font-range"><div class="notes-font-track" aria-hidden="true"></div><div class="notes-font-ticks" aria-hidden="true">${'<i></i>'.repeat(11)}</div>
          <input id="notes-tools-font-level" type="range" min="1" max="11" step="1" value="3">
        </div>
      </div>
    </div>
  </div></div>`;
  // Outside .page: blank-page taps intentionally move the editor's caret.
  scroller.insertBefore(panel, scroller.querySelector('.page'));
  const fontArea = panel.querySelector('#notes-tools-font');
  const fontButton = panel.querySelector('[data-notes-action="font"]');
  const slider = panel.querySelector('#notes-tools-font-level');
  fontButton.setAttribute('aria-controls', fontArea.id);
  fontButton.setAttribute('aria-expanded', 'false');
  let open = false, frame = 0;

  function saveSelection() { M4_Caret.saveR(); }
  function selectionRange() {
    const live = window.getSelection();
    const range = live?.rangeCount && editor.contains(live.anchorNode) ? live.getRangeAt(0) : M1_Config.state.lastR;
    return range && editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
  }
  function restoreSelection() {
    const saved = selectionRange();
    if (saved) M1_Config.state.lastR = saved.cloneRange();
    else {
      const editable = editor.querySelector('.editable');
      if (!editable) return false;
      const range = document.createRange(); range.selectNodeContents(editable); range.collapse(false);
      M1_Config.state.lastR = range;
    }
    M4_Caret.restR();
    return true;
  }
  function sync() {
    frame = 0;
    const range = selectionRange();
    const editable = M2_Query.closest(range?.startContainer, '.editable');
    const paragraph = editable?.closest('.node-paragraph');
    const reading = !!window.LeitorMode?.isActive();
    const listType = window.NotesEditorActions?.getListType?.();
    for (const [key] of tools) {
      const button = panel.querySelector(`[data-notes-action="${key}"]`);
      const source = sources.get(key);
      const icon = button.querySelector('.notes-tool-icon');
      if (source && icon.innerHTML !== source.innerHTML) icon.innerHTML = source.innerHTML;
      const disabled = key === 'undo' ? !window.M12_History?.canUndo() : key === 'redo' ? !window.M12_History?.canRedo() :
        ['list', 'orderedList'].includes(key) ? !!editable?.classList.contains('toggle-title') : false;
      button.disabled = disabled || (reading && !['font', 'reader'].includes(key));
      if (['list', 'orderedList'].includes(key)) button.setAttribute('aria-pressed', String(listType === (key === 'list' ? 'unordered' : 'ordered')));
      else if (['bold', 'italic', 'reader'].includes(key)) button.setAttribute('aria-pressed', String(key === 'reader' ? reading : !!source?.classList.contains('is-active')));
    }
    panel.querySelectorAll('[data-notes-style]').forEach(button => {
      button.disabled = reading || (!!editable && !paragraph);
      const style = ['h1','h2','h3'].find(key => paragraph?.classList.contains(`font-${key}`)) || 'normal';
      button.setAttribute('aria-pressed', String(style === button.dataset.notesStyle));
    });
    const level = window.GlobalFontScale?.getLevel() || 3;
    slider.value = String(level);
    slider.setAttribute('aria-valuetext', `Nível ${level} de 11${level === 3 ? ', padrão' : ''}`);
    slider.closest('.notes-font-range').style.setProperty('--range-progress', `${(level - 1) * 10}%`);
  }
  function queueSync() { if (!frame) frame = requestAnimationFrame(sync); }
  function close() {
    open = false;
    panel.classList.remove('is-open'); panel.inert = true; panel.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    if (panel.contains(document.activeElement)) trigger.focus({preventScroll:true});
  }
  function toggle(event) {
    event?.preventDefault();
    if (open) { close(); return; }
    saveSelection(); open = true; sync();
    panel.inert = false; panel.setAttribute('aria-hidden', 'false'); panel.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    // Only an explicit request for the tools returns to the top; never typing.
    scroller.scrollTop = 0;
  }
  trigger.addEventListener('pointerdown', saveSelection);
  panel.addEventListener('pointerdown', event => {
    saveSelection();
    if (event.pointerType === 'mouse' && event.target.closest('[data-notes-action], [data-notes-style]')) event.preventDefault();
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-notes-action], [data-notes-style]');
    if (!button || button.disabled) return;
    const key = button.dataset.notesAction;
    if (key === 'font') {
      fontArea.hidden = !fontArea.hidden;
      fontButton.setAttribute('aria-expanded', String(!fontArea.hidden));
    } else if (key === 'reader') {
      const reader = window.LeitorMode;
      if (reader?.isActive()) reader.desativar(); else reader?.ativar();
    } else if (key === 'undo' || key === 'redo') {
      window.M12_History?.[key]();
    } else if (restoreSelection()) {
      if (button.dataset.notesStyle) window.NotesEditorActions?.blockStyle(button.dataset.notesStyle);
      else if (key === 'toggle') {
        window.M12_History?.beforeChange(); M7_Actions.newRootToggle(); window.M12_History?.afterChange(2);
      } else window.NotesEditorActions?.[key]?.();
    }
    queueSync();
  });
  slider.addEventListener('input', () => window.GlobalFontScale?.setLevel(Number(slider.value)));
  panel.querySelector('#notes-tools-close').onclick = close;
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  new MutationObserver(queueSync).observe(toolbar, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class','style','disabled','aria-pressed']});
  document.addEventListener('selectionchange', queueSync);
  document.addEventListener('history:statechange', queueSync);
  window.addEventListener('globalfont:changed', queueSync);
  window.addEventListener('notes:restored', queueSync);
  window.NotesMenu = {toggle, close, get isOpen() { return open; }};
  sync();
});
