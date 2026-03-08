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
  postMessage({ type: 'ready' });
}

self.onmessage = async function(e) {
  const msg = e.data;
  if (msg.type === 'eval') {
    try {
      pyodide.globals.set('_cells_json', JSON.stringify(msg.cells));
      const proxy = await pyodide.runPythonAsync('evaluate_json(_cells_json)');
      const results = proxy.toJs({ dict_converter: Object.fromEntries });
      proxy.destroy();
      postMessage({ type: 'result', id: msg.id, results: Array.from(results) });
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, message: String(err) });
    }
  }
};

init();
