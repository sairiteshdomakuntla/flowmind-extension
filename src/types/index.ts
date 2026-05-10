export type ActionType =
  | 'click'
  | 'click_result'
  | 'type'
  | 'press_key'
  | 'scroll'
  | 'navigate'
  | 'extract'
  | 'wait'
  | 'open_tab'
  | 'switch_tab'
  | 'finish';

export interface AgentAction {
  action: ActionType;
  selector?: string;
  /** Visible text or aria-label of the target element (fallback when selector breaks). */
  target_text?: string;
  /** ARIA role (e.g. "button", "link") narrows text-based search. */
  target_role?: string;
  value?: string;
  description: string;
  reasoning?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: AgentAction[];
  estimated_steps: number;
  requires_multiple_tabs: boolean;
  /** ReAct loop: when true, executor stops after this batch (goal achieved). */
  goal_complete?: boolean;
  /** Brief reasoning the model emits each iteration (optional). */
  thought?: string;
}

export interface StepRecord {
  action: AgentAction;
  ok: boolean;
  error?: string;
  extracted?: string;
  url_after: string;
}

export interface ExecutionResult {
  success: boolean;
  steps_completed: number;
  steps_failed: number;
  summary: string;
  errors: string[];
}

export interface DOMSnapshot {
  url: string;
  title: string;
  interactive_elements: {
    tag: string;
    type?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    text?: string;
    aria_label?: string;
    role?: string;
    selector: string;
    visible: boolean;
  }[];
  page_text_summary: string;
  /**
   * Extracted content/media links (video titles, article headings, etc.).
   * Populated by the DOM analyzer when it detects results pages.
   * Gives the agent a reliable list to click even if the interactive_elements
   * cap truncated them.
   */
  media_links?: { title: string; href: string; selector: string }[];
  /**
   * Action-centric semantic model produced by the perception engine.
   * Imported lazily to avoid a cycle with the types module.
   */
  page_model?: import('../perception/types').PageModel;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  resume_text: string;
  writing_style: string;
  custom_instructions: string;
}

export interface WorkflowRun {
  ts: number;
  outcome: 'success' | 'partial' | 'failed';
  failed_step?: number;
  reason?: string;
  duration_ms: number;
}

export interface WorkflowMemory {
  id: string;
  trigger: string;
  /** Alternative phrasings the user has used for this workflow. */
  pattern: string[];
  domain: string;
  actions: AgentAction[];
  /** Schema version — bump when shape changes so loaders can migrate. */
  version: number;
  created_at: number;
  last_run: number;
  run_count: number;
  /** Rolling success rate across the last 10 runs (0..1). */
  success_rate: number;
  /** Recent failure reasons, deduped, capped at 5. */
  failure_reasons: string[];
  /** Inferred preferences (stable values) keyed by selector. */
  preferences: Record<string, string>;
  /** Per-run history, capped at 20 newest. */
  history: WorkflowRun[];
  last_outcome?: WorkflowRun['outcome'];
}

/** Result of perception-driven element resolution. */
export interface ResolvedAction {
  affordance_id?: string;
  selector: string;
}

export type ExecutorMode = 'agentic' | 'replay';

export interface ExecutorRunOptions {
  mode?: ExecutorMode;
  workflow?: WorkflowMemory;
}

export interface SnapshotCacheEntry {
  key: string;
  snapshot: DOMSnapshot;
  ts: number;
}

/**
 * Thrown when perception has no remaining alternates above the
 * confidence threshold — the executor should re-think via Gemini
 * rather than burn more local retries.
 */
export class LowConfidenceError extends Error {
  readonly kind = 'low_confidence' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LowConfidenceError';
  }
}

export interface AgentEvent {
  type:
    | 'step_start'
    | 'step_complete'
    | 'step_error'
    | 'plan_ready'
    | 'done'
    | 'paused'
    | 'log';
  step?: AgentAction;
  step_index?: number;
  total_steps?: number;
  message?: string;
  result?: ExecutionResult;
  /** Selector that was actually resolved/used at runtime (for highlight). */
  resolved_selector?: string;
}

export interface PendingPlan {
  intent: string;
  plan: ExecutionPlan;
  next_step: number;
  origin_url: string;
  /** Wall-clock ms; we drop the plan if it's older than ~5 minutes. */
  stored_at: number;
}