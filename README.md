# FlowMind

Autonomous browser agent — a Chrome MV3 extension powered by Google Gemini 1.5 Flash.

## Stack
- Manifest V3 Chrome extension
- React 18 + TypeScript + Vite + `@crxjs/vite-plugin`
- Tailwind CSS
- Gemini 1.5 Flash (free tier)

## Setup

```bash
npm install
npm run build
```

The build output lands in `dist/`.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `dist/` folder.

## Configure the Gemini API key

1. Get a free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Click the FlowMind toolbar icon to open the popup.
3. Paste the key and click **Save**. The key is stored in `chrome.storage.sync` under `gemini_api_key` and is never bundled into the source.

## Use it

- Press **Ctrl+K** (or **Cmd+K** on macOS) on any page to open the intent box.
- Type what you want done, hit Enter, and watch FlowMind plan and execute the steps.

## Develop

```bash
npm run dev        # vite dev server with HMR for the popup
npm run type-check # tsc --noEmit
npm run build      # production build into dist/
```

After running `npm run dev`, reload the unpacked extension in `chrome://extensions` to pick up changes to the background/content scripts. Popup HMR works without reloading.

## Project layout

```
src/
  agent/        Gemini client, executor, DOM analyzer, action runner, tab manager
  memory/       chrome.storage wrappers, learn-mode recorder
  context/      User profile management
  components/   IntentBox, WatchPanel, ActionHighlight
  background/   Service worker
  content/      Content script
  popup/        Toolbar popup (React)
  types/        Shared TypeScript types — single source of truth
```

## Hard rules

- The Gemini API key lives only in `chrome.storage.sync` under the key `gemini_api_key`.
- All Gemini calls go through `src/agent/gemini-client.ts`.
- All shared types live in `src/types/index.ts`.
- Tailwind classes only — no inline styles.
