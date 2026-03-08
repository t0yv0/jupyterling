# Jupyterling

A lightweight, zero-install Python notebook that runs entirely in the browser, powered by [Pyodide](https://pyodide.org).

No server. No setup. Open the page and start writing Python.

**[Try it live →](https://t0yv0.github.io/jupyterling/)**

## Why

Teaching Python to my daughter using Jupyter was a little frustrating because it requires a mental model of the kernel
state. When cells are evaluated out of order, or the kernel is busy or crashing, things get confusing fast. This is too
distracting for a learner.

Jupyterling fixes this by making the kernel state visible by a little snake icon alongside the last evaluated cell. The
snake is indicating how far down the notebook the kernel managed to travel. Stale results are greyed out. Cell N is
assumed to depend on cells 1..N-1. If the kernel gets stuck in a loop, the snake wiggles, but the app stays responsive.
You can select a different cell to run, which implicitly restarts the kernel and recovers quickly. If code evaluation
is slow, a target icon indicates where the snake is going, and the snake progresses incrementally as computation
results are made available.

## Features

- Python runs in a Web Worker via Pyodide
- Code saved in the browser local storage
- Syntax highlighting thanks to CodeMirror

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
