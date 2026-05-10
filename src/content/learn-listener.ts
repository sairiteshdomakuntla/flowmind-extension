import type { AgentAction } from '../types';
import { learnMode } from '../memory/learn-mode';
import { generateSelector, getLastSnapshot } from '../agent/dom-analyzer';
import { findAffordanceForElement, buildPageModel } from '../perception/snapshot';

const TYPE_DEBOUNCE_MS = 350;

interface PendingType {
  el: HTMLElement;
  selector: string;
  targetText?: string;
  targetRole?: string;
  timer: number;
}

/**
 * Capture-phase DOM event listeners that translate user interactions into
 * `AgentAction`s and push them into `learnMode`. We use the capture phase so
 * we observe events even when the host page calls `stopPropagation()`.
 */
class LearnListener {
  private mounted = false;
  private pending: PendingType | null = null;

  attach(): void {
    if (this.mounted) return;
    this.mounted = true;

    document.addEventListener('click', this.onClick, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('change', this.onChange, true);
    document.addEventListener('submit', this.onSubmit, true);
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('focusout', this.onFocusOut, true);
  }

  detach(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.flushPending();

    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('change', this.onChange, true);
    document.removeEventListener('submit', this.onSubmit, true);
    document.removeEventListener('keydown', this.onKeydown, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
  }

  private resolveSelector(el: Element): {
    selector: string;
    target_text?: string;
    target_role?: string;
  } {
    const snap = getLastSnapshot();
    let affordances = snap?.page_model?.affordances ?? [];
    if (!affordances.length) {
      try {
        affordances = buildPageModel().affordances;
      } catch {
        affordances = [];
      }
    }
    const aff = findAffordanceForElement(el, affordances);
    if (aff) {
      return {
        selector: aff.selector,
        target_text: aff.label,
        target_role: aff.aria_role || aff.tag,
      };
    }
    const target_text =
      el instanceof HTMLElement
        ? (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80) ||
          undefined
        : undefined;
    const target_role =
      el instanceof HTMLElement
        ? el.getAttribute('role') || el.tagName.toLowerCase()
        : undefined;
    return {
      selector: generateSelector(el),
      target_text,
      target_role,
    };
  }

  private flushPending(): void {
    if (!this.pending) return;
    const p = this.pending;
    window.clearTimeout(p.timer);
    const value = readValue(p.el);
    if (value !== '') {
      const action: AgentAction = {
        action: 'type',
        selector: p.selector,
        target_text: p.targetText,
        target_role: p.targetRole,
        value,
        description: `Type "${truncate(value, 60)}"`,
      };
      learnMode.record(action);
    }
    this.pending = null;
  }

  private onClick = (e: Event): void => {
    if (!learnMode.isActive()) return;
    const el = e.target as Element | null;
    if (!el) return;

    // Flush a pending type before recording the click — preserves the
    // type-then-click ordering the user actually performed.
    if (this.pending && !this.pending.el.contains(el)) {
      this.flushPending();
    }

    if (!isClickWorthy(el)) return;

    const target = bubbleToInteractive(el);
    if (!target) return;
    const { selector, target_text, target_role } = this.resolveSelector(target);
    const action: AgentAction = {
      action: 'click',
      selector,
      target_text,
      target_role,
      description: target_text ? `Click "${truncate(target_text, 60)}"` : `Click element`,
    };
    learnMode.record(action);
  };

  private onInput = (e: Event): void => {
    if (!learnMode.isActive()) return;
    const el = e.target as HTMLElement | null;
    if (!el || !isTypable(el)) return;
    const { selector, target_text, target_role } = this.resolveSelector(el);

    if (!this.pending || this.pending.el !== el) {
      // New input target — flush previous and start fresh.
      this.flushPending();
      this.pending = {
        el,
        selector,
        targetText: target_text,
        targetRole: target_role,
        timer: window.setTimeout(() => this.flushPending(), TYPE_DEBOUNCE_MS),
      };
      return;
    }
    window.clearTimeout(this.pending.timer);
    this.pending.timer = window.setTimeout(() => this.flushPending(), TYPE_DEBOUNCE_MS);
  };

  private onChange = (e: Event): void => {
    if (!learnMode.isActive()) return;
    const el = e.target as HTMLElement | null;
    if (!el) return;

    if (el instanceof HTMLSelectElement) {
      const { selector, target_text, target_role } = this.resolveSelector(el);
      const value = el.value;
      const action: AgentAction = {
        action: 'type',
        selector,
        target_text,
        target_role,
        value,
        description: `Select "${truncate(value, 60)}"`,
      };
      learnMode.record(action);
      return;
    }
    // Text inputs — flush the pending type buffer.
    if (this.pending && this.pending.el === el) {
      this.flushPending();
    }
  };

  private onSubmit = (e: Event): void => {
    if (!learnMode.isActive()) return;
    this.flushPending();
    const form = e.target as HTMLElement | null;
    const { selector, target_text } = form
      ? this.resolveSelector(form)
      : { selector: 'form', target_text: undefined };
    const action: AgentAction = {
      action: 'press_key',
      selector,
      target_text,
      value: 'Enter',
      description: 'Submit form',
    };
    learnMode.record(action);
  };

  private onKeydown = (e: KeyboardEvent): void => {
    if (!learnMode.isActive()) return;
    if (e.key !== 'Enter') return;
    const el = e.target as HTMLElement | null;
    if (!el) return;

    // Inside a typing buffer, flush — most search forms submit on Enter
    // without a <form> ancestor (YouTube etc.).
    if (this.pending && this.pending.el === el) {
      this.flushPending();
      const { selector, target_text, target_role } = this.resolveSelector(el);
      const action: AgentAction = {
        action: 'press_key',
        selector,
        target_text,
        target_role,
        value: 'Enter',
        description: 'Press Enter',
      };
      learnMode.record(action);
      return;
    }
    // Bare Enter outside a typed buffer — record as press_key on the focused element.
    if (!isTypable(el)) {
      const { selector, target_text, target_role } = this.resolveSelector(el);
      const action: AgentAction = {
        action: 'press_key',
        selector,
        target_text,
        target_role,
        value: 'Enter',
        description: 'Press Enter',
      };
      learnMode.record(action);
    }
  };

  private onFocusOut = (e: FocusEvent): void => {
    if (!learnMode.isActive()) return;
    if (this.pending && this.pending.el === e.target) {
      this.flushPending();
    }
  };
}

export const learnListener = new LearnListener();

/* ─── helpers ──────────────────────────────────────────────────── */

function readValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el.isContentEditable) return (el.textContent || '').trim();
  return '';
}

function isTypable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].includes(t);
  }
  if (el instanceof HTMLTextAreaElement) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

function isClickWorthy(el: Element): boolean {
  // Skip clicks inside FlowMind's own UI (shadow root host).
  if (el instanceof Element) {
    let cur: Element | null = el;
    while (cur) {
      if (cur.id === 'flowmind-shadow-host') return false;
      cur = cur.parentElement;
    }
  }
  return true;
}

function bubbleToInteractive(el: Element): Element | null {
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 6) {
    const tag = cur.tagName.toLowerCase();
    if (
      tag === 'a' ||
      tag === 'button' ||
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea'
    ) {
      return cur;
    }
    const role = cur.getAttribute('role') || '';
    if (
      role === 'button' ||
      role === 'link' ||
      role === 'menuitem' ||
      role === 'tab' ||
      role === 'checkbox'
    ) {
      return cur;
    }
    cur = cur.parentElement;
    depth++;
  }
  return el;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
