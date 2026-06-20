/**
 * fixtures.ts
 * Provides an `extensionContext` fixture that launches Chrome with the
 * Hawkeye extension loaded.  Because Chrome extensions require a
 * persistent context (not a normal browser + incognito page), we use
 * chromium.launchPersistentContext with --load-extension.
 */
import { test as base, chromium, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const E2E_TMP_DIR = path.resolve(__dirname, '../.tmp');

export type HawkeyeFixtures = {
  context: BrowserContext;
  extensionId: string;
};

export const test = base.extend<HawkeyeFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(EXTENSION_PATH)) {
      throw new Error(
        `Extension dist not found at ${EXTENSION_PATH}. Run 'npm run build' in apps/extension first.`
      );
    }
    fs.mkdirSync(E2E_TMP_DIR, { recursive: true });
    const userDataDir = fs.mkdtempSync(path.join(E2E_TMP_DIR, 'profile-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-crash-reporter',
        '--disable-crashpad',
      ],
      viewport: { width: 1280, height: 800 },
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register so we can grab the extension ID
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    // URL is chrome-extension://<id>/...
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

export { expect } from '@playwright/test';
