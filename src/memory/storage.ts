import type { UserProfile, WorkflowMemory } from '../types';

export const API_KEY_STORAGE_KEY = 'gemini_api_key';
export const USER_PROFILE_STORAGE_KEY = 'user_profile';
export const WORKFLOWS_STORAGE_KEY = 'workflows';
export const PAST_COMMANDS_STORAGE_KEY = 'past_commands';

const PAST_COMMANDS_LIMIT = 50;

export async function saveApiKey(key: string): Promise<void> {
  await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: key });
}

export async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.sync.get(API_KEY_STORAGE_KEY);
  return (result[API_KEY_STORAGE_KEY] as string | undefined) ?? null;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.sync.set({ [USER_PROFILE_STORAGE_KEY]: profile });
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const result = await chrome.storage.sync.get(USER_PROFILE_STORAGE_KEY);
  return (result[USER_PROFILE_STORAGE_KEY] as UserProfile | undefined) ?? null;
}

export async function getWorkflows(): Promise<WorkflowMemory[]> {
  const result = await chrome.storage.local.get(WORKFLOWS_STORAGE_KEY);
  const raw = (result[WORKFLOWS_STORAGE_KEY] as Partial<WorkflowMemory>[] | undefined) ?? [];
  // Migrate legacy entries (pre-v1 schema) without touching disk on every read.
  return raw.map(migrateWorkflow);
}

function migrateWorkflow(w: Partial<WorkflowMemory>): WorkflowMemory {
  return {
    id: w.id ?? '',
    trigger: w.trigger ?? '',
    pattern: w.pattern ?? (w.trigger ? [w.trigger] : []),
    domain: w.domain ?? '',
    actions: w.actions ?? [],
    version: w.version ?? 1,
    created_at: w.created_at ?? w.last_run ?? Date.now(),
    last_run: w.last_run ?? 0,
    run_count: w.run_count ?? 0,
    success_rate: w.success_rate ?? 0,
    failure_reasons: w.failure_reasons ?? [],
    preferences: w.preferences ?? {},
    history: w.history ?? [],
    last_outcome: w.last_outcome,
  };
}

export async function saveWorkflow(workflow: WorkflowMemory): Promise<void> {
  const workflows = await getWorkflows();
  const idx = workflows.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) workflows[idx] = workflow;
  else workflows.push(workflow);
  await chrome.storage.local.set({ [WORKFLOWS_STORAGE_KEY]: workflows });
}

export async function deleteWorkflow(id: string): Promise<void> {
  const workflows = await getWorkflows();
  const filtered = workflows.filter((w) => w.id !== id);
  await chrome.storage.local.set({ [WORKFLOWS_STORAGE_KEY]: filtered });
}

export async function savePastCommand(intent: string): Promise<void> {
  const trimmed = intent.trim();
  if (!trimmed) return;
  const existing = await getPastCommands();
  const deduped = [trimmed, ...existing.filter((c) => c !== trimmed)];
  const capped = deduped.slice(0, PAST_COMMANDS_LIMIT);
  await chrome.storage.local.set({ [PAST_COMMANDS_STORAGE_KEY]: capped });
}

export async function getPastCommands(): Promise<string[]> {
  const result = await chrome.storage.local.get(PAST_COMMANDS_STORAGE_KEY);
  return (result[PAST_COMMANDS_STORAGE_KEY] as string[] | undefined) ?? [];
}
