// Semantic dedupe — collapses elements that mean the same thing to a user.
//
// The two big offenders:
//   1. SPAs that render duplicate copies of header search boxes (mobile drawer
//      + desktop bar), or duplicate "Log in" buttons (header + drop menu).
//   2. Result lists that expose the same href via wrapper anchors and inner
//      title anchors. We want one row per href.
//
// Strategy: bucket affordances by (role + normalized label + href || size class),
// then keep the highest-salience candidate per bucket.

import type { Affordance } from './types';

function normalizeLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .slice(0, 60);
}

function bucketKey(a: Affordance): string {
  // Result-links/media-tiles dedupe by href since the visible label varies.
  if ((a.role === 'result_link' || a.role === 'media_tile' || a.role === 'link' || a.role === 'nav_link') && a.href) {
    return `${a.role}::href::${a.href}`;
  }
  // Form fields dedupe by name+role since duplicate inputs are usually mobile/desktop pairs.
  if (a.role === 'form_field' || a.role === 'search_input') {
    const key = a.tag + '|' + (a.input_type || '') + '|' + normalizeLabel(a.label);
    return `${a.role}::field::${key}`;
  }
  // Buttons / CTAs dedupe by role + label.
  return `${a.role}::label::${normalizeLabel(a.label)}`;
}

export function dedupe(affordances: Affordance[]): Affordance[] {
  const buckets = new Map<string, Affordance>();
  for (const a of affordances) {
    const key = bucketKey(a);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, a);
      continue;
    }
    // Keep the more salient one; prefer in-viewport on tie.
    if (
      a.salience > existing.salience ||
      (Math.abs(a.salience - existing.salience) < 0.02 && a.in_viewport && !existing.in_viewport)
    ) {
      buckets.set(key, a);
    }
  }
  return Array.from(buckets.values());
}
