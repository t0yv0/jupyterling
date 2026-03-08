// ── Cell & Notebook State ───────────────────────────────────────────
export function freshCell() {
    return { code: '', result: '', hasResult: false, isError: false };
}
export const INITIAL_STATE = {
    cells: [freshCell()],
    selected: 0,
    evalUpTo: -1,
    computing: -1,
    ready: false,
};
// ── Pure Reducer ────────────────────────────────────────────────────
// Every state transition is here. No side effects.
export function reduce(state, action) {
    switch (action.type) {
        case 'workerReady':
            return { ...state, ready: true };
        case 'setCode': {
            const cells = state.cells.map((c, i) => i === action.index ? { ...c, code: action.code } : c);
            return {
                ...state,
                cells,
                evalUpTo: Math.min(state.evalUpTo, action.index - 1),
            };
        }
        case 'select':
            return state.selected === action.index
                ? state
                : { ...state, selected: action.index };
        case 'selectUp':
            return state.selected > 0
                ? { ...state, selected: state.selected - 1 }
                : state;
        case 'selectDown':
            return state.selected < state.cells.length - 1
                ? { ...state, selected: state.selected + 1 }
                : state;
        case 'addCell': {
            const cells = [...state.cells, freshCell()];
            return { ...state, cells, selected: cells.length - 1 };
        }
        case 'deleteCell': {
            if (state.cells.length === 1) {
                return { ...state, cells: [freshCell()], evalUpTo: -1, selected: 0 };
            }
            const cells = state.cells.filter((_, i) => i !== action.index);
            return {
                ...state,
                cells,
                evalUpTo: Math.min(state.evalUpTo, action.index - 1),
                selected: Math.min(action.index, cells.length - 1),
            };
        }
        case 'runAndAdvance': {
            // State part only: add cell if needed, advance selection.
            // The eval side effect is handled by the Store.
            const nextIdx = action.index + 1;
            if (nextIdx >= state.cells.length) {
                const cells = [...state.cells, freshCell()];
                return { ...state, cells, selected: nextIdx };
            }
            return { ...state, selected: nextIdx };
        }
        case 'evalStarted':
            return { ...state, computing: action.toIndex };
        case 'evalDone': {
            const cells = state.cells.map((c, i) => {
                if (i >= action.results.length)
                    return c;
                const r = action.results[i];
                return {
                    ...c,
                    result: r.error != null ? r.error : (r.text ?? ''),
                    isError: r.error != null,
                    hasResult: true,
                };
            });
            return {
                ...state,
                cells,
                computing: -1,
                evalUpTo: action.results.length - 1,
            };
        }
        case 'evalFailed': {
            const cells = state.cells.map((c, i) => i === action.toIndex
                ? { ...c, result: action.message, isError: true, hasResult: true }
                : c);
            return { ...state, cells, computing: -1, evalUpTo: action.toIndex };
        }
        case 'workerKilled':
            return { ...state, computing: -1 };
        // 'run' and 'killWorker' are side-effect-only — no state change in reducer.
        case 'run':
        case 'killWorker':
            return state;
    }
}
export class Store {
    constructor(initial = INITIAL_STATE) {
        this.listeners = new Set();
        this.worker = null;
        this.pendingResolve = null;
        this.pendingId = null;
        this.evalIdCounter = 0;
        this.state = initial;
    }
    getState() {
        return this.state;
    }
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    setState(next) {
        if (next === this.state)
            return;
        this.state = next;
        for (const fn of this.listeners)
            fn(next);
    }
    // Apply reducer, then handle side effects for the action.
    dispatch(action) {
        const prev = this.state;
        this.setState(reduce(prev, action));
        // Side effects
        switch (action.type) {
            case 'run':
                this.requestEval(action.index);
                break;
            case 'runAndAdvance':
                this.requestEval(action.index);
                break;
            case 'killWorker':
                this.doKillWorker();
                break;
        }
    }
    // ── Worker lifecycle ────────────────────────────────────────────
    boot() {
        this.spawnWorker();
    }
    spawnWorker() {
        this.worker = new Worker('worker.js');
        this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
    }
    onWorkerMessage(msg) {
        if (msg.type === 'ready') {
            this.dispatch({ type: 'workerReady' });
        }
        else if (msg.type === 'result' || msg.type === 'error') {
            if (msg.id !== this.pendingId)
                return;
            if (this.pendingResolve)
                this.pendingResolve(msg);
            this.pendingResolve = null;
            this.pendingId = null;
        }
    }
    doKillWorker() {
        if (this.worker)
            this.worker.terminate();
        this.pendingResolve = null;
        this.pendingId = null;
        this.dispatch({ type: 'workerKilled' });
        this.spawnWorker();
    }
    sendEval(codeCells) {
        return new Promise(resolve => {
            const id = ++this.evalIdCounter;
            this.pendingId = id;
            this.pendingResolve = resolve;
            this.worker.postMessage({ type: 'eval', id, cells: codeCells });
        });
    }
    async requestEval(toIndex) {
        if (this.state.computing >= 0)
            return;
        this.dispatch({ type: 'evalStarted', toIndex });
        const prefix = this.state.cells.slice(0, toIndex + 1).map(c => c.code);
        const msg = await this.sendEval(prefix);
        if (msg.type === 'result') {
            this.dispatch({ type: 'evalDone', results: msg.results });
        }
        else {
            this.dispatch({ type: 'evalFailed', toIndex, message: msg.message });
        }
    }
}
