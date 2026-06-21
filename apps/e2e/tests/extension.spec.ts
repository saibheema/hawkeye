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

test('dashboard portal lists recorded flows and replay controls', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/dashboard/index.html`);
  await page.evaluate(() => chrome.storage.local.set({
    hawkeye_flows_example_test: [{
      id: 'flow_dashboard_test',
      name: 'Dashboard booking flow',
      domain: 'example.test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      stepCount: 2,
      steps: [
        { tool: 'type_text', args: { selector: '#email', text: 'sai@example.test' }, meta: { label: 'Email', dataKind: 'email', originalValue: 'sai@example.test' } },
        { tool: 'click', args: { selector: '#submit' }, meta: { label: 'Submit' } },
      ],
      fields: [{
        id: 'field_0',
        stepIndex: 0,
        selector: '#email',
        label: 'Email',
        dataKind: 'email',
        originalValue: 'sai@example.test',
        strategy: 'same',
      }],
      replayDefaults: { repeatCount: 1, dataMode: 'same', fieldStrategies: { field_0: 'same' } },
    }],
  }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Personal Automation Portal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard booking flow' })).toBeVisible();
  await expect(page.getByText('Email', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Random', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Run 1x on active tab/ })).toBeVisible();
  await page.close();
});

test('side panel record and replay controls target the page tab', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <h1>Generic Checkout</h1>
        <label for="firstName">First name</label>
        <input id="firstName" name="firstName">
        <label for="email">Email</label>
        <input id="email" name="email" type="email">
        <label for="plan">Plan</label>
        <select id="plan" name="plan">
          <option value="">Choose one</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
        </select>
        <button type="button" aria-pressed="false" data-addon="analytics">Analytics</button>
        <button id="continue" type="button">Continue</button>
        <div id="result"></div>
        <script>
          document.querySelector('[data-addon="analytics"]').addEventListener('click', (event) => {
            event.currentTarget.setAttribute('aria-pressed', 'true');
          });
          document.querySelector('#continue').addEventListener('click', () => {
            document.querySelector('#result').textContent = [
              document.querySelector('#firstName').value,
              document.querySelector('#email').value,
              document.querySelector('#plan').value,
              document.querySelector('[data-addon="analytics"]').getAttribute('aria-pressed'),
            ].join('|');
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await extensionPage.evaluate(() => chrome.storage.local.clear());

    await extensionPage.getByRole('button', { name: /Actions/ }).click();
    await extensionPage.getByRole('button', { name: /Record Flows/ }).click();
    await expect(extensionPage.getByText('Capture a customer journey')).toBeVisible();

    await extensionPage.getByRole('button', { name: /^Record$/ }).click();
    await expect(extensionPage.getByText('Recording flow')).toBeVisible({ timeout: 10_000 });

    await target.locator('#firstName').fill('Samantha');
    await target.locator('#email').fill('sam@example.com');
    await target.locator('#plan').selectOption('pro');
    await target.getByRole('button', { name: 'Analytics' }).click();
    await target.getByRole('button', { name: 'Continue' }).click();
    await expect(target.locator('#result')).toHaveText('Samantha|sam@example.com|pro|true');

    await extensionPage.getByRole('button', { name: /^Stop$/ }).click();
    await expect(extensionPage.getByText(/5 steps/)).toBeVisible({ timeout: 10_000 });
    await extensionPage.getByPlaceholder(/Flow name/).fill('SidePanel_Generic_Form');
    await extensionPage.getByRole('button', { name: /^Save$/ }).click();
    await expect(extensionPage.getByText('Flow Library')).toBeVisible();
    await expect(extensionPage.getByText('SidePanel_Generic_Form', { exact: true }).first()).toBeVisible();

    await extensionPage.getByRole('button', { name: /^Run 1x$/ }).first().click();
    await expect(extensionPage.getByText('1/1 passed')).toBeVisible({ timeout: 45_000 });
    await expect(target.locator('#result')).toHaveText('Samantha|sam@example.com|pro|true');

    await extensionPage.close();
    await target.close();
  });
});

test('replays Google-style jsaction show more controls when selectors drift', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <h1>AI Overview</h1>
        <div id="overview">Short answer</div>
        <div
          id="realShowMore"
          jsaction="click:showMore"
          aria-expanded="false"
          aria-controls="expanded"
          style="cursor:pointer;border:1px solid #8ab4f8;border-radius:999px;padding:14px 40px;width:420px;text-align:center"
        >
          <span>Show more</span>
        </div>
        <div id="expanded" hidden>Expanded AI result</div>
        <script>
          document.querySelector('#realShowMore').addEventListener('click', (event) => {
            event.currentTarget.setAttribute('aria-expanded', 'true');
            document.querySelector('#expanded').hidden = false;
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);
    const flow = {
      id: 'flow_google_show_more',
      name: 'Google show more',
      domain: '127.0.0.1',
      startUrl: baseUrl,
      createdAt: Date.now(),
      stepCount: 1,
      steps: [{
        tool: 'click',
        args: {
          selector: '#oldShowMore',
          label: 'Show more',
          text: 'Show more',
          tagName: 'div',
          clickKind: 'click',
          locatorCandidates: [
            { type: 'css', selector: '#oldShowMore', value: '#oldShowMore' },
            { type: 'text', value: 'Show more', selector: '#oldShowMore' },
          ],
        },
        meta: { source: 'manual', label: 'Show more' },
      }],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    await expect(target.locator('#realShowMore')).toHaveAttribute('aria-expanded', 'true');
    await expect(target.locator('#expanded')).toBeVisible();

    await extensionPage.close();
    await target.close();
  });
});

test('replays without waiting for unrelated background network noise', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <button id="a">Alpha</button>
        <button id="b">Beta</button>
        <button id="c">Gamma</button>
        <button id="d">Delta</button>
        <div id="result">0</div>
        <script>
          let count = 0;
          for (const button of document.querySelectorAll('button')) {
            button.addEventListener('click', () => {
              count += 1;
              document.querySelector('#result').textContent = String(count);
            });
          }
          setInterval(() => {
            fetch('/noise?' + Date.now(), { cache: 'no-store' }).catch(() => {});
          }, 80);
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);
    const clickStep = (selector: string, label: string) => ({
      tool: 'click',
      args: { selector, label, text: label, tagName: 'button', clickKind: 'click' },
      meta: { source: 'manual', label },
    });
    const flow = {
      id: 'flow_network_noise',
      name: 'Network noise replay',
      domain: '127.0.0.1',
      startUrl: baseUrl,
      createdAt: Date.now(),
      stepCount: 4,
      steps: [
        clickStep('#a', 'Alpha'),
        clickStep('#b', 'Beta'),
        clickStep('#c', 'Gamma'),
        clickStep('#d', 'Delta'),
      ],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    expect(results[0].durationMs).toBeLessThan(8_000);
    await expect(target.locator('#result')).toHaveText('4');

    await extensionPage.close();
    await target.close();
  });
});

test('records Enter key submissions as replayable steps', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <form id="searchForm">
          <label>Search <input id="q" name="q"></label>
        </form>
        <script>
          window.__submits = [];
          document.querySelector('#searchForm').addEventListener('submit', (event) => {
            event.preventDefault();
            window.__submits.push(new FormData(event.currentTarget).get('q'));
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#q').fill('am I recording anything?');
    await target.locator('#q').press('Enter');
    await target.waitForTimeout(500);

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.some((step: any) => step.tool === 'type_text' && step.args?.text === 'am I recording anything?')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'trigger_event' && step.args?.event === 'keydown' && step.args?.key === 'Enter')).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);

    const submitted = await target.evaluate(() => (window as any).__submits);
    expect(submitted).toEqual(['am I recording anything?']);

    await extensionPage.close();
    await target.close();
  });
});

test('records Enter search before immediate navigation', async ({ context, extensionId }) => {
  const html = (req: http.IncomingMessage) => {
    if (req.url?.startsWith('/search')) {
      return `<!doctype html><html><body><h1>Results</h1></body></html>`;
    }
    return `<!doctype html>
      <html>
        <body>
          <form id="searchForm" action="/search">
            <label>Search <input id="q" name="q" autocomplete="off"></label>
            <input id="searchButton" type="submit" value="Google Search">
          </form>
        </body>
      </html>`;
  };

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#q').fill('hello google search');
    await target.locator('#q').press('Enter');
    await expect(target.locator('h1')).toHaveText('Results');

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(stopped.startUrl).toBe(baseUrl + '/');
    expect(steps.some((step: any) => step.tool === 'type_text' && step.args?.text === 'hello google search')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'trigger_event' && step.args?.event === 'keydown' && step.args?.key === 'Enter')).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);

    const flow = { id: 'flow_search_enter', name: 'Search enter', domain: '127.0.0.1', startUrl: stopped.startUrl, createdAt: Date.now(), steps, stepCount: steps.length };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(target.locator('h1')).toHaveText('Results');

    await extensionPage.close();
    await target.close();
  });
});

test('records Enter from search textarea fields', async ({ context, extensionId }) => {
  const html = (req: http.IncomingMessage) => {
    if (req.url?.startsWith('/search')) {
      return `<!doctype html><html><body><h1>Textarea Results</h1></body></html>`;
    }
    return `<!doctype html>
      <html>
        <body>
          <form id="searchForm" action="/search" role="search">
            <label for="q">Search</label>
            <textarea id="q" name="q" aria-label="Search" role="combobox"></textarea>
          </form>
        </body>
      </html>`;
  };

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#q').fill('textarea search');
    await target.locator('#q').press('Enter');
    await expect(target.locator('h1')).toHaveText('Textarea Results');

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.some((step: any) => step.tool === 'type_text' && step.args?.text === 'textarea search')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'trigger_event' && step.args?.event === 'keydown' && step.args?.key === 'Enter')).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(2);

    const flow = { id: 'flow_textarea_search', name: 'Textarea search', domain: '127.0.0.1', startUrl: stopped.startUrl, createdAt: Date.now(), steps, stepCount: steps.length };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(target.locator('h1')).toHaveText('Textarea Results');

    await extensionPage.close();
    await target.close();
  });
});

test('records clicks after search results navigation', async ({ context, extensionId }) => {
  const html = (req: http.IncomingMessage) => {
    if (req.url?.startsWith('/final')) {
      return `<!doctype html><html><body><h1>Final Page</h1></body></html>`;
    }
    if (req.url?.startsWith('/details')) {
      return `<!doctype html>
        <html>
          <body>
            <h1>Details</h1>
            <div id="deepCard" jsaction="click:open" style="cursor:pointer" onclick="location.href='/final'">
              <span>Open deep Google-style card</span>
            </div>
          </body>
        </html>`;
    }
    if (req.url?.startsWith('/search')) {
      return `<!doctype html>
        <html>
          <body>
            <h1>Results</h1>
            <a id="resultLink" href="/details"><h3>Result link</h3></a>
          </body>
        </html>`;
    }
    return `<!doctype html>
      <html>
        <body>
          <form id="searchForm" action="/search" role="search">
            <label for="q">Search</label>
            <textarea id="q" name="q" aria-label="Search" role="combobox"></textarea>
          </form>
        </body>
      </html>`;
  };

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#q').fill('after search click');
    await target.locator('#q').press('Enter');
    await expect(target.locator('#resultLink')).toBeVisible();
    await target.locator('#resultLink').click();
    await expect(target.locator('#deepCard')).toBeVisible();
    await target.locator('#deepCard span').click();
    await expect(target.locator('h1')).toHaveText('Final Page');

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.some((step: any) => step.tool === 'type_text' && step.args?.text === 'after search click')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'trigger_event' && step.args?.event === 'keydown' && step.args?.key === 'Enter')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'click' && step.meta?.label === 'Result link')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'click' && step.meta?.label === 'Open deep Google-style card')).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(4);

    const flow = { id: 'flow_results_click', name: 'Results click', domain: '127.0.0.1', startUrl: stopped.startUrl, createdAt: Date.now(), steps, stepCount: steps.length };
    await target.goto(`${baseUrl}/final`);
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(target.locator('h1')).toHaveText('Final Page');

    await extensionPage.close();
    await target.close();
  });
});

test('caps recorded flows at 256 replayable steps', async ({ context, extensionId }) => {
  const html = `<!doctype html><html><body><h1>Step cap</h1></body></html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    for (let i = 0; i < 260; i++) {
      await sendExtensionMessage(extensionPage, {
        type: 'FLOW_RECORD_STEP',
        tabId,
        payload: {
          tool: 'click',
          args: { selector: `#step-${i}` },
          meta: { source: 'manual', label: `Step ${i}` },
        },
      });
    }

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    expect(stopped.steps).toHaveLength(256);
    expect(stopped.steps[0].args.selector).toBe('#step-0');
    expect(stopped.steps[255].args.selector).toBe('#step-255');

    await extensionPage.close();
    await target.close();
  });
});

test('keeps recording after full page navigation and replays from start URL', async ({ context, extensionId }) => {
  const html = (req: http.IncomingMessage) => {
    if (req.url?.startsWith('/second')) {
      return `<!doctype html>
        <html>
          <body>
            <form id="secondForm">
              <label for="secondName">Name</label>
              <input id="secondName" name="secondName">
              <button id="done" type="submit">Done</button>
            </form>
            <script>
              window.__submits = [];
              document.querySelector('#secondForm').addEventListener('submit', (event) => {
                event.preventDefault();
                window.__submits.push(Object.fromEntries(new FormData(event.currentTarget).entries()));
              });
            </script>
          </body>
        </html>`;
    }
    return `<!doctype html>
      <html>
        <body>
          <a id="next" href="/second">Next screen</a>
        </body>
      </html>`;
  };

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#next').click();
    await expect(target.locator('#secondName')).toBeVisible();
    await target.locator('#secondName').fill('Navigation Flow');
    await target.locator('#done').click();

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(stopped.startUrl).toBe(baseUrl + '/');
    expect(steps.some((step: any) => step.tool === 'click' && step.meta?.label === 'Next screen')).toBe(true);
    expect(steps.some((step: any) => step.tool === 'type_text' && step.args?.text === 'Navigation Flow')).toBe(true);

    const flow = { id: 'flow_nav_start', name: 'Navigation start', domain: '127.0.0.1', startUrl: stopped.startUrl, createdAt: Date.now(), steps, stepCount: steps.length };
    await target.goto(`${baseUrl}/second`);
    await target.evaluate(() => { (window as any).__submits = []; });
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(target.locator('#secondName')).toBeVisible();
    const submits = await target.evaluate(() => (window as any).__submits);
    expect(submits).toEqual([{ secondName: 'Navigation Flow' }]);

    await extensionPage.close();
    await target.close();
  });
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

test('replays recorded flows after primary selectors drift', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <form id="driftForm">
          <label for="first-v1">First name</label>
          <input id="first-v1" name="firstName" autocomplete="given-name">
          <label for="email-v1">Email</label>
          <input id="email-v1" name="email" type="email">
          <button id="submit-v1" type="submit">Submit Booking</button>
        </form>
        <script>
          window.__submits = [];
          document.querySelector('#driftForm').addEventListener('submit', (event) => {
            event.preventDefault();
            window.__submits.push(Object.fromEntries(new FormData(event.currentTarget).entries()));
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await target.locator('#first-v1').fill('Selector');
    await target.locator('#email-v1').fill('selector.drift@example.com');
    await target.locator('#submit-v1').click();

    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.some((step: any) => Array.isArray(step.args?.locatorCandidates) && step.args.locatorCandidates.length > 1)).toBe(true);

    await target.evaluate(() => {
      document.querySelector('#first-v1')?.setAttribute('id', 'first-v2');
      document.querySelector('label[for="first-v1"]')?.setAttribute('for', 'first-v2');
      document.querySelector('#email-v1')?.setAttribute('id', 'email-v2');
      document.querySelector('label[for="email-v1"]')?.setAttribute('for', 'email-v2');
      document.querySelector('#submit-v1')?.setAttribute('id', 'submit-v2');
      (window as any).__submits = [];
    });

    const flow = { id: 'flow_selector_drift', name: 'Selector drift', domain: '127.0.0.1', createdAt: Date.now(), steps, stepCount: steps.length };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    const submits = await target.evaluate(() => (window as any).__submits);
    expect(submits).toEqual([{ firstName: 'Selector', email: 'selector.drift@example.com' }]);

    await extensionPage.close();
    await target.close();
  });
});

test('captures replay diagnostics on failure', async ({ context, extensionId }) => {
  const html = `<!doctype html><html><body><h1>Debug Target</h1></body></html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const flow = {
      id: 'flow_failure_debug',
      name: 'Failure debug',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      stepCount: 1,
      steps: [{ tool: 'type_text', args: { selector: '#missing-input', text: 'never' } }],
    };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].debug?.url).toContain(baseUrl);
    expect(results[0].debug?.pageTextSnippet).toContain('Debug Target');

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

test('replay submit event does not submit a detached form', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <form id="dynamicForm">
          <input id="query" name="query" value="hello">
          <button type="submit">Continue</button>
        </form>
        <script>
          document.getElementById('dynamicForm').addEventListener('submit', (event) => {
            event.preventDefault();
            event.currentTarget.remove();
            document.body.insertAdjacentHTML('beforeend', '<p id="done">Submitted</p>');
          });
        </script>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    const warnings: string[] = [];
    target.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('Form submission canceled because the form is not connected')) warnings.push(text);
    });
    await target.goto(baseUrl);

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const flow = {
      id: 'detached-submit-flow',
      name: 'Detached Submit',
      domain: new URL(baseUrl).hostname,
      startUrl: baseUrl,
      version: 1,
      stepCount: 1,
      fields: [],
      replayDefaults: { repeatCount: 1, dataMode: 'same', fieldStrategies: {} },
      steps: [
        { tool: 'trigger_event', args: { selector: '#dynamicForm', event: 'submit' }, meta: { source: 'test' } },
      ],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    await expect(target.locator('#done')).toHaveText('Submitted');
    expect(warnings).toEqual([]);

    await extensionPage.close();
    await target.close();
  });
});

test('replays a selected radio option inside an iframe by label when selector is broad', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <form id="diagnosisForm">
          <label><input type="radio" name="diagnosis" value="brake"> Brake Diagnosis</label>
          <label><input type="radio" name="diagnosis" value="climate"> Climate Control Diagnosis</label>
          <label><input type="radio" name="diagnosis" value="not_sure"> I am not sure</label>
        </form>
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
    await frame.getByLabel('I am not sure').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await frame.getByLabel('I am not sure').check();
    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const recordedClick = (stopped.steps ?? []).find((step: any) => step.tool === 'click' && step.args?.inputType === 'radio');
    expect(recordedClick).toBeTruthy();

    recordedClick.args.selector = 'input[name="diagnosis"]';
    recordedClick.args.locatorCandidates = [
      { type: 'css', value: 'input[name="diagnosis"]', selector: 'input[name="diagnosis"]', score: 100, tagName: 'input', inputType: 'radio' },
      { type: 'label', value: 'I am not sure', score: 95, tagName: 'input', inputType: 'radio' },
      { type: 'name', value: 'diagnosis', score: 50, tagName: 'input', inputType: 'radio' },
    ];

    await frame.getByLabel('I am not sure').uncheck({ force: true }).catch(() => {});
    await frame.getByLabel('Brake Diagnosis').check();

    const flow = {
      id: 'flow_radio_iframe',
      name: 'Radio iframe',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      steps: [recordedClick],
      stepCount: 1,
    };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    await expect(frame.getByLabel('I am not sure')).toBeChecked();
    await expect(frame.getByLabel('Brake Diagnosis')).not.toBeChecked();

    await extensionPage.close();
    await target.close();
  });
});

test('replays a selected time tile inside an iframe by recorded text when selector is broad', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <div id="times">
          <div class="time-slot selected" role="option" tabindex="0" aria-selected="true" data-time="09:00"><span class="time-label">9:00 AM</span></div>
          <div class="time-slot" role="option" tabindex="0" aria-selected="false" data-time="10:30"><span class="time-label">10:30 AM</span></div>
          <div class="time-slot" role="option" tabindex="0" aria-selected="false" data-time="13:00"><span class="time-label">1:00 PM</span></div>
        </div>
        <script>
          document.querySelectorAll('.time-slot').forEach((slot) => {
            slot.addEventListener('click', () => {
              document.querySelectorAll('.time-slot').forEach((other) => {
                other.classList.remove('selected');
                other.setAttribute('aria-selected', 'false');
              });
              slot.classList.add('selected');
              slot.setAttribute('aria-selected', 'true');
            });
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
    await frame.getByText('10:30 AM').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await frame.getByText('10:30 AM').click();
    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const recordedClick = (stopped.steps ?? []).find((step: any) => step.tool === 'click' && step.args?.text === '10:30 AM');
    expect(recordedClick).toBeTruthy();

    recordedClick.args.selector = '.time-slot';
    recordedClick.args.locatorCandidates = [
      { type: 'css', value: '.time-slot', selector: '.time-slot', score: 100, tagName: 'div' },
      { type: 'text', value: '10:30 AM', score: 95, tagName: 'div' },
      { type: 'role', value: 'option', score: 50, tagName: 'div' },
    ];

    await target.frame({ url: /\/frame$/ })?.evaluate(() => {
      document.querySelectorAll('.time-slot').forEach((slot) => {
        slot.classList.remove('selected');
        slot.setAttribute('aria-selected', 'false');
      });
      const first = document.querySelector('[data-time="09:00"]');
      first?.classList.add('selected');
      first?.setAttribute('aria-selected', 'true');
    });

    const flow = {
      id: 'flow_time_tile_iframe',
      name: 'Time tile iframe',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      steps: [recordedClick],
      stepCount: 1,
    };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    await expect(frame.locator('[data-time="10:30"]')).toHaveAttribute('aria-selected', 'true');
    await expect(frame.locator('[data-time="09:00"]')).toHaveAttribute('aria-selected', 'false');

    await extensionPage.close();
    await target.close();
  });
});

test('reselects missing selectable tiles before proceeding', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <div id="times">
          <div class="time-slot selected" role="option" tabindex="0" aria-selected="true" data-time="09:00"><span>9:00 AM</span></div>
          <div class="time-slot" role="option" tabindex="0" aria-selected="false" data-time="10:30"><span>10:30 AM</span></div>
        </div>
        <button id="continue">Continue</button>
        <script>
          window.__continuedWith = null;
          window.__slotClicks = 0;
          document.querySelectorAll('.time-slot').forEach((slot) => {
            slot.addEventListener('click', () => {
              if (slot.dataset.time === '10:30') {
                window.__slotClicks += 1;
                if (window.__slotClicks === 1) return;
              }
              document.querySelectorAll('.time-slot').forEach((other) => {
                other.classList.remove('selected');
                other.setAttribute('aria-selected', 'false');
              });
              slot.classList.add('selected');
              slot.setAttribute('aria-selected', 'true');
            });
          });
          document.querySelector('#continue').addEventListener('click', () => {
            window.__continuedWith = document.querySelector('.time-slot.selected')?.dataset.time ?? null;
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
    await frame.getByText('10:30 AM').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await frame.getByText('10:30 AM').click();
    await frame.getByText('Continue').click();
    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    const tileStep = steps.find((step: any) => step.tool === 'click' && step.args?.text === '10:30 AM');
    expect(tileStep).toBeTruthy();

    await target.frame({ url: /\/frame$/ })?.evaluate(() => {
      window.__continuedWith = null;
      window.__slotClicks = 0;
      document.querySelectorAll('.time-slot').forEach((slot) => {
        slot.classList.remove('selected');
        slot.setAttribute('aria-selected', 'false');
      });
      const first = document.querySelector('[data-time="09:00"]');
      first?.classList.add('selected');
      first?.setAttribute('aria-selected', 'true');
    });

    const flow = {
      id: 'flow_reselect_tile',
      name: 'Reselect tile',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      steps,
      stepCount: steps.length,
    };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    const continuedWith = await target.frame({ url: /\/frame$/ })?.evaluate(() => window.__continuedWith);
    expect(continuedWith).toBe('10:30');

    await extensionPage.close();
    await target.close();
  });
});

test('does not reselect prior navigation clicks before proceeding', async ({ context, extensionId }) => {
  const frameHtml = `<!doctype html>
    <html>
      <body>
        <button id="newCustomer">New Customer</button>
        <section id="details" hidden>
          <label for="mileage">Mileage</label>
          <input id="mileage" name="mileage" inputmode="numeric">
          <button id="continue">Continue</button>
        </section>
        <script>
          window.__continuedMileage = null;
          const newCustomer = document.querySelector('#newCustomer');
          const details = document.querySelector('#details');
          newCustomer.addEventListener('click', () => {
            newCustomer.hidden = true;
            details.hidden = false;
          });
          document.querySelector('#continue').addEventListener('click', () => {
            window.__continuedMileage = document.querySelector('#mileage').value;
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
    await frame.getByText('New Customer').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_START', tabId, payload: {} });
    await frame.getByText('New Customer').click();
    await frame.locator('#mileage').fill('24000');
    await frame.getByText('Continue').click();
    const stopped = await sendExtensionMessage(extensionPage, { type: 'FLOW_RECORD_STOP', tabId, payload: {} });
    const steps = stopped.steps ?? [];
    expect(steps.map((step: any) => step.tool)).toContain('type_text');
    expect(steps.find((step: any) => step.tool === 'click' && step.args?.text === 'New Customer')?.args?.clickKind).toBe('click');

    await target.frame({ url: /\/frame$/ })?.evaluate(() => {
      window.__continuedMileage = null;
      const newCustomer = document.querySelector('#newCustomer') as HTMLButtonElement;
      const details = document.querySelector('#details') as HTMLElement;
      const mileage = document.querySelector('#mileage') as HTMLInputElement;
      newCustomer.hidden = false;
      details.hidden = true;
      mileage.value = '';
    });

    const flow = {
      id: 'flow_navigation_click_not_state',
      name: 'Navigation click is not state',
      domain: '127.0.0.1',
      createdAt: Date.now(),
      steps,
      stepCount: steps.length,
    };
    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results[0].ok).toBe(true);
    const continuedMileage = await target.frame({ url: /\/frame$/ })?.evaluate(() => window.__continuedMileage);
    expect(continuedMileage).toBe('24000');

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
        <input id="searchButton" type="submit" value="Google Search" aria-label="Google Search">
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
      stepCount: 5,
      steps: [
        { tool: 'style_by_text', args: { text: 'Welcome', styles: { color: 'red' } } },
        { tool: 'set_placeholder_by_label', args: { label: 'phone number text box', placeholder: 'BLABH BLAASDA' } },
        { tool: 'replace_text', args: { find: 'New Customer', replace: 'Client', case_sensitive: false } },
        { tool: 'replace_text', args: { find: 'Google Search', replace: 'Gokul Search', case_sensitive: false } },
        { tool: 'add_dropdown_option', args: { label: 'Make', optionLabel: 'ROD', optionValue: 'ROD' } },
      ],
    };

    const results = await replayFlow(extensionPage, tabId, flow, 1, 'same');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    await expect(frame.locator('#heading')).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(frame.locator('#phone')).toHaveAttribute('placeholder', 'BLABH BLAASDA');
    await expect(frame.locator('#customer')).toHaveText('Client');
    await expect(frame.locator('#searchButton')).toHaveValue('Gokul Search');
    await expect(frame.locator('#searchButton')).toHaveAttribute('aria-label', 'Gokul Search');
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
    await expect(frame.locator('#searchButton')).toHaveValue('Gokul Search');
    await expect(frame.locator('#searchButton')).toHaveAttribute('aria-label', 'Gokul Search');
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

test('agent direct button label command updates input button values', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <form>
          <input id="searchButton" type="submit" value="Google Search" aria-label="Google Search">
        </form>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.locator('#searchButton').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const response = await sendExtensionMessage(extensionPage, {
      type: 'AGENT_RUN',
      tabId,
      payload: {
        task: 'change buutton label "Google search" to "Gokul Search"',
        history: [],
        apiKey: 'not-needed-for-direct-button-label',
        provider: 'gemini',
      },
    });
    expect(response?.started).toBe(true);

    await expect(target.locator('#searchButton')).toHaveValue('Gokul Search');
    await expect(target.locator('#searchButton')).toHaveAttribute('aria-label', 'Gokul Search');

    await extensionPage.close();
    await target.close();
  });
});

test('agent direct icon command updates icon-only controls', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <main id="content">
          <h1>Google-like page stays intact</h1>
          <p>This large content area includes a + sign but must not be replaced.</p>
        </main>
        <button id="addButton" aria-label="Add" title="Add">
          <svg width="20" height="20" aria-hidden="true"><title>plus</title><path d="M10 3v14M3 10h14"></path></svg>
        </button>
        <button id="newCustomer">New Customer</button>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.locator('#addButton').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    const tabId = await getTabId(extensionPage, baseUrl);

    const response = await sendExtensionMessage(extensionPage, {
      type: 'AGENT_RUN',
      tabId,
      payload: {
        task: 'update + icon to X icon',
        history: [],
        apiKey: 'not-needed-for-direct-icon',
        provider: 'gemini',
      },
    });
    expect(response?.started).toBe(true);

    await expect(target.locator('#addButton')).toHaveText('X');
    await expect(target.locator('#addButton')).toHaveAttribute('aria-label', 'X');
    await expect(target.locator('#content')).toContainText('Google-like page stays intact');
    await expect(target.locator('#content')).toContainText('must not be replaced');
    await expect(target.locator('#newCustomer')).toHaveText('New Customer');

    await extensionPage.close();
    await target.close();
  });
});

test('header picker scopes the next chat instruction to the selected element', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <button id="targetButton">Original button</button>
        <button id="otherButton">Other button</button>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.locator('#targetButton').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await extensionPage.evaluate(() => chrome.storage.local.set({ gemini_api_key: 'not-needed-for-direct-picker' }));

    await extensionPage.getByTitle('Pick an element to target your next Hawkeye message').click();
    await target.locator('#targetButton').click();

    await expect(extensionPage.getByText('Selected button')).toBeVisible();
    await expect(extensionPage.getByText('#targetButton')).toBeVisible();

    await extensionPage.getByPlaceholder('Tell Hawkeye how to change the selected element…').fill('rename to Client');
    await extensionPage.locator('button').filter({ hasText: '➤' }).click();

    const tabId = await getTabId(extensionPage, baseUrl);
    await expect.poll(async () => {
      const res = await sendExtensionMessage(extensionPage, { type: 'AGENT_STATE_GET', tabId });
      return res?.state?.task ?? '';
    }, { timeout: 10_000 }).toContain('Selector: #targetButton');

    const res = await sendExtensionMessage(extensionPage, { type: 'AGENT_STATE_GET', tabId });
    expect(res.state.task).toContain('User request for that selected element: rename to Client');
    expect(res.state.task).toContain('Apply the request ONLY to that selected element');

    await extensionPage.close();
    await target.close();
  });
});

test('header picker replaces selected svg icon with fitted X vector', async ({ context, extensionId }) => {
  const html = `<!doctype html>
    <html>
      <body>
        <button id="iconButton" aria-label="Add files" style="width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;color:#202124">
          <svg id="plusIcon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          </svg>
        </button>
      </body>
    </html>`;

  await withTestServer(html, async (baseUrl) => {
    const target = await context.newPage();
    await target.goto(baseUrl);
    await target.locator('#plusIcon').waitFor();

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await extensionPage.evaluate(() => chrome.storage.local.set({ gemini_api_key: 'not-needed-for-direct-picker' }));

    const before = await target.locator('#plusIcon').evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height };
    });
    await extensionPage.getByTitle('Pick an element to target your next Hawkeye message').click();
    await target.locator('#plusIcon').click();

    await expect(extensionPage.getByText('Selected svg')).toBeVisible();
    await extensionPage.getByPlaceholder('Tell Hawkeye how to change the selected element…').fill('update it to X like icon');
    await extensionPage.locator('button').filter({ hasText: '➤' }).click();

    await expect.poll(async () => {
      return target.locator('#plusIcon path[d="M6 6L18 18M18 6L6 18"]').count();
    }, { timeout: 10_000 }).toBe(1);

    await expect(target.locator('#plusIcon')).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(target.locator('#plusIcon')).toHaveAttribute('aria-label', 'X');
    await expect(target.locator('#plusIcon text')).toHaveCount(0);
    const after = await target.locator('#plusIcon').evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height, overflow: style.overflow };
    });
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.overflow).toBe('hidden');

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
