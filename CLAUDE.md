# FlowMind — Autonomous Browser Agent

## Stack
- Chrome Extension Manifest V3
- React 18 + TypeScript + Vite + Tailwind CSS
- AI: Google Gemini 1.5 Flash API (FREE)
- Storage: chrome.storage.local and chrome.storage.sync
- Bundler: Vite + CRXJS plugin

## Project Structure
src/
  agent/
    gemini-client.ts       # All Gemini API calls
    executor.ts            # Main execution loop
    dom-analyzer.ts        # Extract page elements
    action-runner.ts       # click/type/scroll/navigate
    tab-manager.ts         # Multi-tab operations
    prompts/
      system-prompt.ts     # Agent brain instructions
  memory/
    storage.ts             # chrome.storage wrapper
    learn-mode.ts          # Pattern detection
  context/
    user-profile.ts        # User data management
  components/
    IntentBox.tsx          # Cmd+K command bar
    WatchPanel.tsx         # Live execution viewer
    ActionHighlight.tsx    # Highlights DOM elements
  background/
    service-worker.ts
  content/
    content-script.ts
  popup/
    Popup.tsx
  types/
    index.ts               # ALL shared types live here

## Hard Rules
- API key stored in chrome.storage.sync under key 'gemini_api_key'
- NEVER hardcode API keys
- All types come from src/types/index.ts
- All Gemini calls go through src/agent/gemini-client.ts only
- Tailwind only, no inline styles
- Agent events use EventEmitter pattern for UI communication

## Gemini Model
Use: gemini-1.5-flash
Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent