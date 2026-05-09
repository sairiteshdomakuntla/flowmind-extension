import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useEffect, useState } from 'react';
import { IntentBox } from '../components/IntentBox';
import { WatchPanel } from '../components/WatchPanel';
import { ActionHighlight } from '../components/ActionHighlight';
import { FlowMindBadge } from '../components/FlowMindBadge';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { executor, loadPendingPlan, clearPendingPlan } from '../agent/executor';
import { savePastCommand, getPastCommands } from '../memory/storage';
import type { AgentEvent } from '../types';

import './content.css';

const ROOT_ID = 'flowmind-root';

function ensureRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
  }
  return root;
}

type IntentBoxEvent = Event & { detail?: { open?: boolean } };

const TOGGLE_EVENT = 'flowmind:toggle-intent';

function App() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeSelector, setActiveSelector] = useState<string | null>(null);

  useEffect(() => {
    void getPastCommands().then((c) => setRecent(c.slice(0, 10)));
  }, []);

  // Resume an in-flight plan that survived a navigation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = await loadPendingPlan();
      if (!pending || cancelled) return;
      if (executor.isRunning()) return;
      // Give the page a beat to settle before re-snapshotting / acting.
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled) return;
      try {
        await executor.resumePlan(pending);
      } catch (err) {
        console.warn('[FlowMind] resume failed:', err);
        await clearPendingPlan();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handler(e: IntentBoxEvent) {
      if (executor.isRunning()) return;
      const next = e.detail?.open ?? !open;
      setOpen(next);
      if (next) setError(null);
    }
    function keyHandler(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (!modifier || !e.shiftKey || e.key.toLowerCase() !== 'k') return;
      if (e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
    }
    window.addEventListener(TOGGLE_EVENT, handler as EventListener);
    window.addEventListener('keydown', keyHandler, true);
    return () => {
      window.removeEventListener(TOGGLE_EVENT, handler as EventListener);
      window.removeEventListener('keydown', keyHandler, true);
    };
  }, [open]);

  useEffect(() => {
    return executor.on((event: AgentEvent) => {
      if (event.type === 'step_start' && event.step?.selector) {
        setActiveSelector(event.step.selector);
      } else if (
        event.type === 'step_complete' ||
        event.type === 'step_error' ||
        event.type === 'done'
      ) {
        setActiveSelector(null);
      }
    });
  }, []);

  function subscribe(handler: (event: AgentEvent) => void) {
    return executor.on(handler);
  }

  async function handleSubmit(intent: string) {
    if (!intent.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await savePastCommand(intent);
      setRecent((prev) => [intent, ...prev.filter((c) => c !== intent)].slice(0, 10));
      let planReady = false;
      const off = executor.on((event) => {
        if (event.type === 'plan_ready') {
          planReady = true;
          setOpen(false);
          setLoading(false);
          off();
        } else if (event.type === 'done') {
          setLoading(false);
          off();
        }
      });
      const result = await executor.run(intent);
      if (!planReady && !result.success) {
        setError(result.errors[0] ?? result.summary);
        setLoading(false);
      } else if (!result.success && result.errors.length > 0) {
        console.warn('[FlowMind] execution finished with errors:', result.errors);
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <>
      <ErrorBoundary label="badge">
        <FlowMindBadge
          hidden={open}
          onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_EVENT))}
        />
      </ErrorBoundary>
      <ErrorBoundary label="intent-box">
        <IntentBox
          open={open}
          loading={loading}
          error={error}
          recentCommands={recent}
          onSubmit={handleSubmit}
          onClose={() => {
            if (!loading) setOpen(false);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary label="watch-panel">
        <WatchPanel
          subscribe={subscribe}
          onPause={() => executor.pause()}
          onResume={() => executor.resume()}
          onStop={() => executor.stop()}
        />
      </ErrorBoundary>
      <ErrorBoundary label="highlight">
        <ActionHighlight selector={activeSelector} />
      </ErrorBoundary>
    </>
  );
}

let root: Root | null = null;

function mount() {
  const container = ensureRoot();
  if (root) return;
  root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

mount();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'TOGGLE_INTENT_BOX') {
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
  }
});
