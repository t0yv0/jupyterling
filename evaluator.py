import io
import sys
import traceback


_states = {}
_sid_ctr = [0]


def _alloc(base):
    sid = _sid_ctr[0]
    _sid_ctr[0] += 1
    _states[sid] = dict(_states[base]) if base in _states else {'__builtins__': __builtins__}
    return sid


_initial = _alloc(-1)


def run_cell(prev_sid, code):
    sid = _alloc(prev_sid)
    g = _states[sid]
    buf = io.StringIO()
    sys.stdout, old = buf, sys.stdout
    result = err = ''
    try:
        s = code.strip()
        if s:
            try:
                v = eval(compile(s, '<cell>', 'eval'), g)
                if v is not None:
                    result = repr(v)
            except SyntaxError:
                exec(compile(s, '<cell>', 'exec'), g)
    except Exception:
        err = traceback.format_exc()
    finally:
        sys.stdout = old
    return [sid, result, buf.getvalue(), err]
