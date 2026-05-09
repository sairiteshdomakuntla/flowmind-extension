export const TAB_MESSAGE_TYPES = {
  OPEN_TAB: 'TAB_OPEN',
  SWITCH_TAB: 'TAB_SWITCH',
  GET_CURRENT_TAB: 'TAB_GET_CURRENT',
  CLOSE_TAB: 'TAB_CLOSE',
} as const;

export type TabMessage =
  | { type: typeof TAB_MESSAGE_TYPES.OPEN_TAB; url: string; active?: boolean }
  | { type: typeof TAB_MESSAGE_TYPES.SWITCH_TAB; urlPattern: string }
  | { type: typeof TAB_MESSAGE_TYPES.GET_CURRENT_TAB }
  | { type: typeof TAB_MESSAGE_TYPES.CLOSE_TAB; tabId: number };

export type TabResponse =
  | { ok: true; tabId?: number; tab?: chrome.tabs.Tab }
  | { ok: false; error: string };

export async function openTab(url: string, active = false): Promise<number> {
  const tab = await chrome.tabs.create({ url, active });
  if (typeof tab.id !== 'number') {
    throw new Error('Failed to create tab: no tab id returned.');
  }
  return tab.id;
}

export async function switchToTab(urlPattern: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const matcher = buildMatcher(urlPattern);
  const match = tabs.find((t) => t.url && matcher(t.url));
  if (!match || typeof match.id !== 'number') {
    throw new Error(`No tab matches pattern: ${urlPattern}`);
  }
  await chrome.tabs.update(match.id, { active: true });
  if (typeof match.windowId === 'number') {
    await chrome.windows.update(match.windowId, { focused: true });
  }
}

export async function getCurrentTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('No active tab found.');
  }
  return tab.id;
}

export async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
}

function buildMatcher(pattern: string): (url: string) => boolean {
  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return (url) => regex.test(url);
  }
  const lower = pattern.toLowerCase();
  return (url) => url.toLowerCase().includes(lower);
}

export function registerTabMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Partial<TabMessage> | null;
    if (!msg || typeof msg.type !== 'string') return false;

    const respond = (response: TabResponse) => sendResponse(response);

    switch (msg.type) {
      case TAB_MESSAGE_TYPES.OPEN_TAB: {
        const m = msg as Extract<TabMessage, { type: 'TAB_OPEN' }>;
        openTab(m.url, m.active ?? false)
          .then((tabId) => respond({ ok: true, tabId }))
          .catch((err: Error) => respond({ ok: false, error: err.message }));
        return true;
      }
      case TAB_MESSAGE_TYPES.SWITCH_TAB: {
        const m = msg as Extract<TabMessage, { type: 'TAB_SWITCH' }>;
        switchToTab(m.urlPattern)
          .then(() => respond({ ok: true }))
          .catch((err: Error) => respond({ ok: false, error: err.message }));
        return true;
      }
      case TAB_MESSAGE_TYPES.GET_CURRENT_TAB: {
        getCurrentTabId()
          .then((tabId) => respond({ ok: true, tabId }))
          .catch((err: Error) => respond({ ok: false, error: err.message }));
        return true;
      }
      case TAB_MESSAGE_TYPES.CLOSE_TAB: {
        const m = msg as Extract<TabMessage, { type: 'TAB_CLOSE' }>;
        closeTab(m.tabId)
          .then(() => respond({ ok: true }))
          .catch((err: Error) => respond({ ok: false, error: err.message }));
        return true;
      }
      default:
        return false;
    }
  });
}
