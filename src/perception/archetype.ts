// Archetype + workflow phase derivation.
//
// Pure function of the affordance ranking + page chrome. We don't try to be
// exhaustive — we pick the archetype that best explains the current shape
// of the page, which the planner can use to decide its next move.

import type {
  Affordance,
  PageArchetype,
  WorkflowPhase,
  SemanticRole,
} from './types';

interface Counts extends Partial<Record<SemanticRole, number>> {}

function count(affordances: Affordance[]): Counts {
  const c: Counts = {};
  for (const a of affordances) c[a.role] = (c[a.role] ?? 0) + 1;
  return c;
}

export interface ArchetypeResult {
  archetype: PageArchetype;
  workflow_phase: WorkflowPhase;
  /** Cookie/paywall/captcha-style overlay present? */
  blocked_by_overlay: boolean;
  /** affordances[].id that should be the next action, if obvious. */
  primary_action_id?: string;
  /** Suggested next-step strings (≤3, plain English). */
  suggested_next_steps: string[];
  /** One-line summary of what this page is. */
  summary: string;
}

function pickPrimary(
  affordances: Affordance[],
  prefer: SemanticRole[],
): Affordance | undefined {
  for (const role of prefer) {
    const hits = affordances.filter((a) => a.role === role);
    if (hits.length > 0) {
      // Top-salience for this role.
      return hits.reduce((best, cur) => (cur.salience > best.salience ? cur : best));
    }
  }
  return undefined;
}

export function deriveArchetype(
  affordances: Affordance[],
  url: string,
  title: string,
): ArchetypeResult {
  const counts = count(affordances);
  const blocked = (counts.accept_cookies ?? 0) > 0;

  // Cookie/consent overlay always wins — the user can't act until it's cleared.
  if (blocked) {
    const cta = pickPrimary(affordances, ['accept_cookies']);
    return {
      archetype: 'unknown',
      workflow_phase: 'blocked',
      blocked_by_overlay: true,
      primary_action_id: cta?.id,
      summary: 'A cookie or consent banner is blocking the page.',
      suggested_next_steps: [
        'Dismiss the consent banner before continuing.',
        'Click "Accept" or "Reject all" to unblock.',
      ],
    };
  }

  const isYouTubeWatch = /\/watch(\?|$)/i.test(url) || /youtube\.com.*watch/i.test(url);
  const isYouTubeResults = /youtube\.com\/results/i.test(url);
  const hasResults = (counts.result_link ?? 0) + (counts.media_tile ?? 0) >= 3;
  const hasSearch = (counts.search_input ?? 0) > 0;
  const formFields = counts.form_field ?? 0;
  const hasLogin = (counts.login ?? 0) > 0 || (counts.signup ?? 0) > 0;
  const hasPlay = (counts.play_control ?? 0) > 0;

  // Watch / video.
  if (isYouTubeWatch || hasPlay) {
    const cta = pickPrimary(affordances, ['play_control', 'primary_cta']);
    return {
      archetype: 'video_watch',
      workflow_phase: 'consuming',
      blocked_by_overlay: false,
      primary_action_id: cta?.id,
      summary: 'A video page — playback controls available.',
      suggested_next_steps: [
        'Confirm the video is playing.',
        cta ? `Use "${cta.label}" if playback didn't start.` : 'Wait for playback to start.',
      ],
    };
  }

  // Search results.
  if (isYouTubeResults || hasResults) {
    const cta = pickPrimary(affordances, ['media_tile', 'result_link']);
    return {
      archetype: 'search_results',
      workflow_phase: 'browsing_results',
      blocked_by_overlay: false,
      primary_action_id: cta?.id,
      summary: 'A results listing — pick one to drill in.',
      suggested_next_steps: [
        cta ? `Open the top result: "${cta.label}".` : 'Open the most relevant result.',
        'Refine the search if no result matches.',
      ],
    };
  }

  // Auth / login.
  if (hasLogin && formFields >= 1 && formFields <= 4) {
    const cta = pickPrimary(affordances, ['submit', 'login', 'signup', 'primary_cta']);
    return {
      archetype: 'auth',
      workflow_phase: 'authenticating',
      blocked_by_overlay: false,
      primary_action_id: cta?.id,
      summary: 'A sign-in or sign-up surface.',
      suggested_next_steps: [
        'Fill credentials, then submit.',
        'Cancel if authentication is not desired.',
      ],
    };
  }

  // Form-heavy page.
  if (formFields >= 3) {
    const cta = pickPrimary(affordances, ['submit', 'primary_cta']);
    return {
      archetype: 'form',
      workflow_phase: 'filling_form',
      blocked_by_overlay: false,
      primary_action_id: cta?.id,
      summary: 'A form with multiple fields — fill, then submit.',
      suggested_next_steps: ['Fill required fields.', 'Submit when complete.'],
    };
  }

  // Search-only page (e.g. google.com home).
  if (hasSearch && (counts.search_input ?? 0) === 1 && !hasResults) {
    const cta = pickPrimary(affordances, ['search_input']);
    return {
      archetype: 'home',
      workflow_phase: 'searching',
      blocked_by_overlay: false,
      primary_action_id: cta?.id,
      summary: `A search-driven entry point: ${stripTitle(title)}.`,
      suggested_next_steps: [
        cta ? `Type the query into "${cta.label}".` : 'Type the query into the search box.',
        'Press Enter to submit.',
      ],
    };
  }

  // Article / content view.
  if ((counts.link ?? 0) + (counts.nav_link ?? 0) > 0 && (counts.result_link ?? 0) <= 2) {
    return {
      archetype: 'article',
      workflow_phase: 'consuming',
      blocked_by_overlay: false,
      primary_action_id: pickPrimary(affordances, ['primary_cta', 'submit'])?.id,
      summary: `An article-style page: ${stripTitle(title)}.`,
      suggested_next_steps: ['Read or scroll for more.', 'Follow a related link if needed.'],
    };
  }

  // Fallback.
  const cta = pickPrimary(affordances, [
    'primary_cta',
    'search_input',
    'submit',
    'result_link',
    'media_tile',
  ]);
  return {
    archetype: 'unknown',
    workflow_phase: 'discovery',
    blocked_by_overlay: false,
    primary_action_id: cta?.id,
    summary: stripTitle(title) || url,
    suggested_next_steps: cta
      ? [`Try the most prominent action: "${cta.label}".`]
      : ['Inspect the page for the most prominent action.'],
  };
}

function stripTitle(title: string): string {
  return (title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
