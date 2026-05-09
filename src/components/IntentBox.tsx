import { useEffect, useRef, useState } from 'react';

interface IntentBoxProps {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  recentCommands?: string[];
  onSubmit?: (intent: string) => void;
  onClose?: () => void;
}

export function IntentBox({
  open,
  loading = false,
  error,
  recentCommands = [],
  onSubmit,
  onClose,
}: IntentBoxProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const loadingRef = useRef(loading);
  const onSubmitRef = useRef(onSubmit);
  const onCloseRef = useRef(onClose);

  valueRef.current = value;
  loadingRef.current = loading;
  onSubmitRef.current = onSubmit;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setValue('');
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Capture-phase native listener so we win the race against host pages
  // (YouTube, Gmail, etc.) that hijack Enter/Esc with their own listeners.
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

  function submit() {
    const text = value.trim();
    if (!text || loading) return;
    onSubmit?.(text);
  }

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-start justify-center pt-28"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose?.();
      }}
      onKeyDownCapture={(e) => e.stopPropagation()}
      onKeyUpCapture={(e) => e.stopPropagation()}
    >
      <div
        className="w-[620px] max-w-[90vw] overflow-hidden rounded-2xl animate-slide-up"
        style={{
          background: 'linear-gradient(180deg, #1a1728 0%, #13111f 100%)',
          border: '1px solid rgba(139,92,246,0.25)',
          boxShadow: '0 0 0 1px rgba(139,92,246,0.1), 0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(124,58,237,0.15)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.6), transparent)' }} />

        {/* Input row */}
        <div className="flex items-center gap-3 px-5 py-4">
          {/* Brand mark */}
          <div
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 0 10px rgba(124,58,237,0.4)' }}
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" stroke="white" strokeWidth="1.5">
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M3.22 12.78l1.42-1.42M11.36 4.64l1.42-1.42" strokeLinecap="round" />
            </svg>
          </div>

          <div className="relative flex-1">
            <input
              ref={inputRef}
              autoFocus
              disabled={loading}
              className="w-full bg-transparent text-base font-medium text-gray-100 placeholder-gray-600 outline-none disabled:opacity-60"
              placeholder={loading ? 'Generating plan…' : 'What should FlowMind do?'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          {loading ? (
            <Spinner />
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 0 10px rgba(124,58,237,0.3)' }}
            >
              ↵ Run
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className="flex items-center gap-2 px-5 py-2.5 text-xs text-red-300"
            style={{ background: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.2)' }}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 flex-none text-red-400">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 4a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5A.75.75 0 018 5zm0 6a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            {error}
          </div>
        )}

        {/* Recent commands */}
        {recentCommands.length > 0 && !loading && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-5 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-gray-600">
              Recent
            </div>
            <ul className="max-h-44 overflow-y-auto pb-2">
              {recentCommands.slice(0, 5).map((cmd, i) => (
                <li key={`${cmd}-${i}`}>
                  <button
                    onClick={() => onSubmit?.(cmd)}
                    className="group flex w-full items-center gap-3 px-5 py-2 text-left text-sm text-gray-400 transition-all duration-100"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.08)'; (e.currentTarget as HTMLElement).style.color = '#c4b5fd'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = ''; }}
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 flex-none text-gray-700 transition-colors group-hover:text-violet-400" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate">{cmd}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bottom tip */}
        <div
          className="flex items-center justify-between px-5 py-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.2)' }}
        >
          <span className="text-[10px] text-gray-700">FlowMind Autonomous Agent</span>
          <span className="text-[10px] text-gray-700">
            <kbd className="rounded px-1 py-0.5 text-[9px]" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>Esc</kbd>
            {' '}to close
          </span>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="relative flex-none">
      <span
        className="inline-block h-5 w-5 rounded-full border-2 border-violet-400 border-t-transparent"
        style={{ animation: 'spin 0.8s linear infinite' }}
        aria-label="Loading"
      />
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: 'rgba(124,58,237,0.1)', animation: 'pulse 1s ease-in-out infinite' }}
      />
    </div>
  );
}
