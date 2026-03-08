import {
  html, render, useState, useRef, useCallback, useEffect
} from 'https://esm.sh/htm/preact/standalone';

// ── Worker management ──────────────────────────────────────────────

let worker = null;
let pendingResolve = null;
let pendingId = null;
let evalId = 0;

function spawnWorker(onReady) {
  worker = new Worker('worker.js');
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'ready') {
      onReady();
    } else if (msg.type === 'result' || msg.type === 'error') {
      if (msg.id !== pendingId) return;
      if (pendingResolve) pendingResolve(msg);
      pendingResolve = null;
      pendingId = null;
    }
  };
}

function killWorker(onReady) {
  if (worker) worker.terminate();
  pendingResolve = null;
  pendingId = null;
  spawnWorker(onReady);
}

function sendEval(codeCells) {
  return new Promise(resolve => {
    const id = ++evalId;
    pendingId = id;
    pendingResolve = resolve;
    worker.postMessage({ type: 'eval', id, cells: codeCells });
  });
}

// ── State helpers ──────────────────────────────────────────────────

function newCell() {
  return { code: '', result: '', hasResult: false, isError: false };
}

// ── Components ─────────────────────────────────────────────────────

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

function CellRow({ cell, index, selected, computing, evalUpTo, dispatch }) {
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
  const [state, setState] = useState({
    cells: [newCell()],
    selected: 0,
    evalUpTo: -1,
    computing: -1,
    ready: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback(fn => {
    setState(prev => {
      const next = fn(prev);
      return next === prev ? prev : { ...prev, ...next };
    });
  }, []);

  // Boot worker once
  useEffect(() => {
    spawnWorker(() => update(() => ({ ready: true })));
  }, []);

  // Run logic (needs access to current state via ref)
  const runUpTo = useCallback(async (toIdx) => {
    const s = stateRef.current;
    if (s.computing >= 0) return;

    update(() => ({ computing: toIdx }));

    const prefix = s.cells.slice(0, toIdx + 1).map(c => c.code);
    const msg = await sendEval(prefix);
    const cur = stateRef.current;
    const cells = cur.cells.map(c => ({ ...c }));

    if (msg.type === 'result') {
      for (let i = 0; i < msg.results.length; i++) {
        const r = msg.results[i];
        cells[i].result = r.error != null ? r.error : (r.text || '');
        cells[i].isError = r.error != null;
        cells[i].hasResult = true;
      }
      update(() => ({ cells, computing: -1, evalUpTo: msg.results.length - 1 }));
    } else {
      cells[toIdx].result = msg.message;
      cells[toIdx].isError = true;
      cells[toIdx].hasResult = true;
      update(() => ({ cells, computing: -1, evalUpTo: toIdx }));
    }
  }, []);

  const dispatch = useCallback((action) => {
    const s = stateRef.current;
    switch (action.type) {
      case 'setCode': {
        const cells = s.cells.map((c, i) =>
          i === action.index ? { ...c, code: action.code } : c);
        update(() => ({
          cells,
          evalUpTo: Math.min(s.evalUpTo, action.index - 1),
        }));
        break;
      }
      case 'select':
        if (s.selected !== action.index) update(() => ({ selected: action.index }));
        break;
      case 'selectUp':
        if (s.selected > 0) update(() => ({ selected: s.selected - 1 }));
        break;
      case 'selectDown':
        if (s.selected < s.cells.length - 1) update(() => ({ selected: s.selected + 1 }));
        break;
      case 'run':
        runUpTo(action.index);
        break;
      case 'runAndAdvance': {
        const nextIdx = action.index + 1;
        const cells = [...s.cells];
        let sel;
        if (nextIdx >= cells.length) {
          cells.push(newCell());
          sel = nextIdx;
        } else {
          sel = nextIdx;
        }
        update(() => ({ cells, selected: sel }));
        runUpTo(action.index);
        break;
      }
      case 'deleteCell': {
        if (s.cells.length === 1) {
          update(() => ({ cells: [newCell()], evalUpTo: -1, selected: 0 }));
        } else {
          const cells = s.cells.filter((_, i) => i !== action.index);
          update(() => ({
            cells,
            evalUpTo: Math.min(s.evalUpTo, action.index - 1),
            selected: Math.min(action.index, cells.length - 1),
          }));
        }
        break;
      }
      case 'addCell': {
        const cells = [...s.cells, newCell()];
        update(() => ({ cells, selected: cells.length - 1 }));
        break;
      }
      case 'killWorker':
        killWorker(() => update(() => ({ ready: true })));
        update(() => ({ computing: -1 }));
        break;
    }
  }, [runUpTo]);

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
          dispatch=${dispatch}
        />
      `)}
    </div>
    <div id="toolbar">
      <button onClick=${() => dispatch({ type: 'addCell' })}>+ Add Cell</button>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
