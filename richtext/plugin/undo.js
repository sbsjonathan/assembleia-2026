document.addEventListener('DOMContentLoaded', () => {
  if (typeof M1_Config === 'undefined' || !M1_Config.editor) return;

  const editor = M1_Config.editor;
  const PERF_LOW = !!(window.EditorPerfProfile?.isLow?.() || document.documentElement.classList.contains('perf-low'));

  const M12_History = {
    stack: [],
    index: -1,
    limit: PERF_LOW ? 30 : 100,
    timer: 0,
    restoring: false,
    raf: 0,

    isNode(node) {
      return !!node && node.nodeType === 1 && (
        node.classList.contains('node-toggle') ||
        node.classList.contains('node-text') ||
        node.classList.contains('node-paragraph')
      );
    },

    rootNodes() {
      return Array.from(editor.children).filter(node => this.isNode(node));
    },

    childNodes(container) {
      return Array.from(container?.children || []).filter(node => this.isNode(node));
    },

    nodePath(node) {
      if (!this.isNode(node)) return null;
      const path = [];
      let current = node;

      while (current && current !== editor) {
        const parent = current.parentElement;
        const siblings = parent === editor
          ? this.rootNodes()
          : this.childNodes(parent);
        const index = siblings.indexOf(current);
        if (index < 0) return null;
        path.unshift(index);
        if (parent === editor) break;
        current = parent.closest('.node-toggle');
      }

      return path;
    },

    nodeFromPath(path) {
      if (!Array.isArray(path) || !path.length) return null;
      let siblings = this.rootNodes();
      let node = null;

      for (let i = 0; i < path.length; i++) {
        node = siblings[path[i]] || null;
        if (!node) return null;
        if (i < path.length - 1) {
          if (!node.classList.contains('node-toggle')) return null;
          siblings = this.childNodes(M2_Query.getChil(node));
        }
      }

      return node;
    },

    textOffset(editable, container, offset) {
      const range = document.createRange();
      range.selectNodeContents(editable);
      try {
        range.setEnd(container, offset);
      } catch (err) {
        return editable.textContent.length;
      }
      return range.toString().length;
    },

    pointFromBoundary(container, offset) {
      const editable = M2_Query.closest(container, '.editable');
      const node = editable?.closest('.node-toggle, .node-text, .node-paragraph');
      if (!editable || !node) return null;
      return {
        path: this.nodePath(node),
        offset: this.textOffset(editable, container, offset)
      };
    },

    resolvePoint(editable, offset) {
      let remaining = Math.max(0, Math.min(offset || 0, editable.textContent.length));
      const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      let lastText = null;

      while (textNode) {
        lastText = textNode;
        if (remaining <= textNode.nodeValue.length) {
          return { container: textNode, offset: remaining };
        }
        remaining -= textNode.nodeValue.length;
        textNode = walker.nextNode();
      }

      if (lastText) return { container: lastText, offset: lastText.nodeValue.length };
      return { container: editable, offset: editable.childNodes.length };
    },

    captureSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
      const start = this.pointFromBoundary(range.startContainer, range.startOffset);
      const end = this.pointFromBoundary(range.endContainer, range.endOffset);
      if (!start || !end) return null;
      return {
        start,
        end,
        collapsed: range.collapsed
      };
    },

    restoreSelection(selection) {
      if (!selection?.start?.path) return;
      const startNode = this.nodeFromPath(selection.start.path);
      const endNode = this.nodeFromPath(selection.end?.path || selection.start.path);
      const startEditable = M2_Query.getEdFor(startNode);
      const endEditable = M2_Query.getEdFor(endNode || startNode);
      if (!startEditable || !endEditable) return;

      const startPoint = this.resolvePoint(startEditable, selection.start.offset);
      const endPoint = selection.collapsed
        ? startPoint
        : this.resolvePoint(endEditable, selection.end?.offset || 0);

      const range = document.createRange();
      range.setStart(startPoint.container, startPoint.offset);
      range.setEnd(endPoint.container, endPoint.offset);

      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      M4_Caret.saveR();
      M4_Caret.updateFocus();
      M11_Layout.schedule(2);
    },

    serializeNode(node) {
      if (node.classList.contains('node-paragraph')) {
        return {
          type: 'paragraph',
          level: M2_Query.getLvl(node),
          html: M2_Query.getParC(node).innerHTML
        };
      }

      if (node.classList.contains('node-text')) {
        return {
          type: 'text',
          level: M2_Query.getLvl(node),
          html: M2_Query.getTxtC(node).innerHTML
        };
      }

      if (node.classList.contains('node-toggle')) {
        return {
          type: 'toggle',
          level: M2_Query.getLvl(node),
          open: node.dataset.open === 'true',
          html: M2_Query.getTit(node).innerHTML,
          children: this.childNodes(M2_Query.getChil(node)).map(child => this.serializeNode(child)).filter(Boolean)
        };
      }

      return null;
    },

    serializeRoots() {
      return this.rootNodes().map(node => this.serializeNode(node)).filter(Boolean);
    },

    deserializeNode(tree) {
      if (!tree) return null;

      if (tree.type === 'paragraph') {
        const node = M5_Factory.para();
        const editable = M2_Query.getParC(node);
        editable.innerHTML = tree.html || '';
        M3_TextModel.sync(editable);
        return node;
      }

      if (tree.type === 'text') {
        const node = M5_Factory.text('', Math.max(1, +(tree.level || 1)));
        const editable = M2_Query.getTxtC(node);
        editable.innerHTML = tree.html || '';
        M3_TextModel.sync(editable);
        return node;
      }

      if (tree.type === 'toggle') {
        const node = M5_Factory.toggle('', Math.max(0, +(tree.level || 0)), !!tree.open);
        const title = M2_Query.getTit(node);
        const children = M2_Query.getChil(node);
        title.innerHTML = tree.html || '';
        children.innerHTML = '';
        (tree.children || []).forEach(child => {
          const built = this.deserializeNode(child);
          if (built) children.appendChild(built);
        });
        M6_Tree.setOpen(node, !!tree.open, false);
        M3_TextModel.sync(title);
        return node;
      }

      return null;
    },

    snapshot() {
      const roots = this.serializeRoots();
      return {
        roots,
        selection: this.captureSelection(),
        contentKey: JSON.stringify(roots)
      };
    },

    updateButtons() {
      document.dispatchEvent(new CustomEvent('history:statechange', {
        detail: {
          canUndo: this.canUndo(),
          canRedo: this.canRedo()
        }
      }));
    },

    canUndo() {
      return this.index > 0;
    },

    canRedo() {
      return this.index >= 0 && this.index < this.stack.length - 1;
    },

    commit(force = false) {
      if (this.restoring) return;
      const snap = this.snapshot();

      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }

      const current = this.stack[this.index];

      if (!force && current && snap.contentKey && current.contentKey === snap.contentKey) {
        this.stack[this.index] = snap;
        this.updateButtons();
        return;
      }

      this.stack.push(snap);
      if (this.stack.length > this.limit) {
        this.stack.shift();
      } else {
        this.index += 1;
      }
      this.index = this.stack.length - 1;
      this.updateButtons();
    },

    schedule(delay = PERF_LOW ? 1200 : 260) {
      if (this.restoring) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = 0;
        this.commit();
      }, delay);
    },

    scheduleFrame(frames = 2) {
      if (this.restoring) return;
      cancelAnimationFrame(this.raf);
      const tick = count => {
        if (count <= 0) {
          this.commit();
          return;
        }
        this.raf = requestAnimationFrame(() => tick(count - 1));
      };
      tick(frames);
    },

    flush() {
      if (!this.timer) return;
      clearTimeout(this.timer);
      this.timer = 0;
      this.commit();
    },

    beforeChange() {
      this.flush();
      this.commit();
    },

    afterChange(frames = 2) {
      this.scheduleFrame(frames);
    },

    restore(index) {
      const snap = this.stack[index];
      if (!snap) return;

      this.restoring = true;
      clearTimeout(this.timer);
      cancelAnimationFrame(this.raf);
      this.timer = 0;
      this.raf = 0;

      editor.innerHTML = '';
      snap.roots.forEach(tree => {
        const built = this.deserializeNode(tree);
        if (built) editor.appendChild(built);
      });

      if (!editor.children.length) {
        editor.appendChild(M5_Factory.para());
      }

      this.index = index;
      M3_TextModel.syncAll();
      this.restoring = false;

      requestAnimationFrame(() => {
        if (snap.selection) this.restoreSelection(snap.selection);
        else {
          const first = editor.querySelector('.editable');
          if (first) M4_Caret.place(first, false);
        }
        this.updateButtons();
      });
    },

    undo() {
      this.flush();
      if (!this.canUndo()) {
        this.updateButtons();
        return;
      }
      this.restore(this.index - 1);
    },

    redo() {
      this.flush();
      if (!this.canRedo()) {
        this.updateButtons();
        return;
      }
      this.restore(this.index + 1);
    },

    bind() {
      editor.addEventListener('beforeinput', e => {
        if (this.restoring) return;

        if (e.inputType === 'historyUndo') {
          e.preventDefault();
          this.undo();
          return;
        }

        if (e.inputType === 'historyRedo') {
          e.preventDefault();
          this.redo();
          return;
        }

        const range = M2_Query.curRange();
        const replacingSelection = !!range && !range.collapsed && (
          e.inputType.startsWith('insert') || e.inputType.startsWith('delete')
        );

        if (
          replacingSelection ||
          e.inputType === 'insertParagraph' ||
          e.inputType === 'deleteContentBackward' ||
          e.inputType === 'deleteContentForward' ||
          e.inputType === 'insertFromPaste' ||
          e.inputType === 'insertFromDrop'
        ) {
          this.beforeChange();
          this.afterChange(3);
        }
      }, true);

      editor.addEventListener('input', () => {
        if (this.restoring) return;
        this.schedule();
      });

      editor.addEventListener('click', e => {
        if (this.restoring) return;
        if (e.target.closest('.toggle-arrow, .text-plus')) {
          this.afterChange(2);
        }
      });

      editor.addEventListener('paste', () => {
        if (this.restoring) return;
        this.beforeChange();
        this.afterChange(3);
      }, true);

      editor.addEventListener('blur', () => {
        if (this.restoring) return;
        this.flush();
      }, true);

      editor.addEventListener('keydown', e => {
        // Inputs in dialogs have their own native undo history. Only handle a
        // shortcut whose actual focus is inside the editable note.
        if (e.defaultPrevented || e.isComposing || !editor.isContentEditable) return;
        const active = document.activeElement;
        if (!editor.contains(active) || active.matches?.('input, textarea, select')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const key = (e.key || '').toLowerCase();
        if (key !== 'z') return;
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      });
    },

    init() {
      this.bind();
      this.commit(true);
      this.updateButtons();
    }
  };

  window.M12_History = M12_History;
  M12_History.init();
});
