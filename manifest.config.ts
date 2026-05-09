import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'FlowMind',
  description: 'Autonomous browser agent powered by Gemini.',
  version: '0.1.0',
  action: {
    default_popup: 'index.html',
    default_title: 'FlowMind',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.tsx'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'tabs', 'scripting', 'activeTab'],
  host_permissions: ['<all_urls>'],
  commands: {
    'toggle-intent-box': {
      suggested_key: {
        default: 'Ctrl+Shift+K',
        mac: 'Command+Shift+K',
      },
      description: 'Open the FlowMind intent box',
    },
  },
});
