// ── Cell & Notebook State ───────────────────────────────────────────

export interface CellState {
  readonly code: string;
  readonly result: string;
  readonly hasResult: boolean;
  readonly isError: boolean;
}

export type WorkerStatus = 'booting' | 'ready';

export interface AppState {
  readonly cells: readonly CellState[];
  readonly selected: number;
  readonly evalUpTo: number;       // cells[0..evalUpTo] have fresh results
  readonly computing: number;      // index of cell being computed, or -1
  readonly worker: WorkerStatus;
}

export function freshCell(): CellState {
  return { code: '', result: '', hasResult: false, isError: false };
}

export const INITIAL_STATE: AppState = {
  cells: [freshCell()],
  selected: 0,
  evalUpTo: -1,
  computing: -1,
  worker: 'booting',
};

// ── Actions ─────────────────────────────────────────────────────────

export type UserAction =
  | { type: 'setCode';        index: number; code: string }
  | { type: 'select';         index: number }
  | { type: 'selectUp' }
  | { type: 'selectDown' }
  | { type: 'deleteCell';     index: number }
  | { type: 'addCell' }
  | { type: 'run';            index: number }
  | { type: 'runAndAdvance';  index: number }
  | { type: 'killWorker' };

export type InternalAction =
  | { type: 'workerBooting' }
  | { type: 'workerReady' }
  | { type: 'evalStarted';  toIndex: number }
  | { type: 'evalDone';     results: readonly EvalResultItem[] }
  | { type: 'evalFailed';   toIndex: number; message: string };

export type Action = UserAction | InternalAction;

export interface EvalResultItem {
  readonly text?: string;
  readonly error?: string;
}

// ── Pure Reducer ────────────────────────────────────────────────────
// Every state transition is here. No side effects.

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {

    case 'workerBooting':
      return { ...state, worker: 'booting', computing: -1 };

    case 'workerReady':
      return { ...state, worker: 'ready' };

    case 'setCode': {
      const cells = state.cells.map((c, i) =>
        i === action.index ? { ...c, code: action.code } : c);
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
        if (i >= action.results.length) return c;
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
      const cells = state.cells.map((c, i) =>
        i === action.toIndex
          ? { ...c, result: action.message, isError: true, hasResult: true }
          : c);
      return { ...state, cells, computing: -1, evalUpTo: action.toIndex };
    }

    // Side-effect-only actions — no state change in reducer.
    case 'run':
    case 'killWorker':
      return state;
  }
}

// ── Store ───────────────────────────────────────────────────────────
// Wraps the pure reducer with worker side effects.

export type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  // Worker handle + pending RPC slot
  private worker: Worker | null = null;
  private pendingResolve: ((msg: any) => void) | null = null;
  private pendingId: number | null = null;
  private evalIdCounter = 0;

  constructor(initial: AppState = INITIAL_STATE) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  dispatch(action: Action): void {
    const next = reduce(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.emit();
    }

    // Side effects
    switch (action.type) {
      case 'run':
        this.requestEval(action.index);
        break;
      case 'runAndAdvance':
        this.requestEval(action.index);
        break;
      case 'killWorker':
        this.killAndRespawn();
        break;
    }
  }

  // ── Worker lifecycle ────────────────────────────────────────────

  boot(): void {
    this.spawnWorker();
  }

  private spawnWorker(): void {
    this.worker = new Worker('worker.js');
    this.worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data);
  }

  private onWorkerMessage(msg: any): void {
    if (msg.type === 'ready') {
      this.dispatch({ type: 'workerReady' });
    } else if (msg.type === 'result' || msg.type === 'error') {
      if (msg.id !== this.pendingId) return;
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingId = null;
      if (resolve) resolve(msg);
    }
  }

  private killAndRespawn(): void {
    if (this.worker) this.worker.terminate();
    this.pendingResolve = null;
    this.pendingId = null;
    this.worker = null;
    this.dispatch({ type: 'workerBooting' });
    this.spawnWorker();
  }

  private waitForReady(): Promise<void> {
    if (this.state.worker === 'ready') return Promise.resolve();
    return new Promise<void>(resolve => {
      const unsub = this.subscribe(s => {
        if (s.worker === 'ready') { unsub(); resolve(); }
      });
    });
  }

  private sendEval(codeCells: string[]): Promise<any> {
    return new Promise(resolve => {
      const id = ++this.evalIdCounter;
      this.pendingId = id;
      this.pendingResolve = resolve;
      this.worker!.postMessage({ type: 'eval', id, cells: codeCells });
    });
  }

  private async requestEval(toIndex: number): Promise<void> {
    if (this.state.computing >= 0) {
      this.killAndRespawn();
    }

    await this.waitForReady();

    this.dispatch({ type: 'evalStarted', toIndex });

    const prefix = this.state.cells.slice(0, toIndex + 1).map(c => c.code);
    const msg = await this.sendEval(prefix);

    if (msg.type === 'result') {
      this.dispatch({ type: 'evalDone', results: msg.results });
    } else {
      this.dispatch({ type: 'evalFailed', toIndex, message: msg.message });
    }
  }
}
