// Salience — "how much does this element matter to a user trying to act here?"
//
// Inputs the LLM cannot see (pixel rect, viewport overlap, visual area)
// are folded into a single 0..1 score. We do NOT reason about colors or
// pixels — only geometry and accessibility data.

import type { Affordance, SemanticRole } from './types';

interface SalienceInput {
  rect: DOMRect;
  region: Affordance['region'];
  in_viewport: boolean;
  near_viewport: boolean;
  role: SemanticRole;
  confidence: number;
  has_aria_label: boolean;
  has_visible_text: boolean;
  is_disabled: boolean;
}

/** Base salience by role — a "primary CTA" is intrinsically more important than a nav link. */
const ROLE_WEIGHT: Record<SemanticRole, number> = {
  search_input: 0.9,
  primary_cta: 0.92,
  result_link: 0.78,
  media_tile: 0.78,
  submit: 0.78,
  login: 0.7,
  signup: 0.7,
  accept_cookies: 0.95, // overrides everything when present — must be cleared first
  dismiss: 0.4,
  secondary_cta: 0.45,
  pagination: 0.5,
  dropdown: 0.45,
  tab: 0.5,
  play_control: 0.6,
  form_field: 0.55,
  nav_link: 0.2,
  link: 0.25,
  other: 0.15,
};

export function scoreSalience(input: SalienceInput): number {
  const base = ROLE_WEIGHT[input.role] ?? 0.2;

  // Geometry — bigger visible elements win, but only up to a saturating cap.
  const area = Math.max(0, input.rect.width * input.rect.height);
  const areaScore = Math.min(1, Math.sqrt(area) / 320); // 100x100 ≈ 0.31, 320x320 ≈ 1

  // Position — top of viewport beats bottom; in-viewport beats off-screen.
  const positionScore = input.in_viewport ? 1 : input.near_viewport ? 0.55 : 0.15;
  const verticalBias = (() => {
    const vh = window.innerHeight || 800;
    const top = input.rect.top;
    if (top < 0) return 0.5;
    return Math.max(0, 1 - top / (vh * 1.5));
  })();

  // Region — main content matters more than chrome.
  const regionMul =
    input.region === 'main'
      ? 1
      : input.region === 'overlay'
        ? 1.05
        : input.region === 'header' || input.region === 'sidebar'
          ? 0.7
          : input.region === 'footer'
            ? 0.4
            : 0.85;

  // Accessibility — labelled elements are more trustworthy targets.
  const a11y = (input.has_aria_label ? 0.05 : 0) + (input.has_visible_text ? 0.05 : 0);

  // Disabled elements should rarely be picked.
  const disabledPenalty = input.is_disabled ? 0.4 : 1;

  const raw =
    (base * 0.55 + areaScore * 0.15 + positionScore * 0.18 + verticalBias * 0.07 + a11y) *
    regionMul *
    disabledPenalty *
    // Confidence in the role assignment dampens uncertain classifications.
    (0.6 + 0.4 * input.confidence);

  return Math.max(0, Math.min(1, raw));
}
