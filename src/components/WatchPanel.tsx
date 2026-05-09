import { useEffect, useState } from 'react';
import type { AgentAction, AgentEvent, ExecutionResult } from '../types';

export type AgentEventSubscriber = (handler: (event: AgentEvent) => void) => () => void;

interface WatchPanelProps {
  subscribe: AgentEventSubscriber;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface StepState {
  step: AgentAction;
  status: StepStatus;
  errorMessage?: string;
}

export function WatchPanel({ subscribe, onPause, onResume, onStop }: WatchPanelProps) {
  const [visible, setVisible] = useState(false);
  const [goal, setGoal] = useState<string>('');
  const [steps, setSteps] = useState<StepState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState<ExecutionResult | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case 'plan_ready':
          setVisible(true);
          setFinished(false);
          setSummary(null);
          setPaused(false);
          setCurrentIndex(0);
          setGoal(event.message ?? '');
          break;
        case 'step_start':
          if (typeof event.step_index === 'number') {
            setCurrentIndex(event.step_index);
          }
          if (event.step && typeof event.step_index === 'number') {
            const idx = event.step_index;
            const incoming = event.step;
            setSteps((prev) => {
              const next = [...prev];
              while (next.length <= idx) {
                next.push({ step: incoming, status: 'pending' });
              }
              next[idx] = { step: incoming, status: 'active' };
              return next;
            });
          }
          break;
        case 'step_complete':
          if (typeof event.step_index === 'number') {
            const idx = event.step_index;
            setSteps((prev) => {
              const next = [...prev];
              if (next[idx]) next[idx] = { ...next[idx], status: 'done' };
              return next;
            });
          }
          break;
        case 'step_error':
          if (typeof event.step_index === 'number') {
            const idx = event.step_index;
            const message = event.message;
            setSteps((prev) => {
              const next = [...prev];
              if (next[idx]) {
                next[idx] = { ...next[idx], status: 'error', errorMessage: message };
              }
              return next;
            });
          }
          break;
        case 'paused':
          setPaused(true);
          break;
        case 'done':
          setFinished(true);
          setPaused(false);
          if (event.result) setSummary(event.result);
          break;
      }
    });
    return unsubscribe;
  }, [subscribe]);

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setSteps([]);
      setGoal('');
      setSummary(null);
      setFinished(false);
      setCurrentIndex(0);
    }, 3000);
    return () => clearTimeout(timer);
  }, [finished]);

  if (!visible) return null;

  const total = steps.length;
  const progress = total > 0 ? Math.round(((currentIndex + (finished ? 1 : 0)) / total) * 100) : 0;
  const safeProgress = Math.min(100, progress);

  function handlePauseResume() {
    if (paused) {
      setPaused(false);
      onResume?.();
    } else {
      onPause?.();
    }
  }

  const statusLabel = finished ? 'Complete' : paused ? 'Paused' : 'Running';
  const statusColor = finished ? '#6ee7b7' : paused ? '#fbbf24' : '#a78bfa';

  return (
    <div
      className="fixed right-0 top-0 z-[2147483647] flex h-screen w-96 flex-col animate-slide-in-right"
      style={{
        background: 'linear-gradient(180deg, #13111f 0%, #0d0b18 100%)',
        borderLeft: '1px solid rgba(139,92,246,0.2)',
        boxShadow: '-4px 0 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(124,58,237,0.3) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative px-4 py-4" style={{ borderBottom: '1px solid rgba(139,92,246,0.15)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              {!finished && (
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: statusColor, animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' }}
                />
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: statusColor }} />
            </span>
            <span className="text-sm font-bold tracking-wide text-white">FlowMind</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium" style={{ color: statusColor }}>
              {statusLabel}
            </span>
            <span className="text-[10px] text-gray-600">
              {Math.min(currentIndex + 1, total || 1)}/{total || 0}
            </span>
          </div>
        </div>

        {goal && (
          <p className="mt-2 truncate text-xs text-gray-500" title={goal}>
            {goal}
          </p>
        )}

        {/* Progress bar */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${safeProgress}%`,
              background: finished
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : 'linear-gradient(90deg, #7c3aed, #4f46e5, #0ea5e9)',
              boxShadow: finished ? '0 0 8px rgba(16,185,129,0.5)' : '0 0 8px rgba(124,58,237,0.6)',
            }}
          />
        </div>
      </div>

      {/* Steps list */}
      <ul className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {steps.map((entry, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-all duration-200"
            style={
              entry.status === 'active'
                ? { background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 0 12px rgba(124,58,237,0.1)' }
                : entry.status === 'error'
                  ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
                  : entry.status === 'done'
                    ? { background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }
                    : { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }
            }
          >
            <StatusIcon status={entry.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}
                >
                  {entry.step.action}
                </span>
                <span className="truncate text-xs text-gray-300">{entry.step.description}</span>
              </div>
              {entry.errorMessage && (
                <p className="mt-1 truncate text-[11px] text-red-400">{entry.errorMessage}</p>
              )}
            </div>
          </li>
        ))}
        {steps.length === 0 && (
          <li className="flex items-center gap-2 px-3 py-3 text-xs text-gray-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-violet-400 border-t-transparent" />
            Generating plan…
          </li>
        )}
      </ul>

      {/* Summary */}
      {summary && (
        <div
          className="px-4 py-3 text-xs animate-fade-in"
          style={{ background: 'rgba(16,185,129,0.06)', borderTop: '1px solid rgba(16,185,129,0.2)' }}
        >
          <div className="flex items-center gap-2 font-semibold text-emerald-300">
            <span>✓</span> Summary
          </div>
          <p className="mt-1 text-gray-300">{summary.summary}</p>
          <p className="mt-1 text-gray-600">
            {summary.steps_completed} completed · {summary.steps_failed} failed
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          disabled={finished}
          onClick={handlePauseResume}
          className="flex-1 rounded-xl py-2 text-xs font-medium text-gray-300 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          onMouseEnter={(e) => { if (!finished) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.09)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          disabled={finished}
          onClick={onStop}
          className="flex-1 rounded-xl py-2 text-xs font-medium text-white transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.7)', boxShadow: '0 0 10px rgba(239,68,68,0.2)' }}
          onMouseEnter={(e) => { if (!finished) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(239,68,68,0.4)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 10px rgba(239,68,68,0.2)'; }}
        >
          ⏹ Stop
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full"
        style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399' }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full"
        style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        className="mt-1 h-3 w-3 flex-none rounded-full"
        style={{ background: '#8b5cf6', animation: 'pulse 1s cubic-bezier(0.4,0,0.6,1) infinite', boxShadow: '0 0 6px rgba(139,92,246,0.8)' }}
      />
    );
  }
  return (
    <span
      className="mt-1 h-3 w-3 flex-none rounded-full"
      style={{ border: '1px solid rgba(255,255,255,0.15)' }}
    />
  );
}
