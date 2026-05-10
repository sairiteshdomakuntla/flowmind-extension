// FlowMind — Perception Engine
//
// The perception layer turns a raw HTML page into an action-centric model
// the planner can reason about. It answers four questions:
//
//   1. What can the user DO on this page?           → affordances
//   2. What is the PRIMARY action right now?         → primary_action
//   3. Which elements MATTER most?                   → salience-ranked list
//   4. What is the page itself, semantically?        → archetype + workflow_phase
//
// The model is intentionally compact. It complements (not replaces) the raw
// interactive_elements array so existing runtime fallbacks keep working.

/** Semantic role assigned by the classifier. Drives ranking + archetype. */
export type SemanticRole =
  | 'search_input'
  | 'primary_cta'
  | 'secondary_cta'
  | 'result_link'
  | 'media_tile'
  | 'nav_link'
  | 'form_field'
  | 'submit'
  | 'login'
  | 'signup'
  | 'dismiss'
  | 'accept_cookies'
  | 'pagination'
  | 'dropdown'
  | 'tab'
  | 'play_control'
  | 'link'
  | 'other';

/** Workflow phase — hints to the planner about where in a flow we are. */
export type WorkflowPhase =
  | 'discovery' // home / landing — user hasn't started a task yet
  | 'searching' // search box visible, no results yet
  | 'browsing_results' // results / listing visible
  | 'consuming' // article / video / detail view
  | 'authenticating' // login / signup form visible
  | 'filling_form' // generic form with multiple fields
  | 'confirming' // checkout / confirm dialog
  | 'blocked' // cookie banner, paywall, captcha
  | 'unknown';

/** High-level page archetype. */
export type PageArchetype =
  | 'home'
  | 'search_results'
  | 'video_watch'
  | 'article'
  | 'listing'
  | 'product_detail'
  | 'auth'
  | 'form'
  | 'checkout'
  | 'app_dashboard'
  | 'unknown';

/** A single thing the user can do on this page. */
export interface Affordance {
  /** Stable id, generated for cross-iteration referencing. */
  id: string;
  /** Semantic role the classifier assigned. */
  role: SemanticRole;
  /** Human-readable label (aria-label > visible text > placeholder > id). */
  label: string;
  /** CSS selector that resolves to this element NOW. */
  selector: string;
  /** Lowered tag name. */
  tag: string;
  /** Native input type, when applicable (e.g. "search", "email", "password"). */
  input_type?: string;
  /** ARIA role attribute, when set. */
  aria_role?: string;
  /** Element's href (for links/anchors). */
  href?: string;
  /** Where it lives on screen, helps the planner sort logically. */
  region?: 'header' | 'main' | 'sidebar' | 'footer' | 'overlay' | 'unknown';
  /** True when the rect intersects the visible viewport. */
  in_viewport: boolean;
  /** Pixel rect (rounded) — useful for the LLM to reason about position/size. */
  rect: { x: number; y: number; w: number; h: number };
  /** 0..1 confidence the role assignment is correct. */
  confidence: number;
  /** 0..1 salience: how much this element matters to the user task. */
  salience: number;
  /** Free-form one-liner: "what does this do?" — kept short for prompt compression. */
  hint?: string;
}

export interface PageModel {
  /** "What is this page?" */
  archetype: PageArchetype;
  /** "Where am I in the workflow?" */
  workflow_phase: WorkflowPhase;
  /** One-line, human-readable summary of the page's purpose. */
  summary: string;
  /** "What is the single best next action?" — points at affordances[].id. */
  primary_action_id?: string;
  /** Ranked affordances, highest salience first. Capped to ~24. */
  affordances: Affordance[];
  /** Counts by role (post-dedupe), so the planner sees page shape at a glance. */
  role_counts: Partial<Record<SemanticRole, number>>;
  /** A short menu of suggested next steps in plain English. */
  suggested_next_steps: string[];
  /** True if a blocking overlay (cookie/paywall/captcha) is present. */
  blocked_by_overlay: boolean;
  /** Snapshot depth used (debugging / observability). */
  depth: 'compact' | 'standard' | 'deep';
}

export interface PerceptionConfig {
  /** Hard cap on affordances kept after ranking. */
  maxAffordances: number;
  /** Soft cap below which we emit `compact` depth. */
  compactThreshold: number;
  /** Hard cap above which we emit `deep` depth. */
  deepThreshold: number;
  /** Viewport padding (px) that still counts as "near-viewport" for salience. */
  viewportPad: number;
}

export const DEFAULT_PERCEPTION_CONFIG: PerceptionConfig = {
  maxAffordances: 24,
  compactThreshold: 12,
  deepThreshold: 80,
  viewportPad: 400,
};
