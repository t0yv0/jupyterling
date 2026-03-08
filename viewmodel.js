// ── Cell & Notebook State ───────────────────────────────────────────
export function freshCell() {
    return { code: '', result: '', hasResult: false, isError: false };
}
export const INITIAL_STATE = {
    cells: [freshCell()],
    selected: 0,
    evalUpTo: -1,
    computing: -1,
    target: -1,
    worker: 'booting',
};
// ── Pure Reducer ────────────────────────────────────────────────────
// Every state transition is here. No side effects.
export function reduce(state, action) {
    switch (action.type) {
        case 'workerBooting':
            return { ...state, worker: 'booting', computing: -1, target: -1 };
        case 'workerReady':
            return { ...state, worker: 'ready' };
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
            const nextIdx = action.index + 1;
            if (nextIdx >= state.cells.length) {
                const cells = [...state.cells, freshCell()];
                return { ...state, cells, selected: nextIdx };
            }
            return { ...state, selected: nextIdx };
        }
        case 'evalStarted':
            return { ...state, computing: action.cellIndex, target: action.target };
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
            const evalUpTo = action.results.length - 1;
            // If we've reached the target (or error stopped us short), clear both.
            // Otherwise the Store will continue creeping.
            const reachedTarget = evalUpTo >= state.target;
            const hasError = action.results.length > 0 &&
                action.results[action.results.length - 1].error != null;
            const done = reachedTarget || hasError;
            return {
                ...state,
                cells,
                computing: done ? -1 : state.computing,
                target: done ? -1 : state.target,
                evalUpTo,
            };
        }
        case 'evalFailed': {
            const cells = state.cells.map((c, i) => i === action.cellIndex
                ? { ...c, result: action.message, isError: true, hasResult: true }
                : c);
            return { ...state, cells, computing: -1, target: -1, evalUpTo: action.cellIndex };
        }
        // Side-effect-only actions — no state change in reducer.
        case 'run':
        case 'killWorker':
            return state;
    }
}
export class Store {
    constructor(initial = INITIAL_STATE) {
        this.listeners = new Set();
        // Worker handle + pending RPC slot
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
    emit() {
        for (const fn of this.listeners)
            fn(this.state);
    }
    dispatch(action) {
        const next = reduce(this.state, action);
        if (next !== this.state) {
            this.state = next;
            this.emit();
        }
        // Side effects
        switch (action.type) {
            case 'run':
                this.runTo(action.index);
                break;
            case 'runAndAdvance':
                this.runTo(action.index);
                break;
            case 'killWorker':
                this.killAndRespawn();
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
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            this.pendingId = null;
            if (resolve)
                resolve(msg);
        }
    }
    killAndRespawn() {
        if (this.worker)
            this.worker.terminate();
        this.pendingResolve = null;
        this.pendingId = null;
        this.worker = null;
        this.dispatch({ type: 'workerBooting' });
        this.spawnWorker();
    }
    waitForReady() {
        if (this.state.worker === 'ready')
            return Promise.resolve();
        return new Promise(resolve => {
            const unsub = this.subscribe(s => {
                if (s.worker === 'ready') {
                    unsub();
                    resolve();
                }
            });
        });
    }
    sendEval(codeCells) {
        return new Promise(resolve => {
            const id = ++this.evalIdCounter;
            this.pendingId = id;
            this.pendingResolve = resolve;
            this.worker.postMessage({ type: 'eval', id, cells: codeCells });
        });
    }
    // Creep from evalUpTo+1 toward targetIndex, one cell at a time.
    async runTo(targetIndex) {
        if (this.state.computing >= 0) {
            this.killAndRespawn();
        }
        await this.waitForReady();
        let step = this.state.evalUpTo + 1;
        while (step <= targetIndex) {
            this.dispatch({ type: 'evalStarted', cellIndex: step, target: targetIndex });
            const prefix = this.state.cells.slice(0, step + 1).map(c => c.code);
            const msg = await this.sendEval(prefix);
            if (msg.type === 'result') {
                this.dispatch({ type: 'evalDone', results: msg.results });
            }
            else {
                this.dispatch({ type: 'evalFailed', cellIndex: step, message: msg.message });
                return;
            }
            // Stop if evalDone detected an error in results
            if (this.state.target < 0)
                return;
            step = this.state.evalUpTo + 1;
        }
    }
}
