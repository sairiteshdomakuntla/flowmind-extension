// vite.config.ts
import { defineConfig } from "file:///D:/proj/flowmind-extension/node_modules/vite/dist/node/index.js";
import react from "file:///D:/proj/flowmind-extension/node_modules/@vitejs/plugin-react/dist/index.js";
import { crx } from "file:///D:/proj/flowmind-extension/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// manifest.config.ts
import { defineManifest } from "file:///D:/proj/flowmind-extension/node_modules/@crxjs/vite-plugin/dist/index.mjs";
var manifest_config_default = defineManifest({
  manifest_version: 3,
  name: "FlowMind",
  description: "Autonomous browser agent powered by Gemini.",
  version: "0.1.0",
  action: {
    default_popup: "index.html",
    default_title: "FlowMind"
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content-script.tsx"],
      run_at: "document_idle"
    }
  ],
  permissions: ["storage", "tabs", "scripting", "activeTab"],
  host_permissions: ["<all_urls>"],
  commands: {
    "toggle-intent-box": {
      suggested_key: {
        default: "Ctrl+Shift+K",
        mac: "Command+Shift+K"
      },
      description: "Open the FlowMind intent box"
    }
  }
});

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [react(), crx({ manifest: manifest_config_default })],
  build: {
    target: "esnext",
    sourcemap: true
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAibWFuaWZlc3QuY29uZmlnLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRDpcXFxccHJvalxcXFxmbG93bWluZC1leHRlbnNpb25cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXHByb2pcXFxcZmxvd21pbmQtZXh0ZW5zaW9uXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9wcm9qL2Zsb3dtaW5kLWV4dGVuc2lvbi92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB7IGNyeCB9IGZyb20gJ0Bjcnhqcy92aXRlLXBsdWdpbic7XG5pbXBvcnQgbWFuaWZlc3QgZnJvbSAnLi9tYW5pZmVzdC5jb25maWcnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgY3J4KHsgbWFuaWZlc3QgfSldLFxuICBidWlsZDoge1xuICAgIHRhcmdldDogJ2VzbmV4dCcsXG4gICAgc291cmNlbWFwOiB0cnVlLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IHRydWUsXG4gICAgaG1yOiB7XG4gICAgICBwb3J0OiA1MTczLFxuICAgIH0sXG4gIH0sXG59KTtcbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRDpcXFxccHJvalxcXFxmbG93bWluZC1leHRlbnNpb25cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXHByb2pcXFxcZmxvd21pbmQtZXh0ZW5zaW9uXFxcXG1hbmlmZXN0LmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovcHJvai9mbG93bWluZC1leHRlbnNpb24vbWFuaWZlc3QuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lTWFuaWZlc3QgfSBmcm9tICdAY3J4anMvdml0ZS1wbHVnaW4nO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVNYW5pZmVzdCh7XG4gIG1hbmlmZXN0X3ZlcnNpb246IDMsXG4gIG5hbWU6ICdGbG93TWluZCcsXG4gIGRlc2NyaXB0aW9uOiAnQXV0b25vbW91cyBicm93c2VyIGFnZW50IHBvd2VyZWQgYnkgR2VtaW5pLicsXG4gIHZlcnNpb246ICcwLjEuMCcsXG4gIGFjdGlvbjoge1xuICAgIGRlZmF1bHRfcG9wdXA6ICdpbmRleC5odG1sJyxcbiAgICBkZWZhdWx0X3RpdGxlOiAnRmxvd01pbmQnLFxuICB9LFxuICBiYWNrZ3JvdW5kOiB7XG4gICAgc2VydmljZV93b3JrZXI6ICdzcmMvYmFja2dyb3VuZC9zZXJ2aWNlLXdvcmtlci50cycsXG4gICAgdHlwZTogJ21vZHVsZScsXG4gIH0sXG4gIGNvbnRlbnRfc2NyaXB0czogW1xuICAgIHtcbiAgICAgIG1hdGNoZXM6IFsnPGFsbF91cmxzPiddLFxuICAgICAganM6IFsnc3JjL2NvbnRlbnQvY29udGVudC1zY3JpcHQudHN4J10sXG4gICAgICBydW5fYXQ6ICdkb2N1bWVudF9pZGxlJyxcbiAgICB9LFxuICBdLFxuICBwZXJtaXNzaW9uczogWydzdG9yYWdlJywgJ3RhYnMnLCAnc2NyaXB0aW5nJywgJ2FjdGl2ZVRhYiddLFxuICBob3N0X3Blcm1pc3Npb25zOiBbJzxhbGxfdXJscz4nXSxcbiAgY29tbWFuZHM6IHtcbiAgICAndG9nZ2xlLWludGVudC1ib3gnOiB7XG4gICAgICBzdWdnZXN0ZWRfa2V5OiB7XG4gICAgICAgIGRlZmF1bHQ6ICdDdHJsK1NoaWZ0K0snLFxuICAgICAgICBtYWM6ICdDb21tYW5kK1NoaWZ0K0snLFxuICAgICAgfSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT3BlbiB0aGUgRmxvd01pbmQgaW50ZW50IGJveCcsXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFzUSxTQUFTLG9CQUFvQjtBQUNuUyxPQUFPLFdBQVc7QUFDbEIsU0FBUyxXQUFXOzs7QUNGMFAsU0FBUyxzQkFBc0I7QUFFN1MsSUFBTywwQkFBUSxlQUFlO0FBQUEsRUFDNUIsa0JBQWtCO0FBQUEsRUFDbEIsTUFBTTtBQUFBLEVBQ04sYUFBYTtBQUFBLEVBQ2IsU0FBUztBQUFBLEVBQ1QsUUFBUTtBQUFBLElBQ04sZUFBZTtBQUFBLElBQ2YsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxZQUFZO0FBQUEsSUFDVixnQkFBZ0I7QUFBQSxJQUNoQixNQUFNO0FBQUEsRUFDUjtBQUFBLEVBQ0EsaUJBQWlCO0FBQUEsSUFDZjtBQUFBLE1BQ0UsU0FBUyxDQUFDLFlBQVk7QUFBQSxNQUN0QixJQUFJLENBQUMsZ0NBQWdDO0FBQUEsTUFDckMsUUFBUTtBQUFBLElBQ1Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxhQUFhLENBQUMsV0FBVyxRQUFRLGFBQWEsV0FBVztBQUFBLEVBQ3pELGtCQUFrQixDQUFDLFlBQVk7QUFBQSxFQUMvQixVQUFVO0FBQUEsSUFDUixxQkFBcUI7QUFBQSxNQUNuQixlQUFlO0FBQUEsUUFDYixTQUFTO0FBQUEsUUFDVCxLQUFLO0FBQUEsTUFDUDtBQUFBLE1BQ0EsYUFBYTtBQUFBLElBQ2Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzs7O0FENUJELElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxFQUFFLGtDQUFTLENBQUMsQ0FBQztBQUFBLEVBQ3BDLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFdBQVc7QUFBQSxFQUNiO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixLQUFLO0FBQUEsTUFDSCxNQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
