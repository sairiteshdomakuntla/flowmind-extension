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
  const domJson = JSON.stringify(dom, null, 2);
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
  return `${AGENT_SYSTEM_PROMPT}

=== USER PROFILE ===
${profileContext}

${historyBlock}=== CURRENT PAGE ===
URL: ${dom.url}
Title: ${dom.title}

DOM Snapshot:
${domJson}

=== USER INTENT ===
${intent}

Decide the NEXT 1–3 steps based on what is on screen RIGHT NOW. If the user's intent is fully satisfied, return goal_complete: true with a single "finish" step. Respond with JSON only.`;
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
