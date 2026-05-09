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
