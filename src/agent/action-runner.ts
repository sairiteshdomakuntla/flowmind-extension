import type { AgentAction } from '../types';
import { LowConfidenceError } from '../types';
import type { Affordance } from '../perception/types';
import { getLastSnapshot } from './dom-analyzer';
import { buildPageModel } from '../perception/snapshot';

const DEFAULT_WAIT_MS = 8000;
const POLL_MS = 100;
const MAX_LOCAL_RETRIES = 3;
const LOW_CONFIDENCE_FLOOR = 0.25;

export interface RunActionResult {
  /** Selector that was actually resolved at runtime (for UI highlight). */
  resolved_selector?: string;
  /** Optional extracted text (for `extract` actions). */
  extracted?: string;
  /** True if the action triggered a top-level navigation. */
  navigated?: boolean;
}

export async function runAction(action: AgentAction): Promise<RunActionResult> {
  switch (action.action) {
    case 'click':
      return await doClick(action);
    case 'click_result':
      return await doClickResult(action);
    case 'type':
      return await doType(action);
    case 'press_key':
      return await doPressKey(action);
    case 'scroll':
      return doScroll(action);
    case 'navigate':
      return doNavigate(action);
    case 'extract':
      return await doExtract(action);
    case 'wait':
      return await doWait(action);
    case 'open_tab':
      return await doOpenTab(action);
    case 'switch_tab':
      return await doSwitchTab(action);
    case 'finish':
      return {};
    default:
      throw new Error(`Unknown action: ${(action as AgentAction).action}`);
  }
}

async function doPressKey(action: AgentAction): Promise<RunActionResult> {
  const key = (action.value || 'Enter').trim();
  // press_key may target a typed input OR fire on whatever has focus.
  // Try perception-driven resolve only when the action names a target.
  let target: HTMLElement | null = null;
  if (action.selector || action.target_text) {
    try {
      const attempted = new Set<string>();
      const { el } = await resolveWithFallback({ ...action, action: 'type' }, attempted);
      target = el as HTMLElement;
    } catch {
      target = null;
    }
  }
  const el = target ?? (document.activeElement as HTMLElement | null) ?? document.body;

  const initBase: KeyboardEventInit = { key, bubbles: true, cancelable: true, composed: true };
  const init: KeyboardEventInit = key.length === 1
    ? { ...initBase, code: `Key${key.toUpperCase()}` }
    : { ...initBase, code: key };
  const before = location.href;
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));

  // Many search forms only submit on form.requestSubmit() — fall back if Enter did nothing.
  if (key.toLowerCase() === 'enter' && el instanceof HTMLElement) {
    const form = el.closest('form');
    if (form && location.href === before) {
      try {
        if (typeof (form as HTMLFormElement).requestSubmit === 'function') {
          (form as HTMLFormElement).requestSubmit();
        } else {
          (form as HTMLFormElement).submit();
        }
      } catch {
        /* ignore */
      }
    }
    // SPA search boxes (e.g. YouTube) often have no <form> ancestor and
    // rely on a sibling "search" button. If pressing Enter didn't change
    // the URL within a short window, click the nearest visible search
    // submit control we can find by aria-label / role.
    await sleep(250);
    if (location.href === before) {
      const submit = findNearbySearchSubmit(el);
      if (submit) {
        await scrollIntoView(submit);
        fireMouseSequence(submit);
      }
    }
  }
  await sleep(150);
  return { resolved_selector: el instanceof HTMLElement ? describe(el) : undefined, navigated: location.href !== before };
}

/**
 * Find a search-submit button near (or globally adjacent to) the given input.
 * Looks for buttons whose accessible name is "search" / "submit search" or
 * which carry a search icon, without hard-coding any site-specific IDs.
 */
function findNearbySearchSubmit(input: HTMLElement): HTMLElement | null {
  const candidates: HTMLElement[] = [];

  // 1. Walk up a few ancestors and grab buttons that look like search submit.
  let cursor: HTMLElement | null = input;
  for (let i = 0; cursor && i < 5; i++) {
    cursor = cursor.parentElement;
    if (!cursor) break;
    cursor
      .querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')
      .forEach((b) => candidates.push(b));
  }

  // 2. Page-wide fallback (covers YouTube where the button lives outside the input's parent chain).
  document
    .querySelectorAll<HTMLElement>(
      'button[aria-label*="earch" i], [role="button"][aria-label*="earch" i], button[id*="search" i], [class*="search-icon" i]',
    )
    .forEach((b) => candidates.push(b));

  for (const el of candidates) {
    if (el === input) continue;
    if (!isInteractable(el)) continue;
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      aria.includes('search') ||
      title.includes('search') ||
      id.includes('search') ||
      text === 'search' ||
      el.matches('input[type="submit"]')
    ) {
      return el;
    }
  }
  return null;
}

/* ─── click ─────────────────────────────────────────────────────── */

async function doClick(action: AgentAction): Promise<RunActionResult> {
  return withFallback(action, async (el) => {
    await scrollIntoView(el);
    await sleep(60);
    const before = location.href;
    fireMouseSequence(el);
    // Give the SPA router time to respond (YouTube intercepts anchor clicks).
    await sleep(300);
    const navigated = location.href !== before;

    // Fallback: if no navigation happened and the element is an anchor with href,
    // drive the navigation ourselves. This reliably handles YouTube's custom-element
    // shadow DOM where synthetic mouse events may not reach the router.
    if (!navigated && el instanceof HTMLAnchorElement) {
      const href = el.getAttribute('href');
      if (href) {
        const absolute = href.startsWith('http') ? href : location.origin + href;
        location.assign(absolute);
        await sleep(100);
        return { resolved_selector: describe(el), navigated: true };
      }
    }

    return { resolved_selector: describe(el), navigated };
  });
}

/* ─── click_result (deterministic, no LLM selector) ───────────── */

/**
 * Directly scan the live DOM for content/video/article links and navigate
 * to the Nth one (value = index, default "0"). This bypasses LLM selectors
 * entirely — the code itself finds the right anchor and uses its href.
 *
 * Link discovery cascade (site-agnostic, checked in order):
 *   1. a[id="video-title"]       — YouTube search/home video results
 *   2. a[id="video-title-link"]  — YouTube playlist items
 *   3. ytd-video-renderer a[href*="/watch"] — YouTube fallback
 *   4. h3 a[href]                — Google, Reddit, HN, generic results
 *   5. h2 a[href]                — alternative heading-link pattern
 *   6. [data-video-id] a[href]   — YouTube embedded players
 *   7. a[href*="/watch?v="]      — catch-all for YouTube watch links
 *   8. article a[href]           — blog / news article lists
 */
async function doClickResult(action: AgentAction): Promise<RunActionResult> {
  const targetIndex = Math.max(0, parseInt(action.value ?? '0', 10) || 0);

  // Wait a moment for any lazy-loading/rendering to settle
  await sleep(500);

  const link = findNthContentLink(targetIndex);
  if (!link) {
    throw new Error(
      `click_result: no content/video link found at index ${targetIndex}. ` +
      `The page may still be loading or has no results.`
    );
  }

  const href = link.getAttribute('href');
  if (!href) {
    throw new Error(`click_result: found link but it has no href attribute.`);
  }

  const title = (link.textContent || link.getAttribute('title') || '').trim();
  const selector = describe(link);

  // Scroll into view for visual feedback
  await scrollIntoView(link);
  await sleep(100);

  const before = location.href;

  // Strategy 1: Try native .click() — SPA routers (YouTube, Gmail, etc.)
  // intercept this and perform a smooth in-app navigation. This is the
  // best UX because it avoids a full page reload.
  link.click();
  await sleep(400);

  if (location.href !== before) {
    return {
      resolved_selector: selector,
      navigated: true,
      extracted: title ? `Clicked: ${title.slice(0, 120)}` : undefined,
    };
  }

  // Strategy 2: Try synthetic mouse event sequence
  fireMouseSequence(link);
  await sleep(400);

  if (location.href !== before) {
    return {
      resolved_selector: selector,
      navigated: true,
      extracted: title ? `Clicked: ${title.slice(0, 120)}` : undefined,
    };
  }

  // Strategy 3: Direct navigation via href — always works as last resort
  const absolute = href.startsWith('http') ? href : location.origin + href;
  location.assign(absolute);

  return {
    resolved_selector: selector,
    navigated: true,
    extracted: title ? `Clicked: ${title.slice(0, 120)}` : undefined,
  };
}

/**
 * Find the Nth visible content link on the page using a priority cascade
 * of selectors. Each selector targets a common pattern for "result items"
 * across major sites. Site-agnostic: no hard-coded IDs or class names
 * beyond well-known semantic patterns.
 */
function findNthContentLink(n: number): HTMLAnchorElement | null {
  // Each group is tried in order. Within a group, we collect all visible
  // anchors with hrefs. If any group yields enough results, we pick from it.
  const selectorGroups = [
    // YouTube video title links (highest priority — exact match)
    'a#video-title, a#video-title-link',
    // YouTube fallback: any watch link inside a video renderer
    'ytd-video-renderer a[href*="/watch"], ytd-rich-item-renderer a[href*="/watch"]',
    // Google search / generic heading links
    'h3 a[href]',
    // Alternative heading links
    'h2 a[href], h1 a[href]',
    // YouTube catch-all watch links (but not in sidebar/nav)
    'a[href*="/watch?v="]',
    // Article/card patterns
    'article a[href], [role="article"] a[href]',
  ];

  const seenHrefs = new Set<string>();

  for (const selector of selectorGroups) {
    const links: HTMLAnchorElement[] = [];
    try {
      document.querySelectorAll<HTMLAnchorElement>(selector).forEach((a) => {
        const href = a.getAttribute('href');
        if (!href) return;
        // Skip duplicates (same href via different selectors)
        if (seenHrefs.has(href)) return;
        // Skip non-content links (navbars, footers, etc.)
        if (isNavOrFooterLink(a)) return;
        // Must be visible (allow slightly off-screen for lazy-loaded content)
        if (!isLinkVisible(a)) return;
        seenHrefs.add(href);
        links.push(a);
      });
    } catch {
      continue;
    }

    if (links.length > n) {
      return links[n];
    }
    // If this group has some links but not enough, still try next group
    // to see if a broader selector finds more
  }

  // Final fallback: collect ALL links found across all groups
  // and return the nth one if available
  const allLinks: HTMLAnchorElement[] = [];
  const allSeenHrefs = new Set<string>();
  for (const selector of selectorGroups) {
    try {
      document.querySelectorAll<HTMLAnchorElement>(selector).forEach((a) => {
        const href = a.getAttribute('href');
        if (!href || allSeenHrefs.has(href)) return;
        if (isNavOrFooterLink(a)) return;
        if (!isLinkVisible(a)) return;
        allSeenHrefs.add(href);
        allLinks.push(a);
      });
    } catch {
      continue;
    }
  }

  return allLinks[n] ?? null;
}

/** Check if a link is inside a nav, header, footer, or sidebar — skip these. */
function isNavOrFooterLink(el: HTMLElement): boolean {
  let cursor: HTMLElement | null = el;
  for (let i = 0; cursor && i < 8; i++) {
    const tag = cursor.tagName.toLowerCase();
    const role = cursor.getAttribute('role') || '';
    if (
      tag === 'nav' || tag === 'footer' || tag === 'header' ||
      role === 'navigation' || role === 'banner' || role === 'contentinfo'
    ) {
      return true;
    }
    // YouTube's sidebar suggestions
    const id = (cursor.id || '').toLowerCase();
    if (id === 'secondary' || id === 'guide' || id === 'masthead-container') {
      return true;
    }
    cursor = cursor.parentElement;
  }
  return false;
}

/** Check if a link is visible enough to be a real content link. */
function isLinkVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  // Allow links up to 1500px below viewport (lazy-loaded results)
  if (r.top > window.innerHeight + 1500) return false;
  return true;
}


async function doType(action: AgentAction): Promise<RunActionResult> {
  return withFallback(action, async (el) => {
    await scrollIntoView(el);
    const value = action.value ?? '';

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.focus();
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setNativeValue(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (action.value?.endsWith('\n')) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
      }
      return { resolved_selector: describe(el) };
    }

    if (el instanceof HTMLElement && el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return { resolved_selector: describe(el) };
    }

    // Fallback: synthesize keystrokes on whatever was found
    if (el instanceof HTMLElement) {
      el.focus();
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: value }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
    }
    return { resolved_selector: describe(el) };
  });
}

/* ─── scroll ────────────────────────────────────────────────────── */

function doScroll(action: AgentAction): RunActionResult {
  const v = (action.value ?? 'down').toLowerCase();
  const amount = window.innerHeight * 0.85;
  if (v === 'up') window.scrollBy({ top: -amount, behavior: 'smooth' });
  else if (v === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
  else if (v === 'bottom')
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  else if (/^-?\d+$/.test(v)) window.scrollBy({ top: Number(v), behavior: 'smooth' });
  else window.scrollBy({ top: amount, behavior: 'smooth' });
  return {};
}

/* ─── navigate ──────────────────────────────────────────────────── */

function doNavigate(action: AgentAction): RunActionResult {
  const url = action.value;
  if (!url) throw new Error('navigate requires a value (URL).');
  location.assign(normalizeUrl(url));
  return { navigated: true };
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return location.origin + url;
  return 'https://' + url;
}

/* ─── extract ───────────────────────────────────────────────────── */

async function doExtract(action: AgentAction): Promise<RunActionResult> {
  return withFallback(action, async (el) => {
    const text = (el.textContent || '').trim();
    return { resolved_selector: describe(el), extracted: text };
  });
}

/* ─── wait ──────────────────────────────────────────────────────── */

async function doWait(action: AgentAction): Promise<RunActionResult> {
  const ms = Number(action.value ?? 1000);
  await sleep(Number.isFinite(ms) && ms > 0 ? ms : 1000);
  return {};
}

/* ─── tabs (delegate to service worker) ─────────────────────────── */

async function doOpenTab(action: AgentAction): Promise<RunActionResult> {
  if (!action.value) throw new Error('open_tab requires a value (URL).');
  await chrome.runtime.sendMessage({
    type: 'TAB_OPEN',
    url: normalizeUrl(action.value),
    active: true,
  });
  return {};
}

async function doSwitchTab(action: AgentAction): Promise<RunActionResult> {
  const pattern = action.value ?? action.selector;
  if (!pattern) throw new Error('switch_tab requires value or selector pattern.');
  await chrome.runtime.sendMessage({ type: 'TAB_SWITCH', urlPattern: pattern });
  return {};
}

/* ─── perception-driven fallback retry ─────────────────────────── */

/**
 * Resolve an element for the given action. On failure, consults the cached
 * PageModel for the next-best Affordance ranked by affinity × confidence ×
 * salience. Throws LowConfidenceError when no remaining candidate clears
 * the floor — caller should re-think via Gemini rather than retry locally.
 *
 * `attempted` accumulates selectors the caller has already tried so we don't
 * loop on the same broken candidate.
 */
async function resolveWithFallback(
  action: AgentAction,
  attempted: Set<string>,
): Promise<{ el: Element; affordance?: Affordance }> {
  // First pass: existing resolver (selector → text → input fallbacks).
  if (!action.selector || !attempted.has(action.selector)) {
    try {
      const el = await resolveElement(action);
      if (action.selector) attempted.add(action.selector);
      return { el };
    } catch (err) {
      if (action.selector) attempted.add(action.selector);
      // Fall through to perception-driven alternates.
      void err;
    }
  }

  // Second pass: rank remaining affordances from the live PageModel.
  const snap = getLastSnapshot();
  let pageModel = snap?.page_model;
  if (!pageModel) {
    try {
      pageModel = buildPageModel();
    } catch {
      pageModel = undefined;
    }
  }

  const affordances = pageModel?.affordances ?? [];
  const ranked = affordances
    .filter((a) => a.selector && !attempted.has(a.selector))
    .map((a) => ({ aff: a, score: affinity(action, a) * a.confidence * a.salience }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { aff, score } of ranked) {
    if (score < LOW_CONFIDENCE_FLOOR) {
      throw new LowConfidenceError(
        `No remaining affordance above confidence floor (${score.toFixed(2)} < ${LOW_CONFIDENCE_FLOOR}) for ${action.action}`,
      );
    }
    attempted.add(aff.selector);
    const el = trySelector(aff.selector, (n) =>
      isInteractable(n) && matchesActionKind(n, action.action),
    );
    if (el) return { el, affordance: aff };
  }

  throw new Error(
    `resolveWithFallback: exhausted ${ranked.length} alternate(s) for ${action.action} (selector=${action.selector ?? '∅'} text=${action.target_text ?? '∅'})`,
  );
}

/**
 * Map an action onto how well a given affordance can satisfy it.
 * 0 means "not a candidate"; >0 is multiplied with confidence × salience.
 */
function affinity(action: AgentAction, aff: Affordance): number {
  const text = (action.target_text ?? '').trim().toLowerCase();
  const role = (action.target_role ?? '').trim().toLowerCase();
  const label = (aff.label ?? '').toLowerCase();
  const hint = (aff.hint ?? '').toLowerCase();

  const roleBonus = role && (aff.aria_role === role || aff.tag === role) ? 0.4 : 0;
  const textBonus = text && (label.includes(text) || hint.includes(text)) ? 0.4 : 0;
  const exactBonus = text && label === text ? 0.3 : 0;

  let kindFit = 0;
  switch (action.action) {
    case 'type':
      if (aff.role === 'search_input' || aff.role === 'form_field') kindFit = 1.0;
      else if (aff.tag === 'input' || aff.tag === 'textarea') kindFit = 0.8;
      else if (aff.aria_role === 'textbox' || aff.aria_role === 'combobox') kindFit = 0.7;
      break;
    case 'click':
    case 'press_key':
      if (aff.role === 'primary_cta' || aff.role === 'submit') kindFit = 1.0;
      else if (aff.role === 'result_link' || aff.role === 'media_tile') kindFit = 0.9;
      else if (aff.role === 'secondary_cta' || aff.role === 'nav_link') kindFit = 0.6;
      else if (aff.tag === 'a' || aff.tag === 'button') kindFit = 0.5;
      break;
    case 'extract':
      kindFit = 0.4 + (text ? textBonus : 0);
      break;
    default:
      kindFit = 0.3;
  }

  if (kindFit === 0 && !text) return 0;
  return kindFit + roleBonus + textBonus + exactBonus;
}

/**
 * Wrap an action body so it retries up to MAX_LOCAL_RETRIES times against
 * perception-ranked alternates before bubbling. Result.resolved_selector is
 * overridden with the affordance selector when a fallback was used.
 */
async function withFallback(
  action: AgentAction,
  fn: (el: Element) => Promise<RunActionResult>,
): Promise<RunActionResult> {
  const attempted = new Set<string>();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_LOCAL_RETRIES; attempt++) {
    try {
      const { el, affordance } = await resolveWithFallback(action, attempted);
      const result = await fn(el);
      if (affordance && !result.resolved_selector) {
        return { ...result, resolved_selector: affordance.selector };
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (err instanceof LowConfidenceError) throw err;
      // Otherwise continue with next alternate.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Action ${action.action} exhausted local retries`);
}

/* ─── element resolution ────────────────────────────────────────── */

async function resolveElement(action: AgentAction): Promise<Element> {
  const deadline = Date.now() + DEFAULT_WAIT_MS;
  let lastErr = '';

  while (Date.now() < deadline) {
    const el = findElement(action);
    if (el && isInteractable(el) && matchesActionKind(el, action.action)) return el;
    if (el && !matchesActionKind(el, action.action))
      lastErr = `wrong element kind for ${action.action} (got <${el.tagName.toLowerCase()}>)`;
    else if (el) lastErr = 'element found but not interactable';
    else lastErr = 'no match';
    await sleep(POLL_MS);
  }

  throw new Error(
    `Could not resolve element (${lastErr}). selector=${action.selector ?? '∅'} text=${action.target_text ?? '∅'}`,
  );
}

/**
 * Reject mismatched element kinds. The single most common LLM failure is
 * targeting a "Search" button when the user wanted to type into the search
 * box — both have the text/aria "Search". For "type" we ONLY accept text
 * inputs; for "click" we accept anything else.
 */
function matchesActionKind(el: Element, kind: AgentAction['action']): boolean {
  if (kind !== 'type') return true;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].includes(t);
  }
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement) {
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'combobox')
      return true;
  }
  return false;
}

function findElement(action: AgentAction): Element | null {
  // For "type", restrict to text-input candidates regardless of selector.
  if (action.action === 'type') {
    const fromSelector = trySelector(action.selector, (el) => matchesActionKind(el, 'type'));
    if (fromSelector) return fromSelector;
    const fromText = action.target_text
      ? findInputByLabel(action.target_text)
      : null;
    if (fromText) return fromText;
    // Last-ditch: pick the most prominent visible textbox on the page.
    return pickPrimaryTextbox();
  }

  if (action.selector) {
    const fromSelector = trySelector(action.selector, isInteractable);
    if (fromSelector) return fromSelector;
  }
  if (action.target_text) {
    // For click actions, also search media/content links (video titles, etc.)
    if (action.action === 'click') {
      const mediaLink = findMediaLink(action.target_text);
      if (mediaLink) return mediaLink;
    }
    const byText = findByText(action.target_text, action.target_role);
    if (byText) return byText;
  }
  return null;
}

function trySelector(
  selector: string | undefined,
  ok: (el: Element) => boolean,
): Element | null {
  if (!selector) return null;
  try {
    const list = document.querySelectorAll(selector);
    const match = Array.from(list).find(ok);
    if (match) return match;
    return list[0] ?? null;
  } catch {
    return null;
  }
}

function findInputByLabel(needleRaw: string): Element | null {
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return null;

  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>(
      'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]',
    ),
  ).filter((el) => isInteractable(el) && matchesActionKind(el, 'type'));

  // Exact aria-label / placeholder / name
  for (const el of inputs) {
    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    const ph = (el.getAttribute('placeholder') || '').trim().toLowerCase();
    const name = (el.getAttribute('name') || '').trim().toLowerCase();
    if (aria === needle || ph === needle || name === needle) return el;
  }
  // Contains
  for (const el of inputs) {
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const ph = (el.getAttribute('placeholder') || '').toLowerCase();
    if (aria.includes(needle) || ph.includes(needle)) return el;
  }
  // <label for="..."> association
  for (const el of inputs) {
    if (!el.id) continue;
    const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lab && (lab.textContent || '').toLowerCase().includes(needle)) return el;
  }
  return null;
}

function pickPrimaryTextbox(): Element | null {
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>(
      'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]',
    ),
  ).filter((el) => isInteractable(el) && matchesActionKind(el, 'type'));
  if (inputs.length === 0) return null;
  // Prefer search-y inputs; otherwise the largest visible input.
  const ranked = inputs
    .map((el) => {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const r = el.getBoundingClientRect();
      const score =
        (aria.includes('search') || ph.includes('search') ? 1000 : 0) +
        r.width * r.height;
      return { el, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.el ?? null;
}

function findByText(needleRaw: string, role?: string): Element | null {
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return null;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], input[type="submit"], input[type="button"], [tabindex]',
    ),
  );

  const filtered = role
    ? candidates.filter(
        (el) =>
          el.getAttribute('role') === role ||
          el.tagName.toLowerCase() === role.toLowerCase(),
      )
    : candidates;

  // exact match on aria-label / text wins
  for (const el of filtered) {
    const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (label === needle && isInteractable(el)) return el;
  }
  for (const el of filtered) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text === needle && isInteractable(el)) return el;
  }
  // contains
  for (const el of filtered) {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    const text = (el.textContent || '').toLowerCase();
    if ((label.includes(needle) || text.includes(needle)) && isInteractable(el))
      return el;
  }
  return null;
}

function isInteractable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  // Allow elements up to 600px below the visible viewport (lazy-loaded results)
  const vh = window.innerHeight + 600;
  if (r.bottom < -300 || r.top > vh) return false;
  return true;
}

/**
 * Find a media/content link (video title, article heading, etc.) whose text
 * contains the needle. Works generically across YouTube, Reddit, HN, etc.
 * Searches:
 *   1. a[id="video-title"] — YouTube search/home results
 *   2. a[id="video-title-link"] — YouTube playlists
 *   3. h1/h2/h3/h4 > a[href] — generic heading links
 * Falls back to the first result if no text match found.
 */
function findMediaLink(needleRaw: string): HTMLAnchorElement | null {
  const needle = needleRaw.trim().toLowerCase();

  const candidates = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[id="video-title"], a[id="video-title-link"], h1 a[href], h2 a[href], h3 a[href], h4 a[href]',
    ),
  );

  if (candidates.length === 0) return null;

  // Exact text match first
  for (const a of candidates) {
    const text = (a.textContent || a.getAttribute('title') || '').trim().toLowerCase();
    if (text === needle && isInteractable(a)) return a;
  }
  // Contains match
  for (const a of candidates) {
    const text = (a.textContent || a.getAttribute('title') || '').trim().toLowerCase();
    if (text.includes(needle) && isInteractable(a)) return a;
  }
  // Needle is in the href (e.g. video ID or slug)
  for (const a of candidates) {
    if ((a.getAttribute('href') || '').includes(needle) && isInteractable(a)) return a;
  }
  // Last resort: return the first interactable candidate (most relevant result)
  for (const a of candidates) {
    if (isInteractable(a)) return a;
  }
  return null;
}

/* ─── helpers ───────────────────────────────────────────────────── */

function fireMouseSequence(el: Element) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    view: window,
  };
  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new MouseEvent('click', opts));
}

async function scrollIntoView(el: Element) {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  await sleep(80);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function describe(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el instanceof HTMLElement) {
    const aria = el.getAttribute('aria-label');
    if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`;
  }
  return el.tagName.toLowerCase();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
