import {
  html, render, useState, useRef, useCallback, useEffect
} from 'https://esm.sh/htm/preact/standalone';

import { Store, INITIAL_STATE } from './viewmodel.js';

// ── Store singleton ─────────────────────────────────────────────────

const store = new Store(INITIAL_STATE);

// ── Hook: subscribe to store ────────────────────────────────────────

function useStore() {
  const [state, setState] = useState(store.getState());
  useEffect(() => store.subscribe(setState), []);
  return state;
}

function dispatch(action) {
  store.dispatch(action);
}

// ── Components ──────────────────────────────────────────────────────

function Snake({ cellIndex, computing, evalUpTo }) {
  let cls = 'snake snake-hidden';
  if (computing >= 0 && cellIndex === computing) cls = 'snake snake-moving';
  else if (computing < 0 && cellIndex === evalUpTo) cls = 'snake snake-still';
  return html`<span class=${cls}>\u{1F40D}</span>`;
}

function ResultBox({ cell, fresh }) {
  if (!cell.hasResult || !cell.result) return null;
  let cls = 'result ';
  if (!fresh) cls += 'result-stale';
  else if (cell.isError) cls += 'result-err';
  else cls += 'result-ok';
  return html`<div class=${cls}>${cell.result.trimEnd()}</div>`;
}

function CellRow({ cell, index, selected, computing, evalUpTo }) {
  const taRef = useRef(null);
  const fresh = index <= evalUpTo;

  useEffect(() => {
    if (selected && taRef.current && document.activeElement !== taRef.current) {
      taRef.current.focus();
    }
  }, [selected]);

  const rows = Math.max(1, (cell.code.match(/\n/g) || []).length + 1);

  const onInput = useCallback(ev => {
    dispatch({ type: 'setCode', index, code: ev.target.value });
  }, [index]);

  const onFocus = useCallback(() => {
    dispatch({ type: 'select', index });
  }, [index]);

  const onKeyDown = useCallback(ev => {
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const t = ev.target, s = t.selectionStart, en = t.selectionEnd;
      t.value = t.value.slice(0, s) + '    ' + t.value.slice(en);
      t.selectionStart = t.selectionEnd = s + 4;
      dispatch({ type: 'setCode', index, code: t.value });
    } else if (ctrl && ev.key === 'ArrowUp') {
      ev.preventDefault(); dispatch({ type: 'selectUp' });
    } else if (ctrl && ev.key === 'ArrowDown') {
      ev.preventDefault(); dispatch({ type: 'selectDown' });
    } else if (ctrl && ev.key === 'Enter') {
      ev.preventDefault(); dispatch({ type: 'run', index });
    } else if (ctrl && ev.key === 'Delete') {
      ev.preventDefault(); dispatch({ type: 'deleteCell', index });
    } else if (ev.shiftKey && ev.key === 'Enter') {
      ev.preventDefault(); dispatch({ type: 'runAndAdvance', index });
    } else if (ctrl && ev.key === 'Backspace') {
      ev.preventDefault(); dispatch({ type: 'killWorker' });
    }
  }, [index]);

  return html`
    <div class="cell">
      <div class="gutter">
        <${Snake} cellIndex=${index} computing=${computing} evalUpTo=${evalUpTo} />
      </div>
      <div class=${'cell-inner' + (selected ? ' selected' : '')}>
        <textarea
          ref=${taRef}
          rows=${rows}
          spellcheck=${false}
          value=${cell.code}
          onInput=${onInput}
          onFocus=${onFocus}
          onKeyDown=${onKeyDown}
        />
        <${ResultBox} cell=${cell} fresh=${fresh} />
      </div>
    </div>
  `;
}

function App() {
  const state = useStore();

  if (!state.ready) return html`<div class="loading-msg">Loading Python \u{1F40D}</div>`;

  return html`
    <div id="notebook" class=${state.computing >= 0 ? 'busy' : ''}>
      ${state.cells.map((cell, i) => html`
        <${CellRow}
          key=${i}
          cell=${cell}
          index=${i}
          selected=${i === state.selected}
          computing=${state.computing}
          evalUpTo=${state.evalUpTo}
        />
      `)}
    </div>
    <div id="toolbar">
      <button onClick=${() => dispatch({ type: 'addCell' })}>+ Add Cell</button>
    </div>
  `;
}

// ── Boot ────────────────────────────────────────────────────────────

store.boot();
render(html`<${App} />`, document.getElementById('app'));
