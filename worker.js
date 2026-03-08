// Web worker: loads Pyodide, runs evaluator.py, handles eval requests.
// Protocol:
//   Main -> Worker: { type: 'eval', id, cells: string[] }
//   Worker -> Main: { type: 'ready' }
//   Worker -> Main: { type: 'result', id, results: {text?:string, error?:string}[] }
//   Worker -> Main: { type: 'error', id, message: string }

importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');

let pyodide = null;

async function init() {
  pyodide = await loadPyodide();
  const evalCode = await fetch('evaluator.py').then(r => r.text());
  await pyodide.runPythonAsync(evalCode);
  await pyodide.runPythonAsync('_worker = Worker()');
  postMessage({ type: 'ready' });
}

self.onmessage = async function(e) {
  const msg = e.data;
  if (msg.type === 'eval') {
    try {
      // Build a Notebook from the cell code strings and evaluate
      pyodide.globals.set('_cells_json', JSON.stringify(msg.cells));
      const proxy = await pyodide.runPythonAsync(`
import json as _json
_codes = _json.loads(_cells_json)
_nb = Notebook(cells=[Cell(code=Code(c)) for c in _codes])
_raw = _worker.evaluate(_nb)
[{'text': r.text} if isinstance(r, EvalResult) else {'error': r.message} for r in _raw]
`);
      const results = proxy.toJs({ dict_converter: Object.fromEntries });
      proxy.destroy();
      postMessage({ type: 'result', id: msg.id, results: Array.from(results) });
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, message: String(err) });
    }
  }
};

init();
