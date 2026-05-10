// Classifier — assigns a SemanticRole to a candidate element.
//
// Strictly heuristic, site-agnostic. Inputs we trust, in order of authority:
//   1. ARIA — role, aria-label, aria-pressed, aria-expanded
//   2. Native semantics — tag, input type, name, placeholder
//   3. Visible text (lowercased, normalized)
//   4. Structural cues — heading ancestor, list-item ancestor, form ancestor
//   5. Position cues — header / nav / footer ancestor, viewport intersection

import type { SemanticRole } from './types';

export interface ClassifyContext {
  /** True when an ancestor is <nav>/<header>/<footer> or role=navigation/banner/contentinfo. */
  inChrome: boolean;
  /** True when ancestor is <main>, <article>, role=main/article. */
  inMain: boolean;
  /** True when ancestor is a heading (h1..h4). */
  insideHeading: boolean;
  /** True when ancestor is a form. */
  insideForm: boolean;
  /** Lowercased visible text or aria-label. */
  name: string;
  /** Lowercased href, if any. */
  href: string;
  /** Pathname only — used to filter feed/list links. */
  hrefPath: string;
}

interface Classification {
  role: SemanticRole;
  confidence: number;
}

// Reusable lowercase patterns for text matching. Keep short and intent-y.
const KW = {
  search: ['search', 'find', 'query'],
  login: ['log in', 'login', 'sign in', 'signin'],
  signup: ['sign up', 'signup', 'create account', 'register', 'get started', 'try free'],
  submit: ['submit', 'continue', 'confirm', 'next', 'proceed'],
  primary: [
    'play',
    'watch',
    'add to cart',
    'buy',
    'checkout',
    'subscribe',
    'send',
    'post',
    'publish',
    'save',
    'apply',
    'install',
    'download',
    'upload',
    'connect',
  ],
  dismiss: ['close', 'dismiss', 'cancel', 'no thanks', 'not now', 'maybe later', 'skip'],
  cookies: ['accept', 'agree', 'allow all', 'reject all', 'manage cookies'],
  pagination: ['next page', 'previous page', 'load more', 'show more', 'see more'],
};

function anyMatch(needles: string[], hay: string): boolean {
  for (const n of needles) if (hay.includes(n)) return true;
  return false;
}

export function classify(el: HTMLElement, ctx: ClassifyContext): Classification {
  const tag = el.tagName.toLowerCase();
  const ariaRole = (el.getAttribute('role') || '').toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
  const name = ctx.name;

  // 1. Text inputs / search boxes ----------------------------------
  const isTextField =
    tag === 'textarea' ||
    el.isContentEditable ||
    ariaRole === 'textbox' ||
    ariaRole === 'searchbox' ||
    ariaRole === 'combobox' ||
    (tag === 'input' &&
      ['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type));

  if (isTextField) {
    const looksSearchy =
      type === 'search' ||
      ariaRole === 'searchbox' ||
      anyMatch(KW.search, aria) ||
      anyMatch(KW.search, placeholder) ||
      anyMatch(KW.search, name);
    if (looksSearchy) return { role: 'search_input', confidence: 0.95 };
    return { role: 'form_field', confidence: 0.85 };
  }

  // 2. Buttons / links / button-like roles -------------------------
  const isButtonLike =
    tag === 'button' ||
    ariaRole === 'button' ||
    (tag === 'input' && (type === 'submit' || type === 'button')) ||
    ariaRole === 'menuitem';

  const isAnchor = tag === 'a' && ctx.href.length > 0;

  // Cookie banner / consent — very high signal patterns.
  if (anyMatch(KW.cookies, name) || anyMatch(KW.cookies, aria)) {
    return { role: 'accept_cookies', confidence: 0.85 };
  }

  // Dismiss / close — explicit close affordances.
  if (
    anyMatch(KW.dismiss, name) ||
    aria === 'close' ||
    name === '×' ||
    name === '✕' ||
    name === 'x'
  ) {
    return { role: 'dismiss', confidence: 0.8 };
  }

  // Login / signup.
  if (anyMatch(KW.login, name) || anyMatch(KW.login, aria)) {
    return { role: 'login', confidence: 0.85 };
  }
  if (anyMatch(KW.signup, name) || anyMatch(KW.signup, aria)) {
    return { role: 'signup', confidence: 0.8 };
  }

  // Submit on a form button is highly informative.
  if ((tag === 'button' && (type === 'submit' || ctx.insideForm)) ||
      (tag === 'input' && type === 'submit')) {
    if (anyMatch(KW.submit, name) || ctx.insideForm) {
      return { role: 'submit', confidence: 0.85 };
    }
  }

  // Pagination / load-more.
  if (anyMatch(KW.pagination, name) || anyMatch(KW.pagination, aria)) {
    return { role: 'pagination', confidence: 0.8 };
  }

  // Tab.
  if (ariaRole === 'tab') return { role: 'tab', confidence: 0.85 };

  // Dropdown / disclosure.
  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true' || expanded === 'false' || ariaRole === 'combobox') {
    return { role: 'dropdown', confidence: 0.7 };
  }

  // Result-link heuristic — anchors inside a heading or list, in main content area.
  if (isAnchor) {
    if (ctx.inChrome) {
      return { role: 'nav_link', confidence: 0.7 };
    }
    if (ctx.insideHeading && ctx.inMain) {
      return { role: 'result_link', confidence: 0.85 };
    }
    // YouTube/video tile heuristic: anchor whose href is a watch/video URL.
    if (
      /\/watch(\?|$)|\/video\/|\/v\/|\/shorts\//.test(ctx.hrefPath) ||
      el.id === 'video-title' ||
      el.id === 'video-title-link'
    ) {
      return { role: 'media_tile', confidence: 0.8 };
    }
    if (ctx.inMain) {
      // Heuristic: long, descriptive anchors in main content tend to be result links.
      if (name.length > 24) return { role: 'result_link', confidence: 0.65 };
      return { role: 'link', confidence: 0.5 };
    }
    return { role: 'link', confidence: 0.4 };
  }

  // Buttons not yet classified — try primary-action keyword pass.
  if (isButtonLike) {
    if (anyMatch(KW.primary, name) || anyMatch(KW.primary, aria)) {
      return { role: 'primary_cta', confidence: 0.8 };
    }
    // Play control inside a media context.
    if (ariaRole === 'button' && (aria.includes('play') || name.includes('play'))) {
      return { role: 'play_control', confidence: 0.7 };
    }
    return { role: 'secondary_cta', confidence: 0.55 };
  }

  // Selects, checkboxes, etc.
  if (tag === 'select' || ariaRole === 'checkbox' || tag === 'input') {
    return { role: 'form_field', confidence: 0.7 };
  }

  return { role: 'other', confidence: 0.3 };
}
