import type { DOMSnapshot } from '../types';

const PAGE_TEXT_LIMIT = 2000;
const INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="combobox"], [contenteditable="true"], [id="video-title"], h3 a[href]';

export function isVisible(el: Element, allowOffscreen = false): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Allow elements slightly outside the viewport (e.g. lazy-loaded YouTube results)
  if (!allowOffscreen) {
    const vh = window.innerHeight + 500;
    const vw = window.innerWidth + 200;
    if (rect.bottom < -200 || rect.top > vh || rect.right < -200 || rect.left > vw) return false;
  }
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, '\\$1');
}

function isUniqueSelector(selector: string, target: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === target;
  } catch {
    return false;
  }
}

export function generateSelector(el: Element): string {
  if (el.id) {
    const sel = `#${cssEscape(el.id)}`;
    if (isUniqueSelector(sel, el)) return sel;
  }

  const dataAttrs = Array.from(el.attributes).filter(
    (a) => a.name.startsWith('data-') && a.value && a.value.length < 100,
  );
  for (const attr of dataAttrs) {
    const sel = `${el.tagName.toLowerCase()}[${attr.name}="${cssEscape(attr.value)}"]`;
    if (isUniqueSelector(sel, el)) return sel;
  }

  if (el instanceof HTMLElement) {
    const name = el.getAttribute('name');
    if (name) {
      const sel = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(sel, el)) return sel;
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      const sel = `${el.tagName.toLowerCase()}[aria-label="${cssEscape(ariaLabel)}"]`;
      if (isUniqueSelector(sel, el)) return sel;
    }
  }

  if (el.classList.length > 0) {
    const classSel = `${el.tagName.toLowerCase()}.${Array.from(el.classList)
      .map((c) => cssEscape(c))
      .join('.')}`;
    if (isUniqueSelector(classSel, el)) return classSel;
  }

  const path: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const node: Element = current;
    let segment = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      path.unshift(segment);
      break;
    }
    const siblings: Element[] = Array.from(parent.children).filter(
      (s: Element) => s.tagName === node.tagName,
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(node) + 1;
      segment += `:nth-of-type(${index})`;
    }
    path.unshift(segment);
    if (node.id) {
      path[0] = `#${cssEscape(node.id)}`;
      break;
    }
    current = parent;
  }
  return path.join(' > ');
}

function getElementText(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value || el.placeholder || '';
  }
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

function extractPageText(): string {
  const body = document.body;
  if (!body) return '';
  const raw = (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim();
  return raw.length > PAGE_TEXT_LIMIT ? raw.slice(0, PAGE_TEXT_LIMIT) : raw;
}

export function analyzeDom(): DOMSnapshot {
  if (typeof document === 'undefined') {
    return {
      url: '',
      title: '',
      interactive_elements: [],
      page_text_summary: '',
    };
  }

  const elements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  const interactive_elements: DOMSnapshot['interactive_elements'] = [];

  for (const el of elements) {
    if (!isVisible(el)) continue;
    if (!(el instanceof HTMLElement)) continue;

    const tag = el.tagName.toLowerCase();
    const entry: DOMSnapshot['interactive_elements'][number] = {
      tag,
      selector: generateSelector(el),
      visible: true,
    };

    const type = el.getAttribute('type');
    if (type) entry.type = type;
    if (el.id) entry.id = el.id;
    const name = el.getAttribute('name');
    if (name) entry.name = name;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) entry.placeholder = placeholder;
    const text = getElementText(el);
    if (text) entry.text = text;
    const aria = el.getAttribute('aria-label');
    if (aria) entry.aria_label = aria.length > 120 ? aria.slice(0, 120) + '…' : aria;
    const role = el.getAttribute('role');
    if (role) entry.role = role;

    interactive_elements.push(entry);
  }

  // Cap snapshot size — Gemini context is precious. Prefer elements with text/aria.
  const MAX_ELEMENTS = 120;
  if (interactive_elements.length > MAX_ELEMENTS) {
    interactive_elements.sort((a, b) => {
      // Boost video/media links so they survive the cap
      const aIsMedia = a.tag === 'a' && (a.id === 'video-title' || (a.selector || '').includes('video-title'));
      const bIsMedia = b.tag === 'a' && (b.id === 'video-title' || (b.selector || '').includes('video-title'));
      const aScore = (aIsMedia ? 5 : 0) + (a.aria_label ? 2 : 0) + (a.text ? 1 : 0) + (a.id ? 1 : 0);
      const bScore = (bIsMedia ? 5 : 0) + (b.aria_label ? 2 : 0) + (b.text ? 1 : 0) + (b.id ? 1 : 0);
      return bScore - aScore;
    });
    interactive_elements.length = MAX_ELEMENTS;
  }

  // Extract media/video links separately so Gemini always sees them regardless of the cap.
  const media_links = extractMediaLinks();

  return {
    url: location.href,
    title: document.title,
    interactive_elements,
    page_text_summary: extractPageText(),
    media_links: media_links.length > 0 ? media_links : undefined,
  };
}

/**
 * Extract the first N visible video/article title links from the page.
 * Works generically: looks for <a> elements inside heading tags or with
 * id/aria attributes that suggest they are content titles (video, article, etc.).
 * This is site-agnostic and will work on YouTube, Reddit, HN, etc.
 */
function extractMediaLinks(): { title: string; href: string; selector: string }[] {
  const results: { title: string; href: string; selector: string }[] = [];
  const seen = new Set<string>();

  // Strategy 1: <a id="video-title"> (YouTube search results)
  document.querySelectorAll<HTMLAnchorElement>('a[id="video-title"], a[id="video-title-link"]').forEach((a) => {
    const text = (a.textContent || a.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
    const href = a.getAttribute('href') || '';
    if (!text || !href || seen.has(href)) return;
    if (!isVisible(a, true)) return;
    seen.add(href);
    results.push({ title: text.slice(0, 120), href, selector: generateSelector(a) });
  });

  // Strategy 2: <h3><a href> or <h2><a href> — generic heading links (works on most sites)
  if (results.length === 0) {
    document.querySelectorAll<HTMLAnchorElement>('h1 a[href], h2 a[href], h3 a[href], h4 a[href]').forEach((a) => {
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
      const href = a.getAttribute('href') || '';
      if (!text || !href || seen.has(href)) return;
      if (!isVisible(a, true)) return;
      seen.add(href);
      results.push({ title: text.slice(0, 120), href, selector: generateSelector(a) });
    });
  }

  return results.slice(0, 10);
}
