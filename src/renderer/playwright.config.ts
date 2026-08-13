import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'line',
  use: {baseURL: 'http://127.0.0.1:4173', headless: true},
  webServer: {
    command: 'VITE_MIDAS_BROWSER_DEMO=true npm run renderer:build && npm run renderer:preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
