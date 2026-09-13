import {defineConfig} from '@playwright/test';

const previewPort = Number(process.env.POLYMUX_UI_TEST_PORT ?? '4173');
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65_535)
  throw new Error('POLYMUX_UI_TEST_PORT must be a valid TCP port');
const rendererOutputKey = `ui-${previewPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // These interaction-heavy cases depend on foreground-frame and menu timing.
  // A single page keeps Chromium from background-throttling its sibling tabs.
  workers: 1,
  timeout: 60_000,
  reporter: 'line',
  use: {baseURL: `http://127.0.0.1:${previewPort}`, headless: true},
  webServer: {
    command: `POLYMUX_RENDERER_OUTPUT_KEY=${rendererOutputKey} VITE_POLYMUX_BROWSER_DEMO=true npm run build && POLYMUX_RENDERER_OUTPUT_KEY=${rendererOutputKey} npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
  },
});
