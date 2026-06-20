import { defineConfig } from '@playwright/test';
import path from 'path';

const EXTENSION_PATH = path.resolve(__dirname, '../extension/dist');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Extension tests must use a persistent context launched via fixture
    headless: false,   // extensions require headed mode in Chromium
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'hawkeye-extension',
      use: {
        // Passed to the extensionContext fixture
        // @ts-ignore – custom fixture data
        extensionPath: EXTENSION_PATH,
      },
    },
  ],
});
