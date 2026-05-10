import type { DOMSnapshot, ExecutionPlan, StepRecord, UserProfile } from '../types';
import { getApiKey } from '../memory/storage';
import { AGENT_SYSTEM_PROMPT } from './prompts/system-prompt';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export class MissingApiKeyError extends Error {
  constructor(message = 'Gemini API key not set. Configure it in the FlowMind popup.') {
    super(message);
    this.name = 'MissingApiKeyError';
  }
}

export class GeminiNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiNetworkError';
  }
}

export class GeminiApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

export class GeminiResponseParseError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
    this.name = 'GeminiResponseParseError';
  }
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: { message?: string; status?: string; code?: number };
  promptFeedback?: { blockReason?: string };
}

function profileToContext(profile: UserProfile | null): string {
  if (!profile) return 'No user profile data available.';
  const lines: string[] = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.email) lines.push(`Email: ${profile.email}`);
  if (profile.phone) lines.push(`Phone: ${profile.phone}`);
  if (profile.linkedin_url) lines.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.github_url) lines.push(`GitHub: ${profile.github_url}`);
  if (profile.portfolio_url) lines.push(`Portfolio: ${profile.portfolio_url}`);
  if (profile.resume_text) lines.push(`Resume:\n${profile.resume_text}`);
  if (profile.writing_style) lines.push(`Writing style: ${profile.writing_style}`);
  if (profile.custom_instructions)
    lines.push(`Custom instructions: ${profile.custom_instructions}`);
  if (lines.length === 0) return 'No user profile data available.';
  return `User Profile:\n${lines.join('\n')}`;
}

function buildPrompt(
  intent: string,
  dom: DOMSnapshot,
  profile: UserProfile | null,
  history: StepRecord[] = [],
): string {
  const profileContext = profileToContext(profile);
  const historyBlock = history.length
    ? `=== STEPS ALREADY EXECUTED (most recent last) ===
${history
  .map((h, i) => {
    const status = h.ok ? 'OK' : `FAIL: ${h.error ?? ''}`;
    const target = h.action.target_text || h.action.selector || '∅';
    const value = h.action.value ? ` value=${JSON.stringify(h.action.value).slice(0, 80)}` : '';
    const extracted = h.extracted ? ` extracted=${JSON.stringify(h.extracted).slice(0, 80)}` : '';
    return `${i + 1}. ${h.action.action} ${target}${value} → ${status}${extracted} (now at ${h.url_after})`;
  })
  .join('\n')}

`
    : '';
  const resultRich = (dom.page_model?.role_counts?.result_link ?? 0) >= 5;
  const mediaLinksBlock = !resultRich && dom.media_links && dom.media_links.length > 0
    ? `=== CONTENT/VIDEO LINKS ON THIS PAGE (media_links) ===
Use these verbatim when you need to click a result. Prefer media_links[0] for the first result.
${dom.media_links.map((ml, i) => `[${i}] title="${ml.title}" selector="${ml.selector}" href="${ml.href}"`).join('\n')}

`
    : '';

  const perceptionBlock = renderPerception(dom);
  const rawElementsBlock = renderInteractiveElementsCompact(dom);

  return `${AGENT_SYSTEM_PROMPT}

=== USER PROFILE ===
${profileContext}

${historyBlock}${mediaLinksBlock}=== CURRENT PAGE ===
URL: ${dom.url}
Title: ${dom.title}

${perceptionBlock}${rawElementsBlock}

=== USER INTENT ===
${intent}

Decide the NEXT 1–3 steps based on the PAGE MODEL above and the user intent.
Prefer affordances from the model — they are deduplicated, ranked, and labeled.
The raw RAW_ELEMENTS list is a fallback when no affordance fits. If the page is
blocked_by_overlay=true, your first step MUST clear the overlay.
If the user's intent is fully satisfied, return goal_complete: true with a single
"finish" step. Respond with JSON only.`;
}

function renderPerception(dom: DOMSnapshot): string {
  const m = dom.page_model;
  if (!m) return '';
  const aff = m.affordances
    .map((a) => {
      const flags: string[] = [];
      if (a.in_viewport) flags.push('viewport');
      if (a.id === m.primary_action_id) flags.push('PRIMARY');
      const flagStr = flags.length ? ` [${flags.join(',')}]` : '';
      const href = a.href ? ` href="${truncate(a.href, 60)}"` : '';
      const itype = a.input_type ? ` type=${a.input_type}` : '';
      const region = a.region && a.region !== 'unknown' ? ` region=${a.region}` : '';
      return `- id=${a.id} role=${a.role} sal=${a.salience} conf=${a.confidence}${flagStr}
  label="${truncate(a.label, 80)}"${itype}${region}${href}
  selector=${a.selector}`;
    })
    .join('\n');

  const counts = Object.entries(m.role_counts)
    .map(([role, n]) => `${role}=${n}`)
    .join(' ');

  const next = m.suggested_next_steps.length
    ? m.suggested_next_steps.map((s) => `  • ${s}`).join('\n')
    : '  (none)';

  return `=== PAGE MODEL (perception engine) ===
archetype: ${m.archetype}
workflow_phase: ${m.workflow_phase}
summary: ${m.summary}
primary_action_id: ${m.primary_action_id ?? '∅'}
blocked_by_overlay: ${m.blocked_by_overlay}
depth: ${m.depth}
role_counts: ${counts}
suggested_next_steps:
${next}

affordances (ranked by salience):
${aff || '(none)'}

`;
}

function renderInteractiveElementsCompact(dom: DOMSnapshot): string {
  // When perception is present, we keep the raw list as a fallback but
  // compress it heavily — one line per element, no JSON, capped to ~40.
  if (!dom.page_model) {
    return `\n=== RAW DOM SNAPSHOT ===\n${JSON.stringify(dom, null, 2)}\n`;
  }
  // When the page is rich in affordances, the raw list is mostly noise.
  const dense = (dom.page_model.affordances?.length ?? 0) >= 8;
  const cap = dense ? 30 : 40;
  const els = dom.interactive_elements.slice(0, cap);
  const lines = els.map((e) => {
    const parts: string[] = [];
    parts.push(e.tag);
    if (e.type) parts.push(`type=${e.type}`);
    if (e.id) parts.push(`id=${e.id}`);
    if (e.role) parts.push(`role=${e.role}`);
    if (e.aria_label) parts.push(`aria="${truncate(e.aria_label, 40)}"`);
    if (e.text) parts.push(`text="${truncate(e.text, 40)}"`);
    if (e.placeholder) parts.push(`ph="${truncate(e.placeholder, 30)}"`);
    parts.push(`sel=${e.selector}`);
    return `- ${parts.join(' ')}`;
  });
  const summaryLimit = dom.page_model.summary ? 800 : 2000;
  return `=== RAW_ELEMENTS (fallback only) ===
${lines.join('\n')}
${dom.interactive_elements.length > cap ? `… (${dom.interactive_elements.length - cap} more truncated)` : ''}
PAGE_TEXT: ${truncate(dom.page_text_summary, summaryLimit)}
`;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parsePlan(rawText: string, intent: string): ExecutionPlan {
  const jsonText = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new GeminiResponseParseError(
      `Failed to parse Gemini JSON: ${(err as Error).message}`,
      rawText,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new GeminiResponseParseError('Gemini response is not an object.', rawText);
  }

  const obj = parsed as Record<string, unknown>;
  const steps = Array.isArray(obj.steps) ? (obj.steps as ExecutionPlan['steps']) : [];

  return {
    goal: typeof obj.goal === 'string' ? obj.goal : intent,
    steps,
    estimated_steps:
      typeof obj.estimated_steps === 'number' ? obj.estimated_steps : steps.length,
    requires_multiple_tabs: Boolean(obj.requires_multiple_tabs),
    goal_complete: Boolean(obj.goal_complete),
    thought: typeof obj.thought === 'string' ? obj.thought : undefined,
  };
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiNetworkError(
      `Network error contacting Gemini: ${(err as Error).message}`,
    );
  }

  const rawText = await response.text();
  let data: GeminiResponse;
  try {
    data = JSON.parse(rawText) as GeminiResponse;
  } catch (err) {
    throw new GeminiResponseParseError(
      `Gemini returned non-JSON envelope: ${(err as Error).message}`,
      rawText,
    );
  }

  if (!response.ok || data.error) {
    const message = data.error?.message ?? `Gemini request failed (HTTP ${response.status})`;
    throw new GeminiApiError(message, response.status);
  }

  if (data.promptFeedback?.blockReason) {
    throw new GeminiApiError(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    throw new GeminiResponseParseError('Gemini response had no text content.', rawText);
  }
  return text;
}

export async function generateExecutionPlan(
  intent: string,
  dom: DOMSnapshot,
  profile: UserProfile | null,
  history: StepRecord[] = [],
): Promise<ExecutionPlan> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new MissingApiKeyError();

  const prompt = buildPrompt(intent, dom, profile, history);
  const text = await callGemini(apiKey, prompt);

  try {
    return parsePlan(text, intent);
  } catch (err) {
    if (!(err as Error).name?.includes('Parse')) throw err;
    const retryPrompt = `${prompt}\n\nIMPORTANT: respond ONLY with JSON. No prose, no markdown fences, no explanation. Output a single JSON object that matches the schema above.`;
    const retryText = await callGemini(apiKey, retryPrompt);
    return parsePlan(retryText, intent);
  }
}
