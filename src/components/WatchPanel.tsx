import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAction, AgentEvent, ExecutionResult } from '../types';
import { FlowMark } from './brand/FlowMark';
import {
  IconAction,
  IconCheck,
  IconAlert,
  IconPause,
  IconPlay,
  IconStop,
  IconClock,
  IconSpark,
  IconRetry,
} from './brand/Icon';

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
  retryCount: number;
}

interface LogLine {
  id: number;
  text: string;
  kind: 'info' | 'thought';
  ts: number;
}

const PHASE = {
  running: { label: 'Running', tone: 'text-accent-400' },
  paused: { label: 'Paused', tone: 'text-warn' },
  complete: { label: 'Complete', tone: 'text-good' },
  failed: { label: 'Halted', tone: 'text-bad' },
} as const;

export function WatchPanel({ subscribe, onPause, onResume, onStop }: WatchPanelProps) {
  const [visible, setVisible] = useState(false);
  const [goal, setGoal] = useState<string>('');
  const [steps, setSteps] = useState<StepState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState<ExecutionResult | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const logIdRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      switch (event.type) {
        case 'plan_ready':
          setVisible(true);
          setFinished(false);
          setSummary(null);
          setPaused(false);
          setCurrentIndex(0);
          setSteps([]);
          setLogs([]);
          setGoal(event.message ?? '');
          setStartedAt(Date.now());
          break;
        case 'step_start':
          if (typeof event.step_index === 'number' && event.step) {
            const idx = event.step_index;
            const incoming = event.step;
            setCurrentIndex(idx);
            setSteps((prev) => {
              const next = [...prev];
              while (next.length <= idx) {
                next.push({
                  step: incoming,
                  status: 'pending',
                  retryCount: 0,
                });
              }
              const existing = next[idx];
              next[idx] = {
                step: incoming,
                status: 'active',
                retryCount:
                  existing && existing.status === 'error'
                    ? existing.retryCount + 1
                    : (existing?.retryCount ?? 0),
                errorMessage: undefined,
              };
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
        case 'log':
          if (event.message) {
            const text = event.message;
            const isThought = text.startsWith('🧠');
            setLogs((prev) => {
              const id = ++logIdRef.current;
              const entry: LogLine = {
                id,
                text: text.replace(/^🧠\s*/, ''),
                kind: isThought ? 'thought' : 'info',
                ts: Date.now(),
              };
              const next = [...prev, entry];
              return next.length > 6 ? next.slice(next.length - 6) : next;
            });
          }
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

  // Auto-dismiss after a successful run; keep visible on failure so the user can read the error.
  useEffect(() => {
    if (!finished) return;
    if (summary && !summary.success) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setSteps([]);
      setLogs([]);
      setGoal('');
      setSummary(null);
      setFinished(false);
      setCurrentIndex(0);
      setStartedAt(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [finished, summary]);

  // Live elapsed counter.
  useEffect(() => {
    if (!startedAt || finished) return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
  }, [startedAt, finished]);

  const completedCount = useMemo(
    () => steps.filter((s) => s.status === 'done').length,
    [steps],
  );
  const failedCount = useMemo(
    () => steps.filter((s) => s.status === 'error').length,
    [steps],
  );

  if (!visible) return null;

  const total = steps.length;
  const phase = finished
    ? summary && summary.success
      ? PHASE.complete
      : PHASE.failed
    : paused
      ? PHASE.paused
      : PHASE.running;

  const progress = total > 0
    ? Math.round((completedCount / total) * 100)
    : 0;
  const safeProgress = Math.min(100, progress);
  const activeStep = steps[currentIndex];

  function handlePauseResume() {
    if (paused) {
      setPaused(false);
      onResume?.();
    } else {
      onPause?.();
    }
  }

  return (
    <div
      role="region"
      aria-label="FlowMind mission control"
      className="fixed right-4 top-4 bottom-4 z-[2147483647] flex w-[380px] flex-col overflow-hidden rounded-panel font-sans text-fg-50 animate-fm-slide-right"
      style={{
        background:
          'linear-gradient(180deg, rgba(15,15,26,0.92) 0%, rgba(8,8,15,0.92) 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow:
          '0 24px 64px -24px rgba(0,0,0,0.6), 0 1px 0 0 rgba(255,255,255,0.04) inset',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      }}
    >
      {/* Header */}
      <header className="relative flex items-start gap-3 px-5 pt-5 pb-4">
        <div
          className="flex h-9 w-9 flex-none items-center justify-center rounded-ctrl"
          style={{
            background: 'rgba(124,92,255,0.08)',
            border: '1px solid rgba(124,92,255,0.18)',
          }}
        >
          <FlowMark size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-display text-fg-0">
              FlowMind
            </span>
            <span
              className="text-[9px] font-medium uppercase tracking-micro text-fg-300"
            >
              Mission Control
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
            <PhasePill phase={phase} />
            <span className="text-fg-300">
              {Math.min(currentIndex + 1, total || 1)}/{total || 0} steps
            </span>
            <span className="text-fg-400">·</span>
            <span className="text-fg-300">{formatElapsed(elapsed)}</span>
          </div>
        </div>
      </header>

      {/* Goal line */}
      {goal && (
        <div className="px-5 pb-3">
          <p
            className="line-clamp-2 text-[13px] leading-snug tracking-display text-fg-50"
            title={goal}
          >
            {goal}
          </p>
        </div>
      )}

      {/* Progress rail */}
      <div className="px-5 pb-4">
        <div
          className="relative h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${safeProgress}%`,
              background:
                phase === PHASE.failed
                  ? 'linear-gradient(90deg, #FF6F91, #FFB454)'
                  : phase === PHASE.complete
                    ? 'linear-gradient(90deg, #34D8B7, #4FA3FF)'
                    : 'linear-gradient(90deg, #7C5CFF, #4FA3FF)',
            }}
          />
          {!finished && !paused && (
            <div
              className="absolute inset-y-0 w-1/3 animate-fm-sweep"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
              }}
            />
          )}
        </div>
      </div>

      {/* Now Playing — current action */}
      {activeStep && !finished && (
        <NowPlaying
          step={activeStep.step}
          status={activeStep.status}
          retryCount={activeStep.retryCount}
        />
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SectionLabel>Timeline</SectionLabel>
        <ol className="mt-1 space-y-1">
          {steps.map((entry, i) => (
            <TimelineRow
              key={i}
              index={i}
              entry={entry}
              isLast={i === steps.length - 1}
            />
          ))}
          {steps.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-3 text-[12px] text-fg-300">
              <span
                className="inline-block h-2 w-2 rounded-full bg-accent-500 animate-fm-breathe"
              />
              Composing plan
            </li>
          )}
        </ol>

        {logs.length > 0 && (
          <>
            <SectionLabel className="mt-4">Signal</SectionLabel>
            <ul className="mt-1 space-y-1 px-1 pb-2">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="flex items-start gap-2 px-2 py-1.5 text-[11px] text-fg-200 animate-fm-fade"
                >
                  {log.kind === 'thought' ? (
                    <IconSpark size={12} className="mt-[2px] flex-none text-accent-400" />
                  ) : (
                    <span
                      className="mt-[5px] h-1 w-1 flex-none rounded-full bg-fg-300"
                    />
                  )}
                  <span className="min-w-0 flex-1 leading-snug">{log.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Summary card */}
      {summary && (
        <div
          className="mx-3 mb-3 rounded-card p-4 animate-fm-lift"
          style={{
            background: summary.success
              ? 'linear-gradient(180deg, rgba(52,216,183,0.08), rgba(79,163,255,0.04))'
              : 'linear-gradient(180deg, rgba(255,111,145,0.08), rgba(255,180,84,0.04))',
            border: summary.success
              ? '1px solid rgba(52,216,183,0.2)'
              : '1px solid rgba(255,111,145,0.22)',
          }}
        >
          <div className="flex items-center gap-2">
            {summary.success ? (
              <IconCheck size={14} className="text-good" />
            ) : (
              <IconAlert size={14} className="text-bad" />
            )}
            <span className="text-[11px] font-semibold uppercase tracking-micro text-fg-50">
              {summary.success ? 'Goal achieved' : 'Run halted'}
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-snug text-fg-100">
            {summary.summary}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[11px] tabular-nums text-fg-300">
            <span>{summary.steps_completed} done</span>
            {summary.steps_failed > 0 && (
              <span className="text-bad">{summary.steps_failed} failed</span>
            )}
            <span className="text-fg-400">·</span>
            <span>{formatElapsed(elapsed)}</span>
          </div>
        </div>
      )}

      {/* Footer — control bar */}
      <footer
        className="flex items-center gap-2 px-3 py-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <ControlButton
          onClick={handlePauseResume}
          disabled={finished}
          icon={paused ? <IconPlay size={13} /> : <IconPause size={13} />}
          label={paused ? 'Resume' : 'Pause'}
          tone="ghost"
        />
        <ControlButton
          onClick={onStop}
          disabled={finished}
          icon={<IconStop size={13} />}
          label="Stop"
          tone="halt"
        />
        <div className="ml-auto flex items-center gap-1.5 px-1 text-[10px] tabular-nums text-fg-400">
          <span className="text-good">{completedCount}</span>
          {failedCount > 0 && (
            <>
              <span>·</span>
              <span className="text-bad">{failedCount}</span>
            </>
          )}
          <span>/ {total || 0}</span>
        </div>
      </footer>
    </div>
  );
}

/* ─── subcomponents ─────────────────────────────────────────────── */

function PhasePill({ phase }: { phase: (typeof PHASE)[keyof typeof PHASE] }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-micro ${phase.tone}`}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        style={{ animation: phase.label === 'Running' ? 'fm-breathe 2.4s ease-in-out infinite' : undefined }}
      />
      {phase.label}
    </span>
  );
}

function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-3 text-[9px] font-semibold uppercase tracking-micro text-fg-400 ${className}`}
    >
      {children}
    </div>
  );
}

function NowPlaying({
  step,
  retryCount,
}: {
  step: AgentAction;
  status: StepStatus;
  retryCount: number;
}) {
  return (
    <div
      className="mx-3 mb-3 overflow-hidden rounded-card animate-fm-fade"
      style={{
        background:
          'linear-gradient(180deg, rgba(124,92,255,0.10) 0%, rgba(79,163,255,0.04) 100%)',
        border: '1px solid rgba(124,92,255,0.22)',
      }}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div
          className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-ctrl text-accent-400"
          style={{
            background: 'rgba(124,92,255,0.12)',
            border: '1px solid rgba(124,92,255,0.25)',
          }}
        >
          <IconAction kind={step.action} size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-semibold uppercase tracking-micro text-accent-400"
            >
              Now · {step.action.replace('_', ' ')}
            </span>
            {retryCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-chip bg-warn/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-micro text-warn">
                <IconRetry size={9} />
                retry {retryCount}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[13px] font-medium tracking-display text-fg-0">
            {step.description}
          </p>
          {(step.target_text || step.value) && (
            <p className="mt-1 truncate text-[11px] text-fg-300">
              {step.target_text && <span>“{step.target_text}”</span>}
              {step.target_text && step.value && (
                <span className="px-1 text-fg-400">·</span>
              )}
              {step.value && (
                <span className="font-mono text-fg-200">{truncate(step.value, 48)}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  index,
  entry,
  isLast,
}: {
  index: number;
  entry: StepState;
  isLast: boolean;
}) {
  const tone =
    entry.status === 'active'
      ? 'text-accent-400'
      : entry.status === 'done'
        ? 'text-good'
        : entry.status === 'error'
          ? 'text-bad'
          : 'text-fg-300';
  return (
    <li className="relative flex gap-3 px-3">
      {/* Rail */}
      <div className="relative flex w-4 flex-none flex-col items-center">
        <StatusGlyph status={entry.status} />
        {!isLast && (
          <span
            className="absolute top-4 bottom-[-6px] w-px"
            style={{
              background:
                entry.status === 'done'
                  ? 'linear-gradient(180deg, rgba(52,216,183,0.4), rgba(255,255,255,0.05))'
                  : 'rgba(255,255,255,0.06)',
            }}
          />
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 py-1.5 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-4 w-4 flex-none items-center justify-center rounded-[4px] ${tone}`}
            style={{
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <IconAction kind={entry.step.action} size={10} />
          </span>
          <span className="text-[10px] font-medium uppercase tracking-micro text-fg-300">
            {entry.step.action.replace('_', ' ')}
          </span>
          <span className="text-[10px] tabular-nums text-fg-400">·</span>
          <span className="text-[10px] tabular-nums text-fg-400">
            {String(index + 1).padStart(2, '0')}
          </span>
          {entry.retryCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-micro text-warn">
              <IconRetry size={9} />
              {entry.retryCount}
            </span>
          )}
        </div>
        <p
          className={`mt-0.5 truncate text-[12px] leading-snug ${
            entry.status === 'pending' ? 'text-fg-300' : 'text-fg-50'
          }`}
        >
          {entry.step.description}
        </p>
        {entry.errorMessage && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-bad/90">
            {entry.errorMessage}
          </p>
        )}
      </div>
    </li>
  );
}

function StatusGlyph({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span
        className="mt-2 flex h-4 w-4 flex-none items-center justify-center rounded-full text-good"
        style={{ background: 'rgba(52,216,183,0.14)', border: '1px solid rgba(52,216,183,0.35)' }}
      >
        <IconCheck size={10} strokeWidth={2} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="mt-2 flex h-4 w-4 flex-none items-center justify-center rounded-full text-bad"
        style={{ background: 'rgba(255,111,145,0.14)', border: '1px solid rgba(255,111,145,0.35)' }}
      >
        <IconAlert size={10} strokeWidth={1.6} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        className="mt-2 flex h-4 w-4 flex-none items-center justify-center rounded-full"
        style={{
          background: 'rgba(124,92,255,0.18)',
          border: '1px solid rgba(124,92,255,0.45)',
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full bg-accent-500 animate-fm-breathe"
        />
      </span>
    );
  }
  return (
    <span
      className="mt-2 flex h-4 w-4 flex-none items-center justify-center rounded-full"
      style={{ border: '1px solid rgba(255,255,255,0.12)' }}
    >
      <span className="h-1 w-1 rounded-full bg-fg-400" />
    </span>
  );
}

function ControlButton({
  onClick,
  disabled,
  icon,
  label,
  tone,
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone: 'ghost' | 'halt';
}) {
  const baseStyle: React.CSSProperties =
    tone === 'halt'
      ? {
          background: 'rgba(255,111,145,0.08)',
          border: '1px solid rgba(255,111,145,0.2)',
          color: '#FF6F91',
        }
      : {
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          color: '#C3C5D6',
        };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 items-center justify-center gap-2 rounded-ctrl px-3 py-[7px] text-[11px] font-semibold tracking-display transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
      style={baseStyle}
      onMouseEnter={(e) => {
        if (disabled) return;
        const el = e.currentTarget;
        el.style.background =
          tone === 'halt' ? 'rgba(255,111,145,0.16)' : 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        Object.assign(el.style, baseStyle);
      }}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/* ─── helpers ───────────────────────────────────────────────────── */

function formatElapsed(ms: number): string {
  if (ms < 1000) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
