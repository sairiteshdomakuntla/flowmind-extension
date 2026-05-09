import type {
  AgentAction,
  AgentEvent,
  ExecutionPlan,
  ExecutionResult,
  PendingPlan,
  StepRecord,
} from '../types';
import { analyzeDom } from './dom-analyzer';
import { generateExecutionPlan } from './gemini-client';
import { runAction } from './action-runner';
import { loadProfile } from '../context/user-profile';

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
}

export class Executor extends EventTarget {
  private paused = false;
  private stopped = false;
  private running = false;

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
    void clearPendingPlan();
  }

  isRunning(): boolean {
    return this.running;
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Plan + run iteratively until goal_complete or max iterations. */
  async run(intent: string): Promise<ExecutionResult> {
    if (this.running) return failResult('Executor is already running.');

    this.running = true;
    this.paused = false;
    this.stopped = false;

    const state: RunState = {
      intent,
      history: [],
      goal: intent,
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      errors: [],
    };

    return await this.runLoop(state);
  }

  /** Resume after a navigation: history + intent are restored from storage. */
  async resumePlan(pending: PendingPlan): Promise<ExecutionResult> {
    if (this.running) return failResult('Executor is already running.');
    this.running = true;
    this.paused = false;
    this.stopped = false;

    const history = (pending as PendingPlan & { history?: StepRecord[] }).history ?? [];
    const state: RunState = {
      intent: pending.intent,
      history,
      goal: pending.plan.goal || pending.intent,
      totalSteps: history.length,
      completedSteps: history.filter((h) => h.ok).length,
      failedSteps: history.filter((h) => !h.ok).length,
      errors: history.filter((h) => !h.ok).map((h) => h.error || 'unknown'),
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
        if (this.stopped) break;
        await this.waitWhilePaused();
        if (this.stopped) break;

        // 1. Observe — fresh DOM snapshot.
        await this.sleep(150);
        const dom = analyzeDom();
        const profile = await loadProfile();

        // 2. Think — ask Gemini for next batch.
        let plan: ExecutionPlan;
        try {
          plan = await generateExecutionPlan(
            state.intent,
            dom,
            profile,
            state.history.slice(-MAX_HISTORY),
          );
        } catch (err) {
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
          // Persist and bail; resume on next page load.
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
            message: 'Navigation detected — pausing; will resume on next page.',
          });
          await this.sleep(200);
          this.running = false;
          return {
            success: false,
            steps_completed: state.completedSteps,
            steps_failed: state.failedSteps,
            summary: 'Navigating — plan will resume after page load.',
            errors: state.errors,
          };
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
      this.emit({ type: 'done', result, message: result.summary });
      this.running = false;
      return result;
    } catch (err) {
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
      return result;
    }
  }

  /** Run a small batch of steps. Returns true if a navigation occurred. */
  private async runBatch(state: RunState, steps: AgentAction[]): Promise<boolean> {
    for (let i = 0; i < steps.length; i++) {
      if (this.stopped) return false;
      await this.waitWhilePaused();
      if (this.stopped) return false;

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
      const r = await runAction(step);
      return {
        error: null,
        resolved_selector: r.resolved_selector,
        navigated: r.navigated,
        extracted: r.extracted,
      };
    } catch (firstErr) {
      const firstMessage = (firstErr as Error).message;
      await this.sleep(400);
      try {
        const r = await runAction(step);
        return {
          error: null,
          resolved_selector: r.resolved_selector,
          navigated: r.navigated,
          extracted: r.extracted,
        };
      } catch (secondErr) {
        const secondMessage = (secondErr as Error).message;
        return { error: `${firstMessage} | retry: ${secondMessage}` };
      }
    }
  }
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
