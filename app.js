import {
  html, render, useState, useRef, useEffect
} from 'https://esm.sh/htm/preact/standalone';

import { Store, INITIAL_STATE, freshCell } from './viewmodel.js';

import { EditorView, keymap, drawSelection } from 'https://esm.sh/@codemirror/view@6';
import { Prec } from 'https://esm.sh/@codemirror/state@6';
import { defaultKeymap, history, historyKeymap } from 'https://esm.sh/@codemirror/commands@6';
import { syntaxHighlighting, bracketMatching } from 'https://esm.sh/@codemirror/language@6';
import { closeBrackets, closeBracketsKeymap } from 'https://esm.sh/@codemirror/autocomplete@6';
import { python } from 'https://esm.sh/@codemirror/lang-python@6';
import { oneDarkHighlightStyle } from 'https://esm.sh/@codemirror/theme-one-dark@6';

// ── Store singleton ─────────────────────────────────────────────────

const STORAGE_KEY = 'jupyterling-cells';

function loadCells() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const cells = JSON.parse(saved);
      if (Array.isArray(cells) && cells.length > 0)
        return cells.map(c => ({ ...freshCell(), code: c.code || '' }));
    }
  } catch {}
  return null;
}

function saveCells(cells) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cells.map(c => ({ code: c.code }))));
  } catch {}
}

const savedCells = loadCells();
const store = new Store(savedCells ? { ...INITIAL_STATE, cells: savedCells } : INITIAL_STATE);

// ── Hook: subscribe to store ────────────────────────────────────────

function useStore() {
  const [state, setState] = useState(store.getState());
  useEffect(() => store.subscribe(setState), []);
  return state;
}

function dispatch(action) {
  store.dispatch(action);
}

// ── CodeMirror theme ────────────────────────────────────────────

const cmTheme = EditorView.theme({
  '&': { background: '#0d1117' },
  '.cm-scroller': { background: '#0d1117', fontFamily: "'Courier New', monospace", fontSize: '13px', lineHeight: '1.5' },
  '.cm-content': { padding: '6px 10px', caretColor: '#c9d1d9' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: '#c9d1d9' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-selectionBackground': { background: '#264f7866 !important' },
  '&.cm-focused .cm-selectionBackground': { background: '#264f78 !important' },
});

// ── Components ──────────────────────────────────────────────────────

function Snake({ cellIndex, computing, evalUpTo, target, workerStatus }) {
  let snakeCls = 'snake snake-hidden';
  if (workerStatus === 'ready') {
    if (computing >= 0 && cellIndex === computing) snakeCls = 'snake snake-moving';
    else if (computing < 0 && cellIndex === evalUpTo) snakeCls = 'snake snake-still';
  }
  const showTarget = target >= 0 && cellIndex === target && cellIndex !== computing;
  return html`
    <span class=${snakeCls}>\u{1F40D}</span>
    ${showTarget && html`<span class="target">\u{1F3AF}</span>`}
  `;
}

function ResultBox({ cell, fresh }) {
  if (!cell.hasResult || !cell.result) return null;
  let cls = 'result ';
  if (!fresh) cls += 'result-stale';
  else if (cell.isError) cls += 'result-err';
  else cls += 'result-ok';
  return html`<div class=${cls}>${cell.result.trimEnd()}</div>`;
}

function CellRow({ cell, index, selected, computing, evalUpTo, target, workerStatus }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const fresh = index <= evalUpTo;

  // Create CM6 editor on mount
  useEffect(() => {
    const notebookKeymap = Prec.highest(keymap.of([
      { key: 'Alt-ArrowUp',   run: () => { dispatch({ type: 'selectUp' }); return true; } },
      { key: 'Alt-ArrowDown', run: () => { dispatch({ type: 'selectDown' }); return true; } },
      { key: 'Mod-Enter',     run: () => { dispatch({ type: 'run',           index: indexRef.current }); return true; } },
      { key: 'Ctrl-Enter',    run: () => { dispatch({ type: 'run',           index: indexRef.current }); return true; } },
      { key: 'Alt-Enter',     run: () => { dispatch({ type: 'runAndInsert',  index: indexRef.current }); return true; } },
      { key: 'Shift-Enter',   run: () => { dispatch({ type: 'runAndAdvance', index: indexRef.current }); return true; } },
      { key: 'Alt-Delete',    run: () => { dispatch({ type: 'deleteCell',    index: indexRef.current }); return true; } },
      { key: 'Alt-Backspace', run: () => { dispatch({ type: 'deleteCell',    index: indexRef.current }); return true; } },
      { key: 'Mod-Backspace', run: () => { dispatch({ type: 'killWorker' }); return true; } },
      { key: 'Tab', run: view => {
        const { from, to } = view.state.selection.main;
        view.dispatch({ changes: { from, to, insert: '    ' }, selection: { anchor: from + 4 } });
        return true;
      }},
    ]));

    const view = new EditorView({
      doc: cell.code,
      extensions: [
        notebookKeymap,
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(oneDarkHighlightStyle),
        python(),
        cmTheme,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => {
          if (update.focusChanged && update.view.hasFocus) {
            dispatch({ type: 'select', index: indexRef.current });
          }
          if (update.docChanged) {
            dispatch({ type: 'setCode', index: indexRef.current, code: update.state.doc.toString() });
          }
        }),
      ],
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  // Sync external code changes to editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== cell.code) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: cell.code } });
    }
  }, [cell.code]);

  // Focus when selected
  useEffect(() => {
    if (selected && viewRef.current && !viewRef.current.hasFocus) {
      viewRef.current.focus();
    }
  }, [selected]);

  return html`
    <div class="cell">
      <div class="gutter">
        <${Snake} cellIndex=${index} computing=${computing} evalUpTo=${evalUpTo} target=${target} workerStatus=${workerStatus} />
      </div>
      <div class=${'cell-inner' + (selected ? ' selected' : '')}>
        <div ref=${containerRef}></div>
        <${ResultBox} cell=${cell} fresh=${fresh} />
      </div>
    </div>
  `;
}

const SHORTCUTS = [
  ['Shift+Enter',       'Run cell, advance to next'],
  ['Alt+Enter',         'Run cell, insert below'],
  ['Ctrl+Enter',        'Run cell in place'],
  ['Alt+↑ / Alt+↓',    'Move selection up / down'],
  ['Alt+Backspace',     'Delete cell'],
  ['Ctrl+Backspace',    'Restart kernel'],
  ['Tab',               'Indent (4 spaces)'],
];

function ShortcutsModal({ onClose }) {
  return html`
    <div class="modal-overlay" onClick=${onClose}>
      <div class="modal" onClick=${e => e.stopPropagation()}>
        <div class="modal-header">
          <span>Keyboard Shortcuts</span>
          <button class="modal-close" onClick=${onClose}>✕</button>
        </div>
        <table class="shortcuts-table">
          <tbody>
            ${SHORTCUTS.map(([key, desc]) => html`
              <tr>
                <td><kbd>${key}</kbd></td>
                <td>${desc}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function App() {
  const state = useStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // First boot: show loading screen. Respawn: keep the notebook visible.
  if (state.worker === 'booting' && state.evalUpTo === -1 && !state.cells.some(c => c.code))
    return html`<div class="loading-msg">Loading Python \u{1F40D}</div>`;

  return html`
    <div id="notebook">
      ${state.cells.map((cell, i) => html`
        <${CellRow}
          key=${i}
          cell=${cell}
          index=${i}
          selected=${i === state.selected}
          computing=${state.computing}
          evalUpTo=${state.evalUpTo}
          target=${state.target}
          workerStatus=${state.worker}
        />
      `)}
    </div>
    <div id="toolbar">
      <button onClick=${() => dispatch({ type: 'addCell' })}>+ Cell</button>
      <button onClick=${() => dispatch({ type: 'run', index: state.cells.length - 1 })}>▶ Run All</button>
      <button onClick=${() => dispatch({ type: 'killWorker' })}>↺ Restart</button>
      <button onClick=${() => setShowShortcuts(true)}>⌨ Shortcuts</button>
    </div>
    ${showShortcuts && html`<${ShortcutsModal} onClose=${() => setShowShortcuts(false)} />`}
  `;
}

// ── Boot ────────────────────────────────────────────────────────────

store.boot();
store.subscribe(state => saveCells(state.cells));
if (savedCells) {
  store.waitForReady().then(() => store.dispatch({ type: 'run', index: savedCells.length - 1 }));
}
render(html`<${App} />`, document.getElementById('app'));
