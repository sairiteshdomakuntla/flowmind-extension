// Snapshot orchestrator — produces a PageModel from the live DOM.
//
// Pipeline:
//   collect candidates  →  classify  →  score salience
//   →  dedupe          →  rank      →  derive archetype
//   →  emit PageModel  (depth chosen adaptively from the candidate count)

import { generateSelector } from '../agent/dom-analyzer';
import { classify, type ClassifyContext } from './classify';
import { scoreSalience } from './salience';
import { dedupe } from './dedupe';
import { deriveArchetype } from './archetype';
import {
  DEFAULT_PERCEPTION_CONFIG,
  type Affordance,
  type PageModel,
  type PerceptionConfig,
  type SemanticRole,
} from './types';

// Net wider than the DOM analyzer — perception wants to see media tiles,
// list items, and form controls even when the bare interactive query misses them.
const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(',');

const REGION_HEADER_TAGS = new Set(['header']);
const REGION_FOOTER_TAGS = new Set(['footer']);
const REGION_NAV_TAGS = new Set(['nav']);
const REGION_MAIN_TAGS = new Set(['main', 'article']);

function rectVisible(rect: DOMRect): boolean {
  return rect.width > 1 && rect.height > 1;
}

function intersectsViewport(rect: DOMRect, pad = 0): boolean {
  const vh = window.innerHeight || 800;
  const vw = window.innerWidth || 1200;
  return (
    rect.bottom > -pad &&
    rect.top < vh + pad &&
    rect.right > -pad &&
    rect.left < vw + pad
  );
}

function computedHidden(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  if (Number(cs.opacity) === 0) return true;
  return false;
}

function getName(el: HTMLElement): string {
  // Accessible name approximation: aria-label > value/placeholder > visible text.
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.value) return el.value.trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.name) return el.name.trim();
  }
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text;
}

function detectRegion(el: HTMLElement): Affordance['region'] {
  let cur: HTMLElement | null = el;
  let depth = 0;
  while (cur && depth < 12) {
    const tag = cur.tagName.toLowerCase();
    const role = (cur.getAttribute('role') || '').toLowerCase();
    if (REGION_HEADER_TAGS.has(tag) || role === 'banner') return 'header';
    if (REGION_FOOTER_TAGS.has(tag) || role === 'contentinfo') return 'footer';
    if (REGION_NAV_TAGS.has(tag) || role === 'navigation') return 'header';
    if (REGION_MAIN_TAGS.has(tag) || role === 'main' || role === 'article')
      return 'main';
    if (
      role === 'dialog' ||
      role === 'alertdialog' ||
      cur.getAttribute('aria-modal') === 'true'
    ) {
      return 'overlay';
    }
    if (cur.id && /sidebar|secondary|aside/i.test(cur.id)) return 'sidebar';
    if (tag === 'aside') return 'sidebar';
    cur = cur.parentElement;
    depth++;
  }
  return 'unknown';
}

function buildClassifyContext(el: HTMLElement, name: string): ClassifyContext {
  let inChrome = false;
  let inMain = false;
  let insideHeading = false;
  let insideForm = false;
  let cur: HTMLElement | null = el;
  let depth = 0;
  while (cur && depth < 12) {
    const tag = cur.tagName.toLowerCase();
    const role = (cur.getAttribute('role') || '').toLowerCase();
    if (
      REGION_HEADER_TAGS.has(tag) ||
      REGION_NAV_TAGS.has(tag) ||
      REGION_FOOTER_TAGS.has(tag) ||
      role === 'navigation' ||
      role === 'banner' ||
      role === 'contentinfo'
    ) {
      inChrome = true;
    }
    if (REGION_MAIN_TAGS.has(tag) || role === 'main' || role === 'article') inMain = true;
    if (/^h[1-4]$/.test(tag)) insideHeading = true;
    if (tag === 'form') insideForm = true;
    cur = cur.parentElement;
    depth++;
  }
  const href = el instanceof HTMLAnchorElement ? el.href.toLowerCase() : '';
  const hrefPath = href ? href.replace(/^https?:\/\/[^/]+/, '') : '';
  return {
    inChrome,
    inMain,
    insideHeading,
    insideForm,
    name: name.toLowerCase(),
    href,
    hrefPath,
  };
}

function makeId(role: SemanticRole, label: string, idx: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${role}_${slug || 'el'}_${idx}`;
}

function shortHint(role: SemanticRole, label: string): string {
  switch (role) {
    case 'search_input':
      return `Type a query, then press Enter`;
    case 'primary_cta':
      return `Primary action: ${label}`;
    case 'submit':
      return `Submit form`;
    case 'login':
      return `Begin sign-in flow`;
    case 'signup':
      return `Begin sign-up flow`;
    case 'accept_cookies':
      return `Dismiss consent banner`;
    case 'dismiss':
      return `Close / dismiss`;
    case 'pagination':
      return `Load more results`;
    case 'result_link':
    case 'media_tile':
      return `Open this result`;
    case 'tab':
      return `Switch tab`;
    case 'nav_link':
      return `Site navigation link`;
    default:
      return '';
  }
}

export function buildPageModel(
  config: PerceptionConfig = DEFAULT_PERCEPTION_CONFIG,
): PageModel {
  if (typeof document === 'undefined') {
    return emptyModel();
  }

  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR),
  );

  const candidates: Affordance[] = [];
  const candidateCount = elements.length;

  // Adaptive depth: cheap pages get a tight cap; busy pages widen the
  // window but still stay bounded so prompt size is predictable.
  const depth: PageModel['depth'] =
    candidateCount <= config.compactThreshold
      ? 'compact'
      : candidateCount >= config.deepThreshold
        ? 'deep'
        : 'standard';

  let idx = 0;
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (computedHidden(el)) continue;
    if (el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'false') {
      // We'll still consider disabled elements but penalize their salience.
    }

    const rect = el.getBoundingClientRect();
    if (!rectVisible(rect)) continue;

    const inViewport = intersectsViewport(rect, 0);
    const nearViewport = !inViewport && intersectsViewport(rect, config.viewportPad);
    if (!inViewport && !nearViewport) continue;

    const name = getName(el);
    const ctx = buildClassifyContext(el, name);
    const cls = classify(el, ctx);

    const region = detectRegion(el);
    const tag = el.tagName.toLowerCase();
    const inputType = (el.getAttribute('type') || '').toLowerCase() || undefined;
    const ariaRole = el.getAttribute('role') || undefined;
    const isDisabled =
      el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

    const salience = scoreSalience({
      rect,
      region,
      in_viewport: inViewport,
      near_viewport: nearViewport,
      role: cls.role,
      confidence: cls.confidence,
      has_aria_label: el.hasAttribute('aria-label'),
      has_visible_text: name.length > 0,
      is_disabled: isDisabled,
    });

    const label = name || el.id || tag;
    const aff: Affordance = {
      id: makeId(cls.role, label, idx++),
      role: cls.role,
      label: label.length > 80 ? label.slice(0, 79) + '…' : label,
      selector: generateSelector(el),
      tag,
      input_type: inputType,
      aria_role: ariaRole || undefined,
      href: el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? undefined : undefined,
      region,
      in_viewport: inViewport,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      confidence: round2(cls.confidence),
      salience: round2(salience),
      hint: shortHint(cls.role, label) || undefined,
    };

    candidates.push(aff);
  }

  const deduped = dedupe(candidates);

  // Rank by salience, but keep at least one of each "rare and important" role
  // so the planner never loses sight of cookie banners or login affordances.
  const ranked = rankWithGuarantees(deduped, config);

  // Role counts (post-dedupe, full set — useful even if we trimmed the ranked list).
  const role_counts: Partial<Record<SemanticRole, number>> = {};
  for (const a of deduped) role_counts[a.role] = (role_counts[a.role] ?? 0) + 1;

  const arch = deriveArchetype(ranked, location.href, document.title);

  return {
    archetype: arch.archetype,
    workflow_phase: arch.workflow_phase,
    summary: arch.summary,
    primary_action_id: arch.primary_action_id,
    affordances: ranked,
    role_counts,
    suggested_next_steps: arch.suggested_next_steps,
    blocked_by_overlay: arch.blocked_by_overlay,
    depth,
  };
}

const GUARANTEED_ROLES: SemanticRole[] = [
  'accept_cookies',
  'search_input',
  'submit',
  'primary_cta',
  'login',
  'signup',
];

function rankWithGuarantees(
  affordances: Affordance[],
  config: PerceptionConfig,
): Affordance[] {
  const sorted = [...affordances].sort((a, b) => b.salience - a.salience);
  if (sorted.length <= config.maxAffordances) return sorted;

  const top = sorted.slice(0, config.maxAffordances);
  const kept = new Set(top);

  for (const role of GUARANTEED_ROLES) {
    if (top.some((a) => a.role === role)) continue;
    const rescue = sorted.find((a) => a.role === role && !kept.has(a));
    if (rescue) {
      // Drop the lowest-salience non-guaranteed item.
      for (let i = top.length - 1; i >= 0; i--) {
        if (!GUARANTEED_ROLES.includes(top[i].role)) {
          top.splice(i, 1);
          break;
        }
      }
      top.push(rescue);
    }
  }
  // Re-sort after rescues.
  return top.sort((a, b) => b.salience - a.salience);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Walk an event target's ancestor chain looking for the closest perception
 * affordance whose selector resolves back to that ancestor. Returns null when
 * no ancestor matches — callers should fall back to a freshly generated
 * selector.
 */
export function findAffordanceForElement(
  el: Element,
  affordances: Affordance[],
): Affordance | null {
  if (!affordances.length) return null;
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 8) {
    for (const aff of affordances) {
      try {
        const matches = document.querySelectorAll(aff.selector);
        for (const m of Array.from(matches)) {
          if (m === cur) return aff;
        }
      } catch {
        /* skip invalid selector */
      }
    }
    cur = cur.parentElement;
    depth++;
  }
  return null;
}

function emptyModel(): PageModel {
  return {
    archetype: 'unknown',
    workflow_phase: 'unknown',
    summary: '',
    affordances: [],
    role_counts: {},
    suggested_next_steps: [],
    blocked_by_overlay: false,
    depth: 'compact',
  };
}
