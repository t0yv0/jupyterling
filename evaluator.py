"""The evaluation code runs in a web worker.

The simple version accepts an entire notebook prefixes and evaluates from scratch.

Subsequent versions will cache in-memory a little bit to speed up.

If eval may be stuck in an infinite loop, the app will kill the worker and restart.
"""

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
            r = self.evalute_cell(c, globals, locals)
            results.append(r)
            if isinstance(r, ErrorResult):
                return results
        return results

    def evalute_cell(self, c: Cell,
                     globals: dict[str, Any],
                     locals: Mapping[str, Any]) -> Result:
        try:
            value = eval(c.code, locals=locals, globals=globals)
            return EvalResult(text=str(value))
        except Exception as e:
            return ErrorResult(message=str(e))
