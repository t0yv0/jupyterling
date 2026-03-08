'use strict';

// State
let cells = [];      // { code, result, hasResult, isError }
let selected = 0;
let evalUpTo = -1;   // cells 0..evalUpTo have fresh results
let computing = -1;  // cell index being computed, or -1
let evalId = 0;      // monotonic ID to ignore stale responses

// Worker management
let worker = null;
let pendingResolve = null;
let pendingId = null;

function spawnWorker() {
  worker = new Worker('worker.js');
  worker.onmessage = onWorkerMessage;
}

function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'ready') {
    document.getElementById('loading').style.display = 'none';
    render();
    focusCell(0);
  } else if (msg.type === 'result' || msg.type === 'error') {
    if (msg.id !== pendingId) return; // stale
    if (pendingResolve) pendingResolve(msg);
    pendingResolve = null;
    pendingId = null;
  }
}

function killWorker() {
  if (worker) worker.terminate();
  pendingResolve = null;
  pendingId = null;
  spawnWorker();
}

function sendEval(codeCells) {
  return new Promise(resolve => {
    const id = ++evalId;
    pendingId = id;
    pendingResolve = resolve;
    worker.postMessage({ type: 'eval', id, cells: codeCells });
  });
}

// Cell operations
function newCell() {
  return { code: '', result: '', hasResult: false, isError: false };
}

function insertCell(afterIdx) {
  if (afterIdx === null) afterIdx = cells.length - 1;
  cells.splice(afterIdx + 1, 0, newCell());
  evalUpTo = Math.min(evalUpTo, afterIdx);
  selected = afterIdx + 1;
}

function deleteCell(idx) {
  if (cells.length === 1) {
    cells[0] = newCell(); evalUpTo = -1; return;
  }
  cells.splice(idx, 1);
  evalUpTo = Math.min(evalUpTo, idx - 1);
  selected = Math.min(idx, cells.length - 1);
}

function markStale(fromIdx) {
  evalUpTo = Math.min(evalUpTo, fromIdx - 1);
}

// Runner — sends cells[0..toIdx] prefix to worker
async function runUpTo(toIdx) {
  if (computing >= 0) return;
  computing = toIdx;
  render();

  const prefix = cells.slice(0, toIdx + 1).map(c => c.code);
  const msg = await sendEval(prefix);

  computing = -1;

  if (msg.type === 'result') {
    const results = msg.results;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.error != null) {
        cells[i].result = r.error;
        cells[i].isError = true;
      } else {
        cells[i].result = r.text || '';
        cells[i].isError = false;
      }
      cells[i].hasResult = true;
    }
    evalUpTo = results.length - 1;
  } else {
    // Worker-level error
    cells[toIdx].result = msg.message;
    cells[toIdx].isError = true;
    cells[toIdx].hasResult = true;
    evalUpTo = toIdx;
  }

  // Mark cells beyond results as stale (keep old result text but not fresh)
  for (let i = evalUpTo + 1; i < cells.length; i++) {
    // hasResult stays true so we show greyed-out old results
  }

  render();
}

// Keyboard
function handleKey(e, i) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target, s = t.selectionStart, en = t.selectionEnd;
    t.value = t.value.slice(0, s) + '    ' + t.value.slice(en);
    t.selectionStart = t.selectionEnd = s + 4;
    cells[i].code = t.value;
  } else if (ctrl && e.key === 'ArrowUp') {
    e.preventDefault();
    if (i > 0) { selected = i - 1; render(); focusCell(selected); }
  } else if (ctrl && e.key === 'ArrowDown') {
    e.preventDefault();
    if (i < cells.length - 1) { selected = i + 1; render(); focusCell(selected); }
  } else if (ctrl && e.key === 'Enter') {
    e.preventDefault();
    runUpTo(i);
  } else if (ctrl && e.key === 'Delete') {
    e.preventDefault();
    deleteCell(i);
    render(); focusCell(selected);
  } else if (e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    if (i === cells.length - 1) insertCell(i);
    else selected = i + 1;
    runUpTo(i).then(() => focusCell(selected));
  } else if (ctrl && e.key === 'Backspace') {
    // Kill stuck worker
    e.preventDefault();
    killWorker();
    computing = -1;
    render();
  }
}

// Render
function render() {
  const ae = document.activeElement;
  let fi = -1, ss = 0, se = 0;
  if (ae && ae.tagName === 'TEXTAREA') {
    fi = +ae.dataset.i; ss = ae.selectionStart; se = ae.selectionEnd;
  }

  const nb = document.getElementById('notebook');
  nb.className = computing >= 0 ? 'busy' : '';
  nb.innerHTML = '';

  cells.forEach((cell, i) => {
    const fresh = i <= evalUpTo;

    const row = document.createElement('div');
    row.className = 'cell';

    // Gutter
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    const snake = document.createElement('span');
    snake.textContent = '\u{1F40D}';
    if (computing >= 0 && i === computing) snake.className = 'snake snake-moving';
    else if (computing < 0 && i === evalUpTo) snake.className = 'snake snake-still';
    else snake.className = 'snake snake-hidden';
    gutter.appendChild(snake);

    // Inner
    const inner = document.createElement('div');
    inner.className = 'cell-inner' + (i === selected ? ' selected' : '');

    const ta = document.createElement('textarea');
    ta.value = cell.code;
    ta.dataset.i = i;
    ta.rows = Math.max(1, (cell.code.match(/\n/g) || []).length + 1);
    ta.spellcheck = false;
    ta.addEventListener('input', ev => {
      cells[i].code = ev.target.value;
      ev.target.rows = Math.max(1, (ev.target.value.match(/\n/g) || []).length + 1);
      markStale(i);
      refreshStale();
      refreshSnake();
    });
    ta.addEventListener('focus', () => {
      if (selected === i) return;
      selected = i;
      document.querySelectorAll('.cell-inner').forEach((el, j) =>
        el.classList.toggle('selected', j === i));
    });
    ta.addEventListener('keydown', ev => handleKey(ev, i));
    inner.appendChild(ta);

    // Result
    if (cell.hasResult && cell.result) {
      const res = document.createElement('div');
      const stale = !fresh;
      if (cell.isError) res.className = stale ? 'result result-stale' : 'result result-err';
      else res.className = stale ? 'result result-stale' : 'result result-ok';
      res.textContent = cell.result.trimEnd();
      inner.appendChild(res);
    }

    row.appendChild(gutter);
    row.appendChild(inner);
    nb.appendChild(row);
  });

  if (fi >= 0 && fi < cells.length) {
    const t = nb.querySelectorAll('textarea')[fi];
    if (t) { t.focus(); try { t.setSelectionRange(ss, se); } catch (_) {} }
  }
}

function refreshStale() {
  document.querySelectorAll('.cell').forEach((row, i) => {
    const res = row.querySelector('.result');
    if (!res) return;
    const fresh = i <= evalUpTo;
    const cell = cells[i];
    if (cell.isError) res.className = fresh ? 'result result-err' : 'result result-stale';
    else res.className = fresh ? 'result result-ok' : 'result result-stale';
  });
}

function refreshSnake() {
  document.querySelectorAll('.snake').forEach((el, i) => {
    if (computing >= 0 && i === computing) el.className = 'snake snake-moving';
    else if (computing < 0 && i === evalUpTo) el.className = 'snake snake-still';
    else el.className = 'snake snake-hidden';
  });
}

function focusCell(idx) {
  const t = document.querySelectorAll('#notebook textarea')[idx];
  if (t) t.focus();
}

// Init
cells.push(newCell());
spawnWorker();
