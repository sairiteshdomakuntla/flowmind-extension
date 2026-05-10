import { registerTabMessageHandlers } from '../agent/tab-manager';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[FlowMind] installed');
});

registerTabMessageHandlers();

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-intent-box') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INTENT_BOX' });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void message;
  void sendResponse;
  // TODO: route messages between content scripts, popup, and the executor.
  return false;
});

/**
 * Forward top-frame navigations to the active tab's content script so a
 * Teach-Once recording can synthesize a `navigate` action even though the
 * page reload destroys in-page state.
 */
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (details.transitionType === 'auto_subframe') return;
  chrome.tabs
    .sendMessage(details.tabId, {
      type: 'LEARN_NAVIGATION',
      url: details.url,
      transition: details.transitionType,
    })
    .catch(() => {
      // Content script may not be present (chrome:// pages, etc.) — ignore.
    });
});
