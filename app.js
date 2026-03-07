'use strict';

// State
let cells = [];      // { code, result, output, error, hasResult }
let sids = [];       // sids[i] = Python state ID after cell i
let selected = 0;
let evalUpTo = -1;   // cells 0..evalUpTo are fresh
let computing = -1;  // cell index being computed, or -1
let pyodide, initialSid;

function newCell() {
  return { code: '', result: '', output: '', error: '', hasResult: false };
}

function insertCell(afterIdx) {
  if (afterIdx === null) afterIdx = cells.length - 1;
  cells.splice(afterIdx + 1, 0, newCell());
  sids = sids.slice(0, afterIdx + 1);
  evalUpTo = Math.min(evalUpTo, afterIdx);
  selected = afterIdx + 1;
}

function deleteCell(idx) {
  if (cells.length === 1) {
    cells[0] = newCell(); sids = []; evalUpTo = -1; return;
  }
  cells.splice(idx, 1);
  sids = sids.slice(0, idx);
  evalUpTo = Math.min(evalUpTo, idx - 1);
  selected = Math.min(idx, cells.length - 1);
}

function markStale(fromIdx) {
  sids = sids.slice(0, fromIdx);
  evalUpTo = Math.min(evalUpTo, fromIdx - 1);
}

// Runner
async function runUpTo(toIdx) {
  if (computing >= 0) return;
  const from = Math.min(evalUpTo + 1, toIdx);
  for (let i = from; i <= toIdx; i++) {
    computing = i;
    render();
    const prevSid = (i > 0 && sids[i - 1] != null) ? sids[i - 1] : initialSid;
    pyodide.globals.set('_s', prevSid);
    pyodide.globals.set('_c', cells[i].code);
    let arr;
    try {
      const proxy = await pyodide.runPythonAsync('run_cell(_s, _c)');
      arr = proxy.toJs(); proxy.destroy();
    } catch (e) {
      arr = [prevSid, '', '', String(e)];
    }
    const [sid, result, output, error] = arr;
    sids[i] = sid;
    Object.assign(cells[i], { result, output, error, hasResult: true });
    evalUpTo = i;
  }
  computing = -1;
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
    if (i === computing) snake.className = 'snake snake-moving';
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
    if (cell.hasResult) {
      const text = cell.error
        ? cell.error.trim()
        : (cell.output + cell.result).trimEnd();
      if (text) {
        const res = document.createElement('div');
        if (cell.error) res.className = fresh ? 'result result-err' : 'result result-stale';
        else res.className = fresh ? 'result result-ok' : 'result result-stale';
        res.textContent = text;
        inner.appendChild(res);
      }
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
    if (cell.error) res.className = fresh ? 'result result-err' : 'result result-stale';
    else res.className = fresh ? 'result result-ok' : 'result result-stale';
  });
}

function refreshSnake() {
  document.querySelectorAll('.snake').forEach((el, i) => {
    if (i === computing) el.className = 'snake snake-moving';
    else if (computing < 0 && i === evalUpTo) el.className = 'snake snake-still';
    else el.className = 'snake snake-hidden';
  });
}

function focusCell(idx) {
  const t = document.querySelectorAll('#notebook textarea')[idx];
  if (t) t.focus();
}

// Init
async function init() {
  pyodide = await loadPyodide();
  const pyCode = await fetch('evaluator.py').then(r => r.text());
  await pyodide.runPythonAsync(pyCode);
  initialSid = await pyodide.runPythonAsync('_initial');
  cells.push(newCell());
  document.getElementById('loading').style.display = 'none';
  render();
  focusCell(0);
}

document.getElementById('btn-add').addEventListener('click', () => {
  insertCell(null);
  render();
  focusCell(selected);
});

init().catch(e => {
  document.getElementById('loading').textContent = 'Failed to load: ' + e;
});
