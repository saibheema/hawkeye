/**
 * Network Watcher — captures XHR/fetch requests using webRequest API
 * Feeds API catalog discovery and agent context
 */

import type { CapturedRequest } from '@hawkeye/types';

// Maximum captured entries per tab before rolling over
const MAX_PER_TAB = 200;

export type NetworkActivity = {
  active: number;
  lastActivityAt: number;
};

export function startNetworkWatcher(
  networkData: Map<number, CapturedRequest[]>,
  activityByTab?: Map<number, NetworkActivity>
) {
  const pendingRequests = new Map<string, Partial<CapturedRequest>>();
  const requestTabs = new Map<string, number>();

  // Capture outgoing requests
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isTrackable(details.url)) return;
      if (!details.tabId || details.tabId < 0) return;

      const entry: Partial<CapturedRequest> = {
        id: details.requestId,
        tabId: details.tabId,
        url: details.url,
        method: details.method,
        timestamp: Date.now(),
        requestBody: extractBody(details.requestBody ?? undefined),
      };
      pendingRequests.set(details.requestId, entry);
      requestTabs.set(details.requestId, details.tabId);
      markNetworkStart(activityByTab, details.tabId);
    },
    { urls: ['<all_urls>'] },
    ['requestBody']
  );

  // Capture request headers
  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const entry = pendingRequests.get(details.requestId);
      if (!entry) return;
      entry.requestHeaders = headersToObj(details.requestHeaders);
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders']
  );

  // Capture response
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      const entry = pendingRequests.get(details.requestId);
      if (!entry || !entry.tabId) return;

      const completed: CapturedRequest = {
        ...(entry as CapturedRequest),
        status: details.statusCode,
        responseHeaders: headersToObj(details.responseHeaders),
        duration: Date.now() - (entry.timestamp ?? 0),
      };

      const tabId = completed.tabId!;
      if (!networkData.has(tabId)) networkData.set(tabId, []);
      const arr = networkData.get(tabId)!;
      arr.push(completed);

      // Rolling window
      if (arr.length > MAX_PER_TAB) arr.splice(0, arr.length - MAX_PER_TAB);

      pendingRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      const tabId = requestTabs.get(details.requestId) ?? (details.tabId >= 0 ? details.tabId : undefined);
      if (typeof tabId === 'number') markNetworkDone(activityByTab, tabId);
      requestTabs.delete(details.requestId);
      pendingRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  // Cleanup abandoned requests
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      const tabId = requestTabs.get(details.requestId) ?? (details.tabId >= 0 ? details.tabId : undefined);
      if (typeof tabId === 'number') markNetworkDone(activityByTab, tabId);
      requestTabs.delete(details.requestId);
      pendingRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] }
  );
}

// ---------- Helpers ----------

function isTrackable(url: string): boolean {
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  // Focus on API/XHR traffic — skip static assets
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  const staticExts = new Set(['png','jpg','jpeg','gif','svg','webp','ico','css','woff','woff2','ttf','eot']);
  if (ext && staticExts.has(ext)) return false;
  return true;
}

function markNetworkStart(activityByTab: Map<number, NetworkActivity> | undefined, tabId: number) {
  if (!activityByTab) return;
  const current = activityByTab.get(tabId) ?? { active: 0, lastActivityAt: 0 };
  activityByTab.set(tabId, { active: current.active + 1, lastActivityAt: Date.now() });
}

function markNetworkDone(activityByTab: Map<number, NetworkActivity> | undefined, tabId: number) {
  if (!activityByTab) return;
  const current = activityByTab.get(tabId) ?? { active: 0, lastActivityAt: 0 };
  activityByTab.set(tabId, { active: Math.max(0, current.active - 1), lastActivityAt: Date.now() });
}

function headersToObj(
  headers?: chrome.webRequest.HttpHeader[]
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(headers.map((h) => [h.name.toLowerCase(), h.value ?? '']));
}

function extractBody(
  body?: chrome.webRequest.WebRequestBody
): string | undefined {
  if (!body) return undefined;
  try {
    const wb = body as { raw?: Array<{ bytes?: ArrayBuffer }>; formData?: Record<string, string[]> };
    if (wb.raw && wb.raw[0]?.bytes) {
      return new TextDecoder().decode(wb.raw[0].bytes as ArrayBuffer);
    }
    if (wb.formData) return JSON.stringify(wb.formData);
  } catch {
    // ignore
  }
  return undefined;
}
