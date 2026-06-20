/**
 * extension.spec.ts
 * End-to-end tests for the Hawkeye Chrome extension.
 *
 * Tests are grouped by concern:
 *  1. Extension loads & service worker registers
 *  2. Side panel opens
 *  3. Content script injects on a real page
 *  4. replace_text tool works (no iframe)
 *  5. read_page returns elements
 *  6. Agent: direct tool call (replace_text) without API key shows correct error
 */
import { test, expect } from './fixtures';
import http from 'http';
import type { Socket } from 'net';

async function withTestServer<T>(
  html: string | ((req: http.IncomingMessage) => string),
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(typeof html === 'function' ? html(req) : html);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start test server');

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
}

async function getTabId(extensionPage: any, urlPrefix: string): Promise<number> {
  return extensionPage.evaluate((prefix: string) => new Promise<number>((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      const tab = tabs.find((t) => t.url?.startsWith(prefix));
      if (tab?.id) resolve(tab.id);
      else reject(new Error(`No tab found for ${prefix}`));
    });
  }), urlPrefix);
}

async function sendExtensionMessage(extensionPage: any, message: any): Promise<any> {
  return extensionPage.evaluate((msg: any) => new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  }), message);
}

async function replayFlow(
  extensionPage: any,
  tabId: number,
  flow: any,
  repeatCount: number,
  dataMode: 'same' | 'random',
  fieldStrategies?: Record<string, 'same' | 'random'>
): Promise<any[]> {
  return extensionPage.evaluate(
    ({ tabId: targetTabId, flow: targetFlow, repeatCount: runs, dataMode: mode, fieldStrategies: strategies }) => new Promise<any[]>((resolve, reject) => {
      const timeoutMs = Math.max(30_000, runs * (targetFlow.steps.length * 1_000 + 3_000));
      const timer = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error('Timed out waiting for replay completion'));
      }, timeoutMs);

      const listener = (msg: any) => {
        if (msg.type !== 'FLOW_REPLAY_EVENT') return;
        if (msg.payload?.type === 'all_done') {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg.payload.results ?? []);
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'FLOW_REPLAY',
        tabId: targetTabId,
        payload: { flow: targetFlow, repeatCount: runs, dataMode: mode, fieldStrategies: strategies },
      }, (res) => {
        if (res?.error) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error(res.error));
        }
      });
    }),
    { tabId, flow, repeatCount, dataMode, fieldStrategies }
  );
}

// ─── 1. Extension loads ────────────────────────────────────────────────────────
test('service worker registers and has a valid extension ID', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

// ─── 2. Side panel page is accessible ─────────────────────────────────────────
test('side panel HTML is reachable', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForSelector('#root');
  // Chat greeting should appear
  await expect(page.getByText('Hawkeye', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.close();
});

// ─── 3. Content script injects ────────────────────────────────────────────────
test('content script loads on a real page', async ({ context }) => {
  const page = await context.newPage();
  const consoleMessages: string[] = [];
  page.on('console', (msg) => consoleMessages.push(msg.text()));

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  // Give content script a moment to run
  await page.waitForTimeout(1500);

  const injected = consoleMessages.some((m) => m.includes('[Hawkeye] Content script loaded'));
  expect(injected).toBe(true);
  await page.close();
});

// ─── 4. replace_text works via executeScript ──────────────────────────────────
test('replace_text: replaces visible text on a page', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'load' });

  // Confirm original text exists
  await expect(page.locator('h1')).toContainText('Example Domain');

  // Directly call the same logic replace_text uses (TreeWalker text replacement)
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.nodeValue?.includes('Example Domain')) {
        node.nodeValue = node.nodeValue.replace('Example Domain', 'REPLACED DOMAIN');
      }
    }
  });

  await expect(page.locator('h1')).toContainText('REPLACED DOMAIN');
  await page.close();
});

// ─── 5. read_page returns elements ────────────────────────────────────────────
test('read_page executeScript logic returns expected structure', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'load' });

  const result = await page.evaluate(() => {
    const textSections = Array.from(
      document.querySelectorAll('h1,h2,h3,h4,p,[role="heading"]')
    )
      .slice(0, 30)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 200) ?? '' }))
      .filter((s) => s.text.length > 0);

    const interactive = Array.from(
      document.querySelectorAll('a,button,input,select,textarea')
    ).length;

    return { textSections, interactive, url: location.href, title: document.title };
  });

  expect(result.url).toBe('https://example.com/');
  expect(result.title).toBeTruthy();
  expect(result.textSections.length).toBeGreaterThan(0);
  expect(result.textSections[0].tag).toMatch(/^h[1-4]|p$/);

  await page.close();
});

// ─── 6. Side panel: no API key shows correct warning ─────────────────────────
test('side panel: sending a message without API key shows settings warning', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForSelector('#root');
  await page.waitForTimeout(1000);

  // Clear any stored API key
  await page.evaluate(() =>
    new Promise<void>((res) => chrome.storage.local.remove('gemini_api_key', res))
  );

  // Type and send a message
  const input = page.locator('input[placeholder*="Hawkeye"]');
  await input.fill('change the heading to TEST');
  await input.press('Enter');

  // Should show the "add API key" warning, not crash
  await expect(page.locator('text=Settings')).toBeVisible({ timeout: 8_000 });
  await page.close();
});

// ─── 7. Actions dropdown opens with correct items ─────────────────────────────
test('Actions dropdown shows Settings and Record Flows', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await page.waitForSelector('#root');
  await page.waitForTimeout(500);

  await page.locator('button', { hasText: 'Actions' }).click();

  await expect(page.locator('text=Settings')).toBeVisible();
  await expect(page.locator('text=Record Flows')).toBeVisible();
  await page.close();
});

test('records manual form actions and replays same or random data', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html>
    <html>
      <body>
        <form id="booking">
          <label>First name <input id="firstName" name="firstName" autocomplete="given-name"></label>
          <label>Last name <input id="lastName" name="lastName" autocomplete="family-name"></label>
          <label>Email <input id="email" name="email" type="email"></label>
          <label>Phone <input id="phone" name="phone" type="tel"></label>
          <label>Service <select id="service" name="service"><option value="">Choose</option><option value="oil">Oil change</option></select></label>
          <label>Notes <textarea id="notes" name="notes"></textarea></label>
          <button id="submit" type="submit">Submit</button>
        </form>
        <script>
          window.__submits = [];
          document.querySelector('#booking').addEventListener('submit', (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            window.__submits.push(Object.fromEntries(new FormData(form).entries()));
            form.reset();
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.waitForSelector('#submit');

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#firstName').fill('Sam');
    await target.locator('#lastName').fill('Tester');
    await target.locator('#email').fill('sam.tester@example.com');
    await target.locator('#phone').fill('555-222-1212');
    await target.locator('#service').selectOption('oil');
    await target.locator('#notes').fill('manual note');
    await target.locator('#submit').click();

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.map((s: any) => s.tool)).toEqual(expect.arrayContaining(['type_text', 'select_option', 'click']));
    expect(steps.some((s: any) => s.meta?.dataKind === 'email')).toBe(true);

    const flow = { id: 'flow_test', name: 'Booking test', domain: '127.0.0.1', createdAt: Date.now(), steps, stepCount: steps.length };

    await target.evaluate(() => { (window as any).__submits = []; });
    const sameResults = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(sameResults).toHaveLength(1);
    expect(sameResults[0].ok).toBe(true);
    const sameSubmits = await target.evaluate(() => (window as any).__submits);
    expect(sameSubmits).toEqual([{
      firstName: 'Sam',
      lastName: 'Tester',
      email: 'sam.tester@example.com',
      phone: '555-222-1212',
      service: 'oil',
      notes: 'manual note',
    }]);

    await target.evaluate(() => { (window as any).__submits = []; });
    const randomResults = await replayFlow(extensionPage, tabId, flow, 3, 'random');
    expect(randomResults).toHaveLength(3);
    expect(randomResults.every((r) => r.ok)).toBe(true);
    const randomSubmits = await target.evaluate(() => (window as any).__submits);
    expect(randomSubmits).toHaveLength(3);
    expect(new Set(randomSubmits.map((s: any) => s.email)).size).toBe(3);
    for (const submit of randomSubmits) {
      expect(submit.email).toMatch(/@testmail\.com$/);
      expect(submit.phone).toMatch(/^\(555\) \d{3}-\d{4}$/);
      expect(submit.service).toBe('oil');
    }

    const saved = await sendExtensionMessage(extensionPage, {
      type: 'FLOW_SAVE',
      payload: {
        name: 'Booking test saved',
        domain: '127.0.0.1',
        steps,
        replayDefaults: { repeatCount: 2, dataMode: 'same', fieldStrategies: {} },
      },
    });
    expect(saved.flow?.version).toBe(1);
    expect(saved.flow?.fields?.some((f: any) => f.dataKind === 'email')).toBe(true);
    expect(saved.flow?.fields?.some((f: any) => f.originalValue === 'Sam')).toBe(true);

    const emailField = saved.flow.fields.find((f: any) => f.dataKind === 'email');
    expect(emailField?.id).toBeTruthy();

    await target.evaluate(() => { (window as any).__submits = []; });
    const customResults = await replayFlow(extensionPage, tabId, saved.flow, 2, 'same', {
      [emailField.id]: 'random',
    });
    expect(customResults).toHaveLength(2);
    expect(customResults.every((r) => r.ok)).toBe(true);
    const customSubmits = await target.evaluate(() => (window as any).__submits);
    expect(customSubmits).toHaveLength(2);
    expect(customSubmits.every((s: any) => s.firstName === 'Sam')).toBe(true);
    expect(customSubmits.every((s: any) => s.lastName === 'Tester')).toBe(true);
    expect(new Set(customSubmits.map((s: any) => s.email)).size).toBe(2);
    expect(customSubmits.every((s: any) => /@testmail\.com$/.test(s.email))).toBe(true);

    await extensionPage.close();
    await target.close();
  });
});

test('replays recorded actions inside an iframe', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <form id="frameForm">
          <label>Email <input id="frameEmail" name="email" type="email"></label>
          <button id="frameSubmit" type="submit">Submit</button>
        </form>
        <script>
          window.__frameSubmits = [];
          document.querySelector('#frameForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            window.__frameSubmits.push(Object.fromEntries(new FormData(form).entries()));
            form.reset();
          });
        </script>
      </body>
    </html>`;
  const html = `<!doctype html>
    <html>
      <body>
        <iframe id="childFrame" src="/frame"></iframe>
      </body>
    </html>`;

  await withTestServer((req) => req.url === '/frame' ? frameHtml : html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    const frame = target.frameLocator('#childFrame');
    await frame.locator('#frameSubmit').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await frame.locator('#frameEmail').fill('inside.frame@example.com');
    await frame.locator('#frameSubmit').click();

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.some((s: any) => s.args?.frameId && s.args?.frameUrl !== undefined)).toBe(true);

    const flow = { id: 'flow_iframe', name: 'Iframe test', domain: '127.0.0.1', createdAt: Date.now(), steps, stepCount: steps.length };
    await target.frame({ url: /\/frame$/ })?.evaluate(() => { (window as any).__frameSubmits = []; });
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const submits = await target.frame({ url: /\/frame$/ })?.evaluate(() => (window as any).__frameSubmits);
    expect(submits).toEqual([{ email: 'inside.frame@example.com' }]);

    await extensionPage.close();
    await target.close();
  });
});

test('applies DOM modification tools inside an iframe', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <h1 id="heading">Welcome</h1>
        <label for="phone">Mobile Phone Number</label>
        <input id="phone" name="phone" type="tel">
        <label for="make">Make</label>
        <select id="make" name="make"><option value="FORD">FORD</option></select>
        <button id="customer">New Customer</button>
      </body>
    </html>`;
  const html = `<!doctype html>
    <html>
      <body>
        <iframe id="childFrame" src="/frame"></iframe>
      </body>
    </html>`;

  await withTestServer((req) => req.url === '/frame' ? frameHtml : html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    const frame = target.frameLocator('#childFrame');
    await frame.locator('#customer').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const flow = {
      id: 'flow_dom_mods',
      name: 'DOM mods',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      stepCount: 4,
      steps: [
        { tool: 'style_by_text', args: { text: 'Welcome', styles: { color: 'red' } } },
        { tool: 'set_placeholder_by_label', args: { label: 'phone number text box', placeholder: 'BLABH BLAASDA' } },
        { tool: 'replace_text', args: { find: 'New Customer', replace: 'Client', case_sensitive: false } },
        { tool: 'add_dropdown_option', args: { label: 'Make', optionLabel: 'ROD', optionValue: 'ROD' } },
      ],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(frame.locator('#heading')).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(frame.locator('#phone')).toHaveAttribute('placeholder', 'BLABH BLAASDA');
    await expect(frame.locator('#customer')).toHaveText('Client');
    await expect(frame.locator('#make option[value="ROD"]')).toHaveText('ROD');

    await target.locator('#childFrame').evaluate((iframe: HTMLIFrameElement) => {
      iframe.src = 'about:blank';
    });
    await target.waitForTimeout(500);
    await target.locator('#childFrame').evaluate((iframe: HTMLIFrameElement) => {
      iframe.src = '/frame';
    });
    await frame.locator('#customer').waitFor();
    await expect(frame.locator('#heading')).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(frame.locator('#phone')).toHaveAttribute('placeholder', 'BLABH BLAASDA');
    await expect(frame.locator('#customer')).toHaveText('Client');
    await expect(frame.locator('#make option[value="ROD"]')).toHaveText('ROD');

    await extensionPage.close();
    await target.close();
  });
});

test('applies attribute changes inside and outside an iframe', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <label for="frameInput">Frame field</label>
        <input id="frameInput" name="frameInput">
        <button id="frameButton" disabled>Frame Button</button>
      </body>
    </html>`;
  const html = `<!doctype html>
    <html>
      <body>
        <button id="topButton">Top Button</button>
        <iframe id="childFrame" src="/frame"></iframe>
      </body>
    </html>`;

  await withTestServer((req) => req.url === '/frame' ? frameHtml : html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    const frame = target.frameLocator('#childFrame');
    await frame.locator('#frameButton').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const flow = {
      id: 'flow_attr_mods',
      name: 'Attribute mods',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      stepCount: 3,
      steps: [
        { tool: 'dom_op', args: { op: 'set_attr', selector: '#topButton', attr: 'data-hawkeye-test', value: 'top-updated' } },
        { tool: 'dom_op', args: { op: 'set_attr', selector: '#frameInput', attr: 'placeholder', value: 'Frame placeholder' } },
        { tool: 'dom_op', args: { op: 'remove_attr', selector: '#frameButton', attr: 'disabled' } },
      ],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(target.locator('#topButton')).toHaveAttribute('data-hawkeye-test', 'top-updated');
    await expect(frame.locator('#frameInput')).toHaveAttribute('placeholder', 'Frame placeholder');
    await expect(frame.locator('#frameButton')).not.toBeDisabled();

    await extensionPage.close();
    await target.close();
  });
});

test('agent direct placeholder command does not fall back to text replacement', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <label for="phone">Enter your mobile phone number</label>
        <input id="phone" name="phone" type="tel">
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.locator('#phone').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const response = await sendExtensionMessage(extensionPage, {
      type: 'AGENT_RUN',
      tabId,
      payload: {
        task: 'add a placeholder for phone number text box as - BLACK SHEEP',
        history: [],
        apiKey: 'not-needed-for-direct-placeholder',
        provider: 'gemini',
      },
    });
    expect(response?.started).toBe(true);

    await expect(target.locator('#phone')).toHaveAttribute('placeholder', 'BLACK SHEEP');

    await extensionPage.close();
    await target.close();
  });
});

test('live Avis Ford scheduler records through contact screen without booking', async ({
  context,
  extensionId,
}) => {
  test.skip(
    process.env.HAWKEYE_LIVE_AVISFORD !== '1',
    'Set HAWKEYE_LIVE_AVISFORD=1 to run the guarded live Avis Ford scheduler test.'
  );
  test.setTimeout(120_000);

  const target = await context.newPage();
  await target.goto('https://www.avisford.com/service-appointment.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await target.waitForTimeout(5_000);

  const allowCookies = target.getByText('Allow all cookies', { exact: true });
  if (await allowCookies.count()) {
    await allowCookies.click().catch(() => {});
    await target.waitForTimeout(3_000);
  }

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  const tabId = await getTabId(extensionPage, 'https://www.avisford.com/service-appointment.aspx');

  const scheduler = () => {
    const frame = target.frames().find((f) => f.url().includes('guestxpui.ford.com'));
    if (!frame) throw new Error('Avis Ford scheduler iframe not found');
    return frame;
  };

  await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
  const frame = scheduler();

  await frame.getByText('New Customer', { exact: true }).click();
  await target.waitForTimeout(1_500);

  await frame.locator('#year-input').selectOption({ label: '2024' });
  await target.waitForTimeout(1_500);
  await frame.locator('#model-input').selectOption('F150');
  await frame.locator('#vehicle-type-input').selectOption('Gas');
  await frame.locator('#mileage-input').fill('12000');
  await frame.getByText('Continue', { exact: true }).click();
  await target.waitForTimeout(2_500);

  await frame.locator('.service-tile__label', { hasText: 'Oil Change' }).first().click();
  await target.waitForTimeout(800);
  await frame.getByText('Continue', { exact: true }).click();
  await target.waitForTimeout(2_500);

  await frame.getByText('Continue', { exact: true }).click();
  await target.waitForTimeout(1_500);
  await frame.locator('#Drop\\ Off').check().catch(async () => {
    await frame.getByText("I'll drop the vehicle off", { exact: true }).click();
  });
  await frame.locator('.gxp-modal button').filter({ hasText: 'Continue' }).first().click();
  await target.waitForTimeout(5_000);

  await frame.locator('input[type=radio][id*="T"]').first().check();
  await target.waitForTimeout(800);
  await frame.getByText('Continue', { exact: true }).click();
  await expect(frame.getByText('Enter Your Information', { exact: true })).toBeVisible({ timeout: 15_000 });

  const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
  const steps = stopped.steps ?? [];
  expect(steps.length).toBeGreaterThan(8);
  expect(steps.some((s: any) => s.args?.frameUrl?.includes('guestxpui.ford.com'))).toBe(true);
  await expect(frame.getByText('Continue', { exact: true })).toBeVisible();

  await extensionPage.close();
  await target.close();
});

test('live Avis Ford keeps DOM modifications after scheduler back navigation', async ({
  context,
  extensionId,
}) => {
  test.skip(
    process.env.HAWKEYE_LIVE_AVISFORD !== '1',
    'Set HAWKEYE_LIVE_AVISFORD=1 to run the guarded live Avis Ford scheduler test.'
  );
  test.setTimeout(120_000);

  const target = await context.newPage();
  await target.goto('https://www.avisford.com/service-appointment.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await target.waitForTimeout(5_000);

  const allowCookies = target.getByText('Allow all cookies', { exact: true });
  if (await allowCookies.count()) {
    await allowCookies.click().catch(() => {});
    await target.waitForTimeout(3_000);
  }

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  const tabId = await getTabId(extensionPage, 'https://www.avisford.com/service-appointment.aspx');

  const scheduler = () => {
    const frame = target.frames().find((f) => f.url().includes('guestxpui.ford.com'));
    if (!frame) throw new Error('Avis Ford scheduler iframe not found');
    return frame;
  };
  const waitForScheduler = async () => {
    for (let i = 0; i < 60; i++) {
      const frame = target.frames().find((f) => f.url().includes('guestxpui.ford.com'));
      if (frame) return frame;
      await target.waitForTimeout(500);
    }
    throw new Error(`Avis Ford scheduler iframe not found. Frames: ${target.frames().map((f) => f.url()).join(', ')}`);
  };

  const screenOneFlow = {
    id: 'avis_screen_one_mod',
    name: 'Avis screen one mod',
    domain: 'www.avisford.com',
    createdAt: Date.now(),
    stepCount: 2,
    steps: [
      { tool: 'replace_text', args: { find: 'New Customer', replace: 'Client', case_sensitive: false } },
      { tool: 'style_by_text', args: { text: 'Welcome', styles: { color: 'rgb(255, 0, 0)' } } },
    ],
  };

  let results = await replayFlow(extensionPage, tabId, screenOneFlow, 1, 'same');
  expect(results[0].ok).toBe(true);

  let frame = await waitForScheduler();
  await expect(frame.getByText('Client', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText('Welcome', { exact: true })).toHaveCSS('color', 'rgb(255, 0, 0)');
  await frame.getByText('Client', { exact: true }).click();
  await expect(frame.locator('#year-input')).toBeVisible({ timeout: 15_000 });

  const screenTwoFlow = {
    id: 'avis_screen_two_mod',
    name: 'Avis screen two mod',
    domain: 'www.avisford.com',
    createdAt: Date.now(),
    stepCount: 1,
    steps: [
      { tool: 'set_placeholder_by_label', args: { label: 'mileage', placeholder: 'TEST MILEAGE' } },
    ],
  };
  results = await replayFlow(extensionPage, tabId, screenTwoFlow, 1, 'same');
  expect(results[0].ok).toBe(true);
  await expect(frame.locator('#mileage-input')).toHaveAttribute('placeholder', 'TEST MILEAGE');

  await frame.getByRole('button', { name: 'back' }).click();
  await target.waitForTimeout(4_000);
  frame = await waitForScheduler();
  await expect(frame.getByText('Client', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText('Welcome', { exact: true })).toHaveCSS('color', 'rgb(255, 0, 0)');

  await extensionPage.close();
  await target.close();
});

test('live Avis Ford adds an option to the Make dropdown', async ({
  context,
  extensionId,
}) => {
  test.skip(
    process.env.HAWKEYE_LIVE_AVISFORD !== '1',
    'Set HAWKEYE_LIVE_AVISFORD=1 to run the guarded live Avis Ford scheduler test.'
  );
  test.setTimeout(90_000);

  const target = await context.newPage();
  await target.goto('https://www.avisford.com/service-appointment.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await target.waitForTimeout(5_000);

  const allowCookies = target.getByText('Allow all cookies', { exact: true });
  if (await allowCookies.count()) {
    await allowCookies.click().catch(() => {});
    await target.waitForTimeout(3_000);
  }

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  const tabId = await getTabId(extensionPage, 'https://www.avisford.com/service-appointment.aspx');
  const frame = target.frames().find((f) => f.url().includes('guestxpui.ford.com'));
  if (!frame) throw new Error('Avis Ford scheduler iframe not found');

  await frame.getByText(/New Customer|Client/, { exact: false }).click();
  await expect(frame.locator('#make-input')).toBeVisible({ timeout: 15_000 });

  const flow = {
    id: 'avis_make_option',
    name: 'Avis Make option',
    domain: 'www.avisford.com',
    createdAt: Date.now(),
    stepCount: 1,
    steps: [
      { tool: 'add_dropdown_option', args: { label: 'Make', optionLabel: 'ROD', optionValue: 'ROD' } },
    ],
  };
  const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
  expect(results[0].ok).toBe(true);
  await expect(frame.locator('#make-input option[value="ROD"]')).toHaveText('ROD');

  await extensionPage.close();
  await target.close();
});
