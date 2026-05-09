import { useEffect, useState } from 'react';
import {
  deleteWorkflow,
  getApiKey,
  getPastCommands,
  getWorkflows,
  saveApiKey,
} from '../memory/storage';
import { EMPTY_PROFILE, loadProfile, saveProfile } from '../context/user-profile';
import type { UserProfile, WorkflowMemory } from '../types';

type ToastTone = 'success' | 'error';

export function Popup() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);

  const [workflows, setWorkflows] = useState<WorkflowMemory[]>([]);
  const [commands, setCommands] = useState<string[]>([]);

  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);

  useEffect(() => {
    void (async () => {
      const [k, p, w, c] = await Promise.all([
        getApiKey(),
        loadProfile(),
        getWorkflows(),
        getPastCommands(),
      ]);
      if (k) setApiKey(k);
      setProfile(p);
      setWorkflows(w);
      setCommands(c.slice(0, 10));
    })();
  }, []);

  function flash(message: string, tone: ToastTone = 'success') {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 1800);
  }

  async function handleSaveKey() {
    setSavingKey(true);
    try {
      await saveApiKey(apiKey.trim());
      flash('API key saved');
    } catch (err) {
      flash((err as Error).message, 'error');
    } finally {
      setSavingKey(false);
    }
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      await saveProfile(profile);
      flash('Profile saved');
    } catch (err) {
      flash((err as Error).message, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleDeleteWorkflow(id: string) {
    await deleteWorkflow(id);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    flash('Workflow deleted');
  }

  function updateProfile<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="relative flex w-[420px] flex-col" style={{ background: 'linear-gradient(180deg, #13111f 0%, #0d0b18 100%)', minHeight: '100%' }}>
      {/* Ambient glow at top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-40" style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(124,58,237,0.5) 0%, transparent 70%)' }} />

      {/* Header */}
      <header className="relative flex items-center justify-between px-4 py-3.5" style={{ borderBottom: '1px solid rgba(139,92,246,0.15)' }}>
        <div className="flex items-center gap-2.5">
          {/* Animated orb */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75 animate-ping" style={{ animationDuration: '2s' }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #a78bfa, #6d28d9)' }} />
          </span>
          <h1 className="text-sm font-bold tracking-wide text-white" style={{ letterSpacing: '0.05em' }}>FlowMind</h1>
        </div>
        <span
          className="rounded-full px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
          style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
        >
          Autonomous Agent
        </span>
      </header>

      <div className="max-h-[560px] overflow-y-auto scrollbar-thin" style={{ scrollbarColor: 'rgba(124,58,237,0.3) transparent' }}>
        {/* API Key Section */}
        <Section title="Gemini API Key" subtitle="Stored in chrome.storage.sync" icon="🔑">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(139,92,246,0.2)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.6)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(139,92,246,0.1), inset 0 1px 0 rgba(255,255,255,0.04)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.2)'; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.04)'; }}
              />
            </div>
            <button
              onClick={() => setShowKey((v) => !v)}
              type="button"
              className="rounded-lg px-3 text-xs font-medium text-gray-400 transition-all duration-150 hover:text-gray-200"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1 text-[11px] text-violet-400 transition-colors hover:text-violet-300"
            >
              Get a free key
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
            <PrimaryButton onClick={handleSaveKey} disabled={savingKey || !apiKey.trim()} loading={savingKey}>
              Save key
            </PrimaryButton>
          </div>
        </Section>

        {/* User Profile Section */}
        <Section title="User Profile" subtitle="Used to fill forms automatically" icon="👤">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Name" value={profile.name} onChange={(v) => updateProfile('name', v)} />
            <Field label="Email" value={profile.email} onChange={(v) => updateProfile('email', v)} />
            <Field label="Phone" value={profile.phone} onChange={(v) => updateProfile('phone', v)} />
            <Field
              label="LinkedIn"
              value={profile.linkedin_url}
              onChange={(v) => updateProfile('linkedin_url', v)}
            />
            <Field
              label="GitHub"
              value={profile.github_url}
              onChange={(v) => updateProfile('github_url', v)}
            />
            <Field
              label="Portfolio"
              value={profile.portfolio_url}
              onChange={(v) => updateProfile('portfolio_url', v)}
            />
          </div>
          <TextArea
            label="Resume"
            placeholder="Paste resume text..."
            rows={3}
            value={profile.resume_text}
            onChange={(v) => updateProfile('resume_text', v)}
          />
          <TextArea
            label="Writing style"
            placeholder="Concise, friendly, technical..."
            rows={2}
            value={profile.writing_style}
            onChange={(v) => updateProfile('writing_style', v)}
          />
          <TextArea
            label="Custom instructions"
            placeholder="Any rules the agent should follow..."
            rows={2}
            value={profile.custom_instructions}
            onChange={(v) => updateProfile('custom_instructions', v)}
          />
          <div className="mt-3.5 flex justify-end">
            <PrimaryButton onClick={handleSaveProfile} disabled={savingProfile} loading={savingProfile}>
              Save profile
            </PrimaryButton>
          </div>
        </Section>

        {/* Saved Workflows */}
        <Section
          title="Saved Workflows"
          subtitle={workflows.length === 0 ? 'None yet — Learn Mode will create these' : `${workflows.length} saved`}
          icon="⚡"
        >
          {workflows.length === 0 ? (
            <Empty>Run an action and FlowMind will offer to remember it.</Empty>
          ) : (
            <ul className="space-y-2">
              {workflows.map((w) => (
                <li
                  key={w.id}
                  className="group flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-all duration-150"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md text-xs" style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
                    ⚡
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-100">{w.trigger}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="truncate">{w.domain}</span>
                      <span className="text-gray-700">·</span>
                      <span>{w.actions.length} steps</span>
                      <span className="text-gray-700">·</span>
                      <span>{w.run_count} runs</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteWorkflow(w.id)}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-400 opacity-0 transition-all duration-150 group-hover:opacity-100 hover:text-red-300"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Recent Commands */}
        <Section title="Recent Commands" subtitle="Last 10 intents" icon="🕒">
          {commands.length === 0 ? (
            <Empty>No commands yet. Press Cmd/Ctrl+Shift+K on any page to start.</Empty>
          ) : (
            <ul className="space-y-1">
              {commands.map((cmd, i) => (
                <li
                  key={`${cmd}-${i}`}
                  className="flex items-center gap-2 truncate rounded-lg px-3 py-1.5 text-xs text-gray-300 transition-colors duration-100"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                  title={cmd}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.06)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                >
                  <span className="flex-none text-[9px] font-bold tabular-nums text-gray-600">{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate">{cmd}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 animate-slide-up rounded-full px-4 py-2 text-xs font-medium shadow-lg"
          style={
            toast.tone === 'success'
              ? { background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)', backdropFilter: 'blur(8px)' }
              : { background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)', backdropFilter: 'blur(8px)' }
          }
        >
          {toast.tone === 'success' ? '✓ ' : '✕ '}{toast.message}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────── */

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-xs" style={{ background: 'rgba(124,58,237,0.15)' }}>
              {icon}
            </span>
          )}
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#c4b5fd' }}>{title}</h2>
        </div>
        {subtitle && <span className="text-[10px] text-gray-600">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-2.5 py-1.5 text-xs text-gray-100 placeholder-gray-700 outline-none transition-all duration-200"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139,92,246,0.1), inset 0 1px 0 rgba(255,255,255,0.03)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.03)'; }}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="mt-2.5 flex flex-col gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-600">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="resize-none rounded-lg px-2.5 py-2 text-xs text-gray-100 placeholder-gray-700 outline-none transition-all duration-200"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139,92,246,0.1), inset 0 1px 0 rgba(255,255,255,0.03)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.03)'; }}
      />
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className="group relative overflow-hidden rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 0 12px rgba(124,58,237,0.3)' }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(124,58,237,0.5)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(124,58,237,0.3)'; }}
    >
      <span className="relative flex items-center gap-1.5">
        {loading && (
          <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
        )}
        {loading ? 'Saving…' : children}
      </span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-4 py-4 text-center text-[11px] text-gray-600"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.07)' }}
    >
      {children}
    </div>
  );
}
