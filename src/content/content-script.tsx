import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useEffect, useState } from 'react';
import { IntentBox } from '../components/IntentBox';
import { WatchPanel } from '../components/WatchPanel';
import { ActionHighlight } from '../components/ActionHighlight';
import { FlowMindBadge } from '../components/FlowMindBadge';
import { LearnPanel } from '../components/LearnPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { executor, loadPendingPlan, clearPendingPlan } from '../agent/executor';
import { savePastCommand, getPastCommands } from '../memory/storage';
import { matchByIntent } from '../memory/workflow-store';
import { learnMode } from '../memory/learn-mode';
import type { AgentEvent, WorkflowMemory } from '../types';

// Tailwind output, imported as a raw string so we can inject it into a
// Shadow DOM root and keep its `@tailwind base` (Preflight) reset from
// leaking into the host page.
import contentCss from './content.css?inline';

const HOST_ID = 'flowmind-shadow-host';

interface MountTarget {
  /** Container element actually rendered into (lives inside the shadow root). */
  container: HTMLElement;
  /** The shadow root, exposed for components that need a non-document scope. */
  shadowRoot: ShadowRoot;
}

function ensureRoot(): MountTarget {
  let host = document.getElementById(HOST_ID) as HTMLElement | null;
  if (host && host.shadowRoot) {
    const inner = host.shadowRoot.getElementById('flowmind-root') as HTMLElement | null;
    if (inner) return { container: inner, shadowRoot: host.shadowRoot };
  }

  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    // Neutralize any host-page styles targeting our host element. The shadow
    // tree owns its own visuals; the host is just an anchor.
    host.style.all = 'initial';
    host.style.position = 'static';
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

  // Inject Tailwind + component CSS scoped to this shadow root only.
  const style = document.createElement('style');
  style.textContent = contentCss;
  shadow.appendChild(style);

  const inner = document.createElement('div');
  inner.id = 'flowmind-root';
  shadow.appendChild(inner);

  return { container: inner, shadowRoot: shadow };
}

type IntentBoxEvent = Event & { detail?: { open?: boolean } };

const TOGGLE_EVENT = 'flowmind:toggle-intent';

function App() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeSelector, setActiveSelector] = useState<string | null>(null);
  const [matchedWorkflow, setMatchedWorkflow] = useState<WorkflowMemory | null>(null);
  const [showLearn, setShowLearn] = useState(false);

  useEffect(() => {
    void getPastCommands().then((c) => setRecent(c.slice(0, 10)));
  }, []);

  async function handleIntentChange(intent: string) {
    const text = intent.trim();
    if (text.length < 3) {
      setMatchedWorkflow(null);
      return;
    }
    try {
      const match = await matchByIntent(text, location.hostname);
      setMatchedWorkflow(match?.workflow ?? null);
    } catch {
      setMatchedWorkflow(null);
    }
  }

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
      if (!modifier || !e.shiftKey) return;
      if (e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
        return;
      }
      if (key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        setShowLearn((v) => !v);
      }
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

  async function handleSubmit(intent: string, opts?: { replayWorkflow?: WorkflowMemory }) {
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
      const replay = !!opts?.replayWorkflow;
      const workflow = opts?.replayWorkflow ?? matchedWorkflow ?? undefined;
      const result = await executor.run(
        intent,
        workflow ? { workflow, mode: replay ? 'replay' : 'agentic' } : undefined,
      );
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
          matchedWorkflow={matchedWorkflow}
          onIntentChange={handleIntentChange}
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
      {showLearn && (
        <ErrorBoundary label="learn-panel">
          <LearnPanel />
        </ErrorBoundary>
      )}
    </>
  );
}

let root: Root | null = null;

function mount() {
  const { container } = ensureRoot();
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
  } else if (message?.type === 'LEARN_NAVIGATION' && learnMode.isActive()) {
    const url = message.url as string | undefined;
    if (url && url !== learnMode.getStartUrl()) {
      learnMode.record({
        action: 'navigate',
        value: url,
        description: `Navigate to ${url}`,
      });
    }
  }
});
