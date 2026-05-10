import type { AgentAction } from '../types';

export type LearnState = 'idle' | 'recording';

export type ActionListener = (action: AgentAction, total: number) => void;

/**
 * Coordinates a Teach-Once recording session. The state machine is
 * intentionally simple — DOM event capture is owned by `learn-listener.ts`,
 * which calls `record()` for every observed action. A future debugger
 * fallback can swap `record()` calls in without touching consumers.
 */
class LearnModeStore {
  private state: LearnState = 'idle';
  private buffer: AgentAction[] = [];
  private listeners = new Set<ActionListener>();
  private startUrl = '';

  start(): void {
    this.state = 'recording';
    this.buffer = [];
    this.startUrl = typeof location !== 'undefined' ? location.href : '';
  }

  stop(): AgentAction[] {
    this.state = 'idle';
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  /** Append a recorded action and fan out to live listeners. */
  record(action: AgentAction): void {
    if (this.state !== 'recording') return;
    // Coalesce: replace the last `type` action against the same selector
    // (debounce should already have flushed, but if a follow-up edit lands
    // we keep only the final value).
    const last = this.buffer[this.buffer.length - 1];
    if (
      last &&
      last.action === 'type' &&
      action.action === 'type' &&
      last.selector === action.selector
    ) {
      this.buffer[this.buffer.length - 1] = action;
    } else {
      this.buffer.push(action);
    }
    for (const cb of this.listeners) {
      try {
        cb(action, this.buffer.length);
      } catch {
        /* listener errors must not break recording */
      }
    }
  }

  getRecorded(): AgentAction[] {
    return [...this.buffer];
  }

  getState(): LearnState {
    return this.state;
  }

  isActive(): boolean {
    return this.state !== 'idle';
  }

  getStartUrl(): string {
    return this.startUrl;
  }

  onActionRecorded(cb: ActionListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const learnMode = new LearnModeStore();

/** Backwards-compatible class shim for older imports. */
export class LearnMode {
  start(): void {
    learnMode.start();
  }
  stop(): AgentAction[] {
    return learnMode.stop();
  }
  isActive(): boolean {
    return learnMode.isActive();
  }
}
