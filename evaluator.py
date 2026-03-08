"""The evaluation code runs in a web worker.

The simple version accepts an entire notebook prefixes and evaluates from scratch.

Subsequent versions will cache in-memory a little bit to speed up.

If eval may be stuck in an infinite loop, the app will kill the worker and restart.
"""

import json
from dataclasses import dataclass
from typing import Any, NewType, TypeAlias, Mapping


Code = NewType('Code', str)


@dataclass(frozen=True)
class Cell:
    code: Code


@dataclass(frozen=True)
class Notebook:
    cells: list[Cell]


@dataclass(frozen=True)
class EvalResult:
    text: str


@dataclass(frozen=True)
class ErrorResult:
    message: str


Result: TypeAlias = EvalResult | ErrorResult


class Worker:

    def evaluate(self, nb: Notebook) -> list[Result]:
        results: list[Result] = []
        globals: dict[str, Any] = {}
        locals: Mapping[str, Any] = {}
        for c in nb.cells:
            r = self.evaluate_cell(c, globals, locals)
            results.append(r)
            if isinstance(r, ErrorResult):
                return results
        return results

    def evaluate_cell(self, c: Cell,
                      globals: dict[str, Any],
                      locals: Mapping[str, Any]) -> Result:
        import io, sys, traceback
        buf = io.StringIO()
        sys.stdout, old = buf, sys.stdout
        try:
            s = c.code.strip()
            if not s:
                return EvalResult(text='')
            try:
                v = eval(compile(s, '<cell>', 'eval'), globals, locals)
                output = buf.getvalue()
                text = output + (repr(v) if v is not None else '')
                return EvalResult(text=text)
            except SyntaxError:
                exec(compile(s, '<cell>', 'exec'), globals, locals)
                return EvalResult(text=buf.getvalue())
        except Exception:
            return ErrorResult(message=traceback.format_exc())
        finally:
            sys.stdout = old


def evaluate_json(cells_json: str) -> list[dict[str, str]]:
    """Entry point called from worker.js. Takes JSON array of code strings,
    returns list of dicts with 'text' or 'error' key."""
    codes = json.loads(cells_json)
    nb = Notebook(cells=[Cell(code=Code(c)) for c in codes])
    results = Worker().evaluate(nb)
    return [
        {'text': r.text} if isinstance(r, EvalResult) else {'error': r.message}
        for r in results
    ]
