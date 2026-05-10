import type { AgentAction, WorkflowMemory, WorkflowRun } from '../types';
import { getWorkflows, saveWorkflow } from './storage';

const MATCH_THRESHOLD = 0.6;
const HISTORY_CAP = 20;
const FAILURE_REASONS_CAP = 5;
const SUCCESS_WINDOW = 10;

/**
 * Find the best workflow match for a natural-language intent.
 * Returns null when no candidate clears MATCH_THRESHOLD.
 */
export async function matchByIntent(
  intent: string,
  domain?: string,
): Promise<{ workflow: WorkflowMemory; score: number } | null> {
  const norm = normalize(intent);
  if (!norm) return null;
  const workflows = await getWorkflows();

  const candidates = domain
    ? workflows.filter((w) => !w.domain || w.domain === domain)
    : workflows;

  let best: { workflow: WorkflowMemory; score: number } | null = null;
  for (const w of candidates) {
    const phrases = [w.trigger, ...w.pattern].filter(Boolean);
    let top = 0;
    for (const p of phrases) {
      const score = trigramScore(norm, normalize(p));
      if (score > top) top = score;
    }
    if (top >= MATCH_THRESHOLD && (!best || top > best.score)) {
      best = { workflow: w, score: top };
    }
  }
  return best;
}

/** Push a run onto history, recompute rolling success_rate and failure_reasons. */
export async function recordRun(id: string, run: WorkflowRun): Promise<void> {
  const workflows = await getWorkflows();
  const w = workflows.find((x) => x.id === id);
  if (!w) return;

  const history = [...w.history, run].slice(-HISTORY_CAP);
  const window = history.slice(-SUCCESS_WINDOW);
  const successes = window.filter((r) => r.outcome === 'success').length;
  const success_rate = window.length > 0 ? successes / window.length : 0;

  let failure_reasons = w.failure_reasons;
  if (run.reason && run.outcome !== 'success') {
    failure_reasons = [run.reason, ...w.failure_reasons.filter((r) => r !== run.reason)].slice(
      0,
      FAILURE_REASONS_CAP,
    );
  }

  const next: WorkflowMemory = {
    ...w,
    history,
    success_rate,
    failure_reasons,
    last_outcome: run.outcome,
    last_run: run.ts,
    run_count: w.run_count + 1,
  };
  await saveWorkflow(next);
}

/**
 * Walk recorded actions and persist any `value` fields whose target appears
 * stable (same selector across runs). Heuristic only — no LLM.
 */
export async function inferPreferences(id: string): Promise<void> {
  const workflows = await getWorkflows();
  const w = workflows.find((x) => x.id === id);
  if (!w) return;

  const prefs: Record<string, string> = { ...w.preferences };
  for (const a of w.actions) {
    if (!a.value) continue;
    if (a.action !== 'type' && a.action !== 'navigate') continue;
    const key = a.selector || a.target_text;
    if (!key) continue;
    prefs[key] = a.value;
  }
  if (Object.keys(prefs).length === Object.keys(w.preferences).length) return;
  await saveWorkflow({ ...w, preferences: prefs });
}

/**
 * Add a new trigger phrasing if it's far enough from existing phrases.
 * Uses 1 - trigram similarity as distance; threshold is conservative
 * so near-duplicates don't bloat the pattern list.
 */
export async function addPatternVariant(id: string, phrase: string): Promise<void> {
  const norm = normalize(phrase);
  if (!norm) return;
  const workflows = await getWorkflows();
  const w = workflows.find((x) => x.id === id);
  if (!w) return;

  const existing = [w.trigger, ...w.pattern].map(normalize);
  for (const p of existing) {
    if (trigramScore(norm, p) > 0.75) return;
  }
  await saveWorkflow({ ...w, pattern: [...w.pattern, phrase].slice(0, 8) });
}

/** Build a fresh WorkflowMemory record from a recorded action sequence. */
export function makeWorkflow(opts: {
  id?: string;
  trigger: string;
  domain?: string;
  actions: AgentAction[];
}): WorkflowMemory {
  const now = Date.now();
  return {
    id: opts.id ?? `wf_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    trigger: opts.trigger,
    pattern: [opts.trigger],
    domain: opts.domain ?? '',
    actions: opts.actions,
    version: 1,
    created_at: now,
    last_run: 0,
    run_count: 0,
    success_rate: 0,
    failure_reasons: [],
    preferences: {},
    history: [],
  };
}

/* ─── helpers ──────────────────────────────────────────────────── */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Sørensen–Dice on character trigrams. Cheap and good enough. */
function trigramScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return (2 * overlap) / (ta.size + tb.size);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}
