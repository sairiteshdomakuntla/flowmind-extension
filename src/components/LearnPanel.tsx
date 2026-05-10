import { useEffect, useState } from 'react';
import { learnMode } from '../memory/learn-mode';
import { learnListener } from '../content/learn-listener';
import { makeWorkflow } from '../memory/workflow-store';
import { saveWorkflow } from '../memory/storage';
import type { AgentAction } from '../types';

type Phase = 'idle' | 'recording' | 'naming';

interface LearnPanelProps {
  /** Optional: notify the host when a workflow is saved (e.g. to refresh menus). */
  onSaved?: () => void;
}

export function LearnPanel({ onSaved }: LearnPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(0);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<AgentAction[]>([]);

  useEffect(() => {
    return learnMode.onActionRecorded((_action, total) => {
      setCount(total);
    });
  }, []);

  function startRecording() {
    setError(null);
    setCount(0);
    learnMode.start();
    learnListener.attach();
    setPhase('recording');
  }

  function stopRecording() {
    learnListener.detach();
    const actions = learnMode.stop();
    setRecorded(actions);
    if (actions.length === 0) {
      setError('No actions recorded — try again.');
      setPhase('idle');
      return;
    }
    setPhase('naming');
  }

  async function save() {
    const triggerPhrase = trigger.trim() || name.trim();
    if (!triggerPhrase) {
      setError('Trigger phrase required.');
      return;
    }
    try {
      const wf = makeWorkflow({
        trigger: triggerPhrase,
        domain: location.hostname,
        actions: recorded,
      });
      await saveWorkflow(wf);
      onSaved?.();
      reset();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function reset() {
    setPhase('idle');
    setCount(0);
    setName('');
    setTrigger('');
    setError(null);
    setRecorded([]);
  }

  function discard() {
    if (phase === 'recording') {
      learnListener.detach();
      learnMode.stop();
    }
    reset();
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-[2147483646] w-[280px] rounded-panel font-sans text-fg-100"
      style={{
        background: 'linear-gradient(180deg, rgba(15,15,26,0.96) 0%, rgba(8,8,15,0.96) 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 20px 60px -15px rgba(0,0,0,0.6)',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span className="text-[10px] uppercase tracking-micro text-fg-300">Teach FlowMind</span>
        {phase === 'recording' && (
          <span className="flex items-center gap-1.5 text-[10px] text-bad">
            <span
              className="block h-1.5 w-1.5 rounded-full bg-bad"
              style={{ animation: 'pulse 1.2s ease-in-out infinite' }}
            />
            REC · {count}
          </span>
        )}
      </div>

      {phase === 'idle' && (
        <div className="px-4 py-3">
          <p className="mb-3 text-[12px] leading-snug text-fg-300">
            Demonstrate a task once. FlowMind records your clicks and keystrokes
            and replays them on demand.
          </p>
          <button
            type="button"
            onClick={startRecording}
            className="w-full rounded-ctrl px-3 py-1.5 text-[12px] font-semibold tracking-display text-fg-0"
            style={{
              background: 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            Start recording
          </button>
          {error && <p className="mt-2 text-[11px] text-bad">{error}</p>}
        </div>
      )}

      {phase === 'recording' && (
        <div className="px-4 py-3">
          <p className="mb-3 text-[12px] leading-snug text-fg-300">
            Recording on <span className="text-fg-100">{location.hostname}</span> —
            perform the task now.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={stopRecording}
              className="flex-1 rounded-ctrl px-3 py-1.5 text-[12px] font-semibold tracking-display text-fg-0"
              style={{
                background: 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Stop & save
            </button>
            <button
              type="button"
              onClick={discard}
              className="rounded-ctrl px-3 py-1.5 text-[12px] font-semibold text-fg-200"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'naming' && (
        <div className="px-4 py-3 space-y-2.5">
          <p className="text-[11px] leading-snug text-fg-300">
            {recorded.length} action{recorded.length === 1 ? '' : 's'} captured.
            Name this workflow.
          </p>
          <input
            type="text"
            placeholder="Trigger phrase (e.g. search hn for {topic})"
            className="w-full rounded-ctrl bg-transparent px-2.5 py-1.5 text-[12px] text-fg-100 placeholder-fg-400 outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            placeholder="Optional name"
            className="w-full rounded-ctrl bg-transparent px-2.5 py-1.5 text-[12px] text-fg-100 placeholder-fg-400 outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              className="flex-1 rounded-ctrl px-3 py-1.5 text-[12px] font-semibold tracking-display text-fg-0"
              style={{
                background: 'linear-gradient(135deg, #7C5CFF 0%, #4FA3FF 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={discard}
              className="rounded-ctrl px-3 py-1.5 text-[12px] font-semibold text-fg-200"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Discard
            </button>
          </div>
          {error && <p className="text-[11px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
