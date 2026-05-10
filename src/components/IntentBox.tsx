import { useEffect, useRef, useState } from 'react';
import { FlowMark } from './brand/FlowMark';
import { IconArrow, IconAlert, IconClose } from './brand/Icon';
import type { WorkflowMemory } from '../types';

interface IntentBoxProps {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  recentCommands?: string[];
  onSubmit?: (intent: string, opts?: { replayWorkflow?: WorkflowMemory }) => void;
  onClose?: () => void;
  /** Resolved against the current input text via workflow-store.matchByIntent. */
  onIntentChange?: (intent: string) => void;
  matchedWorkflow?: WorkflowMemory | null;
}

export function IntentBox({
  open,
  loading = false,
  error,
  recentCommands = [],
  onSubmit,
  onClose,
  onIntentChange,
  matchedWorkflow,
}: IntentBoxProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const loadingRef = useRef(loading);
  const onSubmitRef = useRef(onSubmit);
  const onCloseRef = useRef(onClose);
  const matchedRef = useRef(matchedWorkflow);

  valueRef.current = value;
  loadingRef.current = loading;
  onSubmitRef.current = onSubmit;
  onCloseRef.current = onClose;
  matchedRef.current = matchedWorkflow;

  // Debounced intent-change notifier so the parent can run matchByIntent.
  useEffect(() => {
    if (!onIntentChange) return undefined;
    const handle = window.setTimeout(() => onIntentChange(value), 200);
    return () => window.clearTimeout(handle);
  }, [value, onIntentChange]);

  useEffect(() => {
    if (open) {
      setValue('');
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Capture-phase listener so we beat host pages (YouTube, Gmail) that
  // hijack Enter/Esc with their own handlers.
  useEffect(() => {
    if (!open) return undefined;
    function handler(e: KeyboardEvent) {
      const target = e.target as Node | null;
      const inInput = target ? inputRef.current?.contains(target) : false;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Enter' && inInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        const text = valueRef.current.trim();
        if (text && !loadingRef.current) onSubmitRef.current?.(text);
      }
    }
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  if (!open) return null;

  function submit(replay = false) {
    const text = value.trim();
    if (!text || loading) return;
    onSubmit?.(text, replay && matchedRef.current ? { replayWorkflow: matchedRef.current } : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-start justify-center pt-[18vh] font-sans animate-fm-fade"
      style={{
        background: 'rgba(6,6,12,0.55)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose?.();
      }}
      onKeyDownCapture={(e) => e.stopPropagation()}
      onKeyUpCapture={(e) => e.stopPropagation()}
    >
      <div
        className="w-[640px] max-w-[92vw] overflow-hidden rounded-panel animate-fm-lift"
        style={{
          background:
            'linear-gradient(180deg, rgba(15,15,26,0.96) 0%, rgba(8,8,15,0.96) 100%)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow:
            '0 30px 80px -20px rgba(0,0,0,0.65), 0 1px 0 0 rgba(255,255,255,0.05) inset',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Hairline accent at top */}
        <div
          className="h-px w-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(124,92,255,0.55) 50%, transparent 100%)',
          }}
        />

        {/* Input row */}
        <div className="flex items-center gap-3 px-5 py-4">
          <div
            className="flex h-9 w-9 flex-none items-center justify-center rounded-ctrl"
            style={{
              background: 'rgba(124,92,255,0.08)',
              border: '1px solid rgba(124,92,255,0.18)',
            }}
          >
            <FlowMark size={18} />
          </div>

          <input
            ref={inputRef}
            autoFocus
            disabled={loading}
            className="flex-1 bg-transparent text-[15px] font-medium tracking-display text-fg-0 placeholder-fg-300 outline-none disabled:opacity-60"
            placeholder={
              loading ? 'Composing plan…' : 'Tell FlowMind what to do'
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />

          {loading ? (
            <Spinner />
          ) : (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!value.trim()}
              className="flex flex-none items-center gap-1.5 rounded-ctrl px-3 py-[7px] text-[11px] font-semibold tracking-display text-fg-0 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30"
              style={{
                background: value.trim()
                  ? 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)'
                  : 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Run
              <IconArrow size={12} />
            </button>
          )}

          <button
            type="button"
            aria-label="Close"
            onClick={() => !loading && onClose?.()}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-ctrl text-fg-300 transition-colors duration-150 hover:text-fg-50 disabled:opacity-30"
            disabled={loading}
            style={{ background: 'transparent' }}
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Matched workflow banner */}
        {matchedWorkflow && !loading && (
          <div
            className="flex items-center gap-3 px-5 py-2.5 text-[12px] animate-fm-fade"
            style={{
              background: 'rgba(124,92,255,0.07)',
              borderTop: '1px solid rgba(124,92,255,0.18)',
            }}
          >
            <span className="text-fg-200">
              I&apos;ve done this before — {matchedWorkflow.actions.length} step
              {matchedWorkflow.actions.length === 1 ? '' : 's'}
              {matchedWorkflow.run_count > 0 && (
                <span className="text-fg-400">
                  {' · '}
                  {Math.round(matchedWorkflow.success_rate * 100)}% success
                </span>
              )}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => submit(true)}
              className="rounded-ctrl px-2.5 py-1 text-[11px] font-semibold tracking-display text-fg-0"
              style={{
                background: 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Replay
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              className="rounded-ctrl px-2.5 py-1 text-[11px] font-semibold tracking-display text-fg-200"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Re-plan
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="flex items-start gap-2 px-5 py-3 text-[12px] text-bad animate-fm-fade"
            style={{
              background: 'rgba(255,111,145,0.06)',
              borderTop: '1px solid rgba(255,111,145,0.2)',
            }}
          >
            <IconAlert size={13} className="mt-[2px] flex-none" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Recent commands */}
        {recentCommands.length > 0 && !loading && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="px-5 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-micro text-fg-400">
              Recent
            </div>
            <ul className="max-h-56 overflow-y-auto pb-2">
              {recentCommands.slice(0, 5).map((cmd, i) => (
                <li key={`${cmd}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSubmit?.(cmd)}
                    className="group flex w-full items-center gap-3 px-5 py-2 text-left text-[13px] text-fg-200 transition-colors duration-150"
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'rgba(124,92,255,0.06)';
                      el.style.color = '#E8E9F2';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = 'transparent';
                      el.style.color = '';
                    }}
                  >
                    <IconArrow
                      size={12}
                      className="flex-none text-fg-400 transition-colors duration-150 group-hover:text-accent-400"
                    />
                    <span className="truncate">{cmd}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bottom strip */}
        <div
          className="flex items-center justify-between px-5 py-2.5"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.04)',
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          <span className="text-[10px] uppercase tracking-micro text-fg-400">
            FlowMind · Operating Layer
          </span>
          <span className="flex items-center gap-2 text-[10px] text-fg-300">
            <Kbd>↵</Kbd>
            <span className="text-fg-400">run</span>
            <span className="text-fg-500">·</span>
            <Kbd>Esc</Kbd>
            <span className="text-fg-400">close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="rounded-[4px] px-1.5 py-[1px] font-mono text-[9px] text-fg-200"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 -1px 0 0 rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </kbd>
  );
}

function Spinner() {
  return (
    <span
      className="inline-flex h-5 w-5 flex-none items-center justify-center"
      aria-label="Loading"
    >
      <span
        className="block h-4 w-4 rounded-full border-[1.5px] border-accent-400 border-t-transparent"
        style={{ animation: 'spin 0.9s linear infinite' }}
      />
    </span>
  );
}
