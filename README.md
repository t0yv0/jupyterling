# Jupyterling

A lightweight, zero-install Python notebook that runs entirely in the browser, powered by [Pyodide](https://pyodide.org).

No server. No setup. Open the page and start writing Python.

**[Try it live →](https://t0yv0.github.io/jupyterling/)**

## Features

- Python runs in a Web Worker via Pyodide — the page stays responsive
- Incremental evaluation: only re-runs cells that are stale
- Notebook state is local to the browser tab

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Shift+Enter` | Run cell, advance to next |
| `Alt+Enter` | Run cell, insert new cell below |
| `Ctrl+Enter` | Run cell in place |
| `Alt+↑` / `Alt+↓` | Move selection up / down |
| `Alt+Backspace` | Delete cell |
| `Ctrl+Backspace` | Restart kernel |
| `Tab` | Indent (4 spaces) |

## License

Apache 2.0
