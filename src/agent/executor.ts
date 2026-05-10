import type {
  AgentAction,
  AgentEvent,
  ExecutionPlan,
  ExecutionResult,
  ExecutorMode,
  PendingPlan,
  StepRecord,
  WorkflowMemory,
  WorkflowRun,
} from '../types';
import { LowConfidenceError } from '../types';
import { analyzeDom } from './dom-analyzer';
import { generateExecutionPlan } from './gemini-client';
import { runAction } from './action-runner';
import { loadProfile } from '../context/user-profile';
import { recordRun } from '../memory/workflow-store';
import type { DOMSnapshot } from '../types';

const STEP_GAP_MS = 600;
const PENDING_PLAN_KEY = 'flowmind_pending_plan';
const PENDING_PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_ITERATIONS = 12;
const MAX_HISTORY = 16;

export type AgentEventListener = (event: AgentEvent) => void;

interface RunState {
  intent: string;
  history: StepRecord[];
  goal: string;
  totalSteps: number; // running tally (not a fixed plan length)
  completedSteps: number;
  failedSteps: number;
  errors: string[];
  startedAt: number;
  matchedWorkflowId?: string;
  mode: ExecutorMode;
  workflow?: WorkflowMemory;
  /** Index of the next replay action to feed into runBatch. */
  replayCursor: number;
  /** Bumps when a replay step failed via fallback — second failure escalates. */
  replayFailures: number;
}

export interface RunOptions {
  /** When set, the run's outcome is appended to this workflow's history. */
  workflow?: WorkflowMemory;
  /** "replay" feeds the workflow's recorded actions directly, skipping Gemini. */
  mode?: ExecutorMode;
}

const REPLAY_CHUNK = 3;
const MAX_REPLAY_FALLBACK_FAILS = 1;

export class Executor extends EventTarget {
  private paused = false;
  private stopped = false;
  private running = false;
  private abortCtrl: AbortController | null = null;

  emit(event: AgentEvent): void {
    this.dispatchEvent(new CustomEvent<AgentEvent>('agent', { detail: event }));
  }

  on(listener: AgentEventListener): () => void {
    const handler = (e: Event) => listener((e as CustomEvent<AgentEvent>).detail);
    this.addEventListener('agent', handler);
    return () => this.removeEventListener('agent', handler);
  }

  pause(): void {
    this.paused = true;
    this.emit({ type: 'paused', message: 'Execution paused.' });
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    // Abort any in-flight sleeps, API calls, and DOM polling immediately.
    if (this.abortCtrl) {
      this.abortCtrl.abort();
      this.abortCtrl = null;
    }
    void clearPendingPlan();
    // Emit done immediately so the UI updates without waiting for
    // the runLoop to naturally exit.
    if (this.running) {
      this.running = false;
      this.emit({
        type: 'done',
        message: 'Stopped by user.',
        result: {
          success: false,
          steps_completed: 0,
          steps_failed: 0,
          summary: 'Stopped by user.',
          errors: [],
        },
      });
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Throws if the abort signal has fired. */
  private throwIfStopped(): void {
    if (this.stopped) throw new StopSignal();
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await this.sleep(100);
    }
    this.throwIfStopped();
  }

  /**
   * Abortable sleep: resolves early if the abort signal fires.
   * This is the key to making stop() feel instant.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped) { resolve(); return; }
      const timer = setTimeout(resolve, ms);
      const signal = this.abortCtrl?.signal;
      if (signal) {
        const onAbort = () => { clearTimeout(timer); resolve(); };
        if (signal.aborted) { clearTimeout(timer); resolve(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** Plan + run iteratively until goal_complete or max iterations. */
  async run(intent: string, opts: RunOptions = {}): Promise<ExecutionResult> {
    if (this.running) return failResult('Executor is already running.');

    this.running = true;
    this.paused = false;
    this.stopped = false;
    this.abortCtrl = new AbortController();

    const mode: ExecutorMode =
      opts.mode === 'replay' && opts.workflow ? 'replay' : 'agentic';

    const state: RunState = {
      intent,
      history: [],
      goal: intent,
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      errors: [],
      startedAt: Date.now(),
      matchedWorkflowId: opts.workflow?.id,
      mode,
      workflow: opts.workflow,
      replayCursor: 0,
      replayFailures: 0,
    };

    return await this.runLoop(state);
  }

  /** Resume after a navigation: history + intent are restored from storage. */
  async resumePlan(pending: PendingPlan): Promise<ExecutionResult> {
    if (this.running) return failResult('Executor is already running.');
    this.running = true;
    this.paused = false;
    this.stopped = false;
    this.abortCtrl = new AbortController();

    const history = (pending as PendingPlan & { history?: StepRecord[] }).history ?? [];
    const state: RunState = {
      intent: pending.intent,
      history,
      goal: pending.plan.goal || pending.intent,
      totalSteps: history.length,
      completedSteps: history.filter((h) => h.ok).length,
      failedSteps: history.filter((h) => !h.ok).length,
      errors: history.filter((h) => !h.ok).map((h) => h.error || 'unknown'),
      startedAt: Date.now(),
      mode: 'agentic',
      replayCursor: 0,
      replayFailures: 0,
    };

    this.emit({
      type: 'log',
      message: `Resumed after navigation (${history.length} prior steps).`,
    });

    return await this.runLoop(state);
  }

  private async runLoop(state: RunState): Promise<ExecutionResult> {
    let iteration = 0;
    let goalComplete = false;
    let firstPlanEmitted = false;

    try {
      while (iteration < MAX_ITERATIONS) {
        this.throwIfStopped();
        await this.waitWhilePaused();
        this.throwIfStopped();

        // ── Replay path: feed recorded actions directly, no Gemini call.
        if (state.mode === 'replay' && state.workflow) {
          const all = state.workflow.actions;
          if (state.replayCursor >= all.length) {
            goalComplete = true;
            break;
          }
          if (!firstPlanEmitted) {
            firstPlanEmitted = true;
            state.goal = state.workflow.trigger || state.intent;
            this.emit({
              type: 'plan_ready',
              message: state.goal,
              total_steps: all.length,
            });
            this.emit({ type: 'log', message: `▶ Replaying recorded workflow (${all.length} steps)` });
          }
          const slice = all.slice(state.replayCursor, state.replayCursor + REPLAY_CHUNK);
          const beforeFailed = state.failedSteps;
          const navigated = await this.runBatch(state, slice);
          const stepsConsumed = state.failedSteps > beforeFailed ? slice.length - 1 : slice.length;
          state.replayCursor += Math.max(stepsConsumed, 0);
          iteration += 1;

          if (state.failedSteps > beforeFailed) {
            // Stage 1 fallback already tried perception alternates. Escalate
            // to agentic mode after one such failure so Gemini can re-plan
            // from the current page state, preserving prior history.
            state.replayFailures += 1;
            if (state.replayFailures > MAX_REPLAY_FALLBACK_FAILS) {
              this.emit({
                type: 'log',
                message: '⚠ Replay step failed — escalating to live planning.',
              });
              state.mode = 'agentic';
              firstPlanEmitted = false; // re-emit a fresh plan_ready for the agentic phase
              continue;
            }
          }

          if (navigated) {
            await this.sleep(2000);
            this.emit({ type: 'log', message: 'Replay continuing after navigation…' });
          }
          continue;
        }

        // 1. Observe — fresh DOM snapshot.
        await this.sleep(150);
        this.throwIfStopped();
        const dom = analyzeDom();
        const profile = await loadProfile();

        // 1b. Fast path — if perception's primary action is unambiguous and
        // matches the user's intent, run it without burning a Gemini call.
        const fast = tryFastNextStep(dom, state);
        if (fast) {
          if (!firstPlanEmitted) {
            firstPlanEmitted = true;
            this.emit({
              type: 'plan_ready',
              message: state.goal,
              total_steps: 1,
            });
          }
          this.emit({
            type: 'log',
            message: `⚡ skipped think (fast path) → ${fast.description}`,
          });
          const navigated = await this.runBatch(state, [fast]);
          if (navigated) {
            await this.sleep(2000);
          }
          // Fast steps don't burn the iteration budget — they're free.
          continue;
        }

        // 2. Think — ask Gemini for next batch.
        let plan: ExecutionPlan;
        try {
          this.throwIfStopped();
          plan = await generateExecutionPlan(
            state.intent,
            dom,
            profile,
            state.history.slice(-MAX_HISTORY),
          );
          this.throwIfStopped();
        } catch (err) {
          if (err instanceof StopSignal) throw err;
          const msg = (err as Error).message;
          state.errors.push(`Planning: ${msg}`);
          const result: ExecutionResult = {
            success: false,
            steps_completed: state.completedSteps,
            steps_failed: state.failedSteps + 1,
            summary: `Planning failed: ${msg}`,
            errors: state.errors,
          };
          this.emit({ type: 'done', result, message: result.summary });
          this.running = false;
          await clearPendingPlan();
          await this.recordWorkflowOutcome(state, 'failed', msg);
          return result;
        }

        if (plan.goal) state.goal = plan.goal;

        if (!firstPlanEmitted) {
          firstPlanEmitted = true;
          this.emit({
            type: 'plan_ready',
            message: state.goal,
            total_steps: plan.steps.length,
          });
        } else if (plan.thought) {
          this.emit({ type: 'log', message: `🧠 ${plan.thought}` });
        }

        // 3. Stop conditions.
        if (plan.goal_complete) {
          goalComplete = true;
          break;
        }
        if (plan.steps.length === 0) {
          state.errors.push('Model returned no steps and did not mark goal complete.');
          break;
        }

        // 4. Act — run the batch.
        const navigated = await this.runBatch(state, plan.steps);
        iteration += 1;

        if (navigated) {
          // Save a safety-net plan in case this is a full-page navigation
          // (which kills the JS context). The new page's content script
          // will pick it up and resume.
          await savePendingPlan({
            intent: state.intent,
            plan: { ...plan, goal: state.goal },
            next_step: 0,
            origin_url: location.href,
            stored_at: Date.now(),
            history: state.history.slice(-MAX_HISTORY),
          } as PendingPlan & { history: StepRecord[] });

          this.emit({
            type: 'log',
            message: 'Navigation detected — waiting for page to settle…',
          });

          // Wait for the page to settle. If this is a full-page navigation,
          // the JS context dies here and the new page resumes from the saved
          // plan. If it's a SPA navigation (YouTube, Gmail, Twitter, etc.),
          // we survive this wait and continue the loop with a fresh snapshot.
          await this.sleep(2500);

          // Still alive → SPA navigation. Clear the safety-net plan and
          // continue the observe → think → act loop.
          await clearPendingPlan();
          this.emit({
            type: 'log',
            message: 'SPA navigation — continuing with fresh page state.',
          });
          // Don't increment iteration again — the loop will re-snapshot.
          continue;
        }
      }

      const result: ExecutionResult = {
        success: goalComplete && state.failedSteps === 0,
        steps_completed: state.completedSteps,
        steps_failed: state.failedSteps,
        summary: this.stopped
          ? `Stopped after ${state.completedSteps} step(s).`
          : goalComplete
            ? `Goal achieved in ${state.completedSteps} step(s).`
            : iteration >= MAX_ITERATIONS
              ? `Stopped after ${MAX_ITERATIONS} iterations without completing goal.`
              : `Stopped: ${state.errors[state.errors.length - 1] ?? 'unknown'}`,
        errors: state.errors,
      };

      await clearPendingPlan();
      // Only emit if stop() hasn't already emitted done
      if (!this.stopped) {
        this.emit({ type: 'done', result, message: result.summary });
      }
      this.running = false;
      const outcome: WorkflowRun['outcome'] = result.success
        ? 'success'
        : state.completedSteps > 0
          ? 'partial'
          : 'failed';
      await this.recordWorkflowOutcome(
        state,
        outcome,
        result.success ? undefined : state.errors[state.errors.length - 1],
      );
      return result;
    } catch (err) {
      // StopSignal is not an error — it's an expected interruption.
      if (err instanceof StopSignal) {
        this.running = false;
        return {
          success: false,
          steps_completed: state.completedSteps,
          steps_failed: state.failedSteps,
          summary: `Stopped after ${state.completedSteps} step(s).`,
          errors: state.errors,
        };
      }
      const msg = (err as Error).message;
      state.errors.push(msg);
      const result: ExecutionResult = {
        success: false,
        steps_completed: state.completedSteps,
        steps_failed: state.failedSteps + 1,
        summary: `Executor crashed: ${msg}`,
        errors: state.errors,
      };
      await clearPendingPlan();
      this.emit({ type: 'done', result, message: result.summary });
      this.running = false;
      await this.recordWorkflowOutcome(state, 'failed', msg);
      return result;
    }
  }

  private async recordWorkflowOutcome(
    state: RunState,
    outcome: WorkflowRun['outcome'],
    reason?: string,
  ): Promise<void> {
    if (!state.matchedWorkflowId) return;
    try {
      const lastFailIdx = state.history.findIndex((h) => !h.ok);
      await recordRun(state.matchedWorkflowId, {
        ts: Date.now(),
        outcome,
        failed_step: lastFailIdx >= 0 ? lastFailIdx : undefined,
        reason,
        duration_ms: Date.now() - state.startedAt,
      });
    } catch (err) {
      console.warn('[FlowMind] recordRun failed:', err);
    }
  }

  /** Run a small batch of steps. Returns true if a navigation occurred. */
  private async runBatch(state: RunState, steps: AgentAction[]): Promise<boolean> {
    for (let i = 0; i < steps.length; i++) {
      this.throwIfStopped();
      await this.waitWhilePaused();
      this.throwIfStopped();

      const step = steps[i];

      // "finish" inside a batch — skip and let caller see goal_complete next round.
      if (step.action === 'finish') continue;

      state.totalSteps += 1;
      this.emit({
        type: 'step_start',
        step,
        step_index: state.totalSteps - 1,
        total_steps: state.totalSteps,
      });

      const outcome = await this.executeStepWithRetry(step);
      this.throwIfStopped();
      const urlAfter = location.href;

      if (outcome.error) {
        state.failedSteps += 1;
        state.errors.push(`${step.action}: ${outcome.error}`);
        state.history.push({
          action: step,
          ok: false,
          error: outcome.error,
          url_after: urlAfter,
        });
        this.emit({
          type: 'step_error',
          step,
          step_index: state.totalSteps - 1,
          total_steps: state.totalSteps,
          message: outcome.error,
        });
        // Bail out of this batch — let the planner re-think with the failure in history.
        return false;
      }

      state.completedSteps += 1;
      state.history.push({
        action: step,
        ok: true,
        extracted: outcome.extracted,
        url_after: urlAfter,
      });
      this.emit({
        type: 'step_complete',
        step,
        step_index: state.totalSteps - 1,
        total_steps: state.totalSteps,
        resolved_selector: outcome.resolved_selector,
      });

      if (outcome.navigated) return true;

      if (i < steps.length - 1) await this.sleep(STEP_GAP_MS);
    }
    return false;
  }

  private async executeStepWithRetry(step: AgentAction): Promise<{
    error: string | null;
    resolved_selector?: string;
    navigated?: boolean;
    extracted?: string;
  }> {
    try {
      this.throwIfStopped();
      const r = await runAction(step);
      return {
        error: null,
        resolved_selector: r.resolved_selector,
        navigated: r.navigated,
        extracted: r.extracted,
      };
    } catch (firstErr) {
      if (firstErr instanceof StopSignal) throw firstErr;
      if (this.stopped) throw new StopSignal();
      // Perception-driven fallback already exhausted local alternates —
      // short-circuit so Gemini gets explicit failure context next loop.
      if (firstErr instanceof LowConfidenceError) {
        return { error: `LOW_CONFIDENCE: ${firstErr.message}` };
      }
      const firstMessage = (firstErr as Error).message;
      await this.sleep(400);
      if (this.stopped) throw new StopSignal();
      try {
        const r = await runAction(step);
        return {
          error: null,
          resolved_selector: r.resolved_selector,
          navigated: r.navigated,
          extracted: r.extracted,
        };
      } catch (secondErr) {
        if (secondErr instanceof StopSignal) throw secondErr;
        if (this.stopped) throw new StopSignal();
        if (secondErr instanceof LowConfidenceError) {
          return { error: `LOW_CONFIDENCE: ${secondErr.message}` };
        }
        const secondMessage = (secondErr as Error).message;
        return { error: `${firstMessage} | retry: ${secondMessage}` };
      }
    }
  }
}

/** Sentinel thrown when the user presses Stop. Not an error. */
class StopSignal {
  readonly message = 'Stopped by user.';
}

const FAST_PATH_FLOOR = 0.7;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'by',
  'is', 'are', 'be', 'this', 'that', 'it', 'find', 'show', 'me', 'please',
  'click', 'open', 'go', 'visit', 'search', 'type', 'enter', 'select', 'pick',
  'get', 'fetch', 'i', 'want', 'need',
]);

function nouns(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Returns a single-step action when perception is confident enough that we
 * don't need to ask Gemini. Only fires when:
 *   • PageModel exposes a primary_action_id
 *   • The matching affordance has confidence × salience ≥ 0.7
 *   • The user's goal text shares ≥1 noun with the affordance label
 *   • The same affordance hasn't already failed in this run
 */
function tryFastNextStep(dom: DOMSnapshot, state: RunState): AgentAction | null {
  if (state.mode === 'replay') return null;
  const m = dom.page_model;
  if (!m || !m.primary_action_id) return null;
  const aff = m.affordances.find((a) => a.id === m.primary_action_id);
  if (!aff) return null;

  const score = aff.confidence * aff.salience;
  if (score < FAST_PATH_FLOOR) return null;

  const goalNouns = nouns(state.goal || state.intent);
  if (goalNouns.size === 0) return null;
  const labelNouns = nouns(aff.label);
  let overlap = 0;
  for (const n of goalNouns) if (labelNouns.has(n)) overlap++;
  if (overlap === 0) return null;

  const failedHere = state.history.some(
    (h) => !h.ok && (h.action.selector === aff.selector || h.action.target_text === aff.label),
  );
  if (failedHere) return null;

  // Map affordance role → action.
  const isInput =
    aff.role === 'search_input' ||
    aff.role === 'form_field' ||
    aff.tag === 'input' ||
    aff.tag === 'textarea' ||
    aff.aria_role === 'textbox' ||
    aff.aria_role === 'combobox';
  if (isInput) return null; // typing needs a value the LLM has to compose.

  return {
    action: 'click',
    selector: aff.selector,
    target_text: aff.label,
    target_role: aff.aria_role || aff.tag,
    description: `Click "${aff.label.slice(0, 60)}"`,
  };
}

function failResult(summary: string, errors: string[] = []): ExecutionResult {
  return {
    success: false,
    steps_completed: 0,
    steps_failed: 0,
    summary,
    errors: errors.length ? errors : [summary],
  };
}

/* ─── pending-plan persistence ─────────────────────────────────── */

export async function savePendingPlan(
  p: PendingPlan & { history?: StepRecord[] },
): Promise<void> {
  await chrome.storage.local.set({ [PENDING_PLAN_KEY]: p });
}

export async function loadPendingPlan(): Promise<
  (PendingPlan & { history?: StepRecord[] }) | null
> {
  const r = await chrome.storage.local.get(PENDING_PLAN_KEY);
  const p = r[PENDING_PLAN_KEY] as (PendingPlan & { history?: StepRecord[] }) | undefined;
  if (!p) return null;
  if (Date.now() - p.stored_at > PENDING_PLAN_TTL_MS) {
    await clearPendingPlan();
    return null;
  }
  return p;
}

export async function clearPendingPlan(): Promise<void> {
  await chrome.storage.local.remove(PENDING_PLAN_KEY);
}

export const executor = new Executor();
