/**
 * Page Observer — MutationObserver + message handler for the page
 * Bridges content world ↔ service worker
 */

import type { ExtensionMessage } from '@hawkeye/types';
import { analyzeDom } from './dom-reader.js';
import { runScript } from './script-runner.js';

export function initPageObserver() {
  // Listen for messages from service worker / side panel
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      handleContentMessage(message, sendResponse);
      return true;
    }
  );

  // Observe DOM changes — defer until body is available
  const attachObserver = () => {
    const target = document.body ?? document.documentElement;
    if (!target) return; // still not ready, will retry via DOMContentLoaded
    const observer = new MutationObserver(debounce(() => {
      try {
        chrome.runtime.sendMessage(
          { type: 'DOM_CHANGED', payload: { url: location.href } },
          () => { void chrome.runtime.lastError; },
        );
      } catch {
        // Extension context invalidated (page navigated away) — stop observing
        observer.disconnect();
      }
    }, 500));
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  };

  if (document.body) {
    attachObserver();
  } else {
    document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
  }
}

async function handleContentMessage(
  message: ExtensionMessage,
  sendResponse: (r: any) => void
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = message.payload as any;
  switch (message.type) {
    case 'DOM_ANALYZE': {
      const analysis = analyzeDom(p?.selector);
      sendResponse({ analysis });
      break;
    }
    case 'DOM_QUERY': {
      const { selector } = p as { selector: string };
      const el = document.querySelector(selector);
      sendResponse({
        found: !!el,
        tagName: el?.tagName,
        text: el?.textContent?.slice(0, 200),
        attributes: el ? getAttributes(el) : null,
      });
      break;
    }
    case 'DOM_CLICK': {
      const { selector } = p as { selector: string };
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        el.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `Element not found: ${selector}` });
      }
      break;
    }
    case 'DOM_TYPE': {
      const { selector, text } = p as { selector: string; text: string };
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `Input not found: ${selector}` });
      }
      break;
    }
    case 'DOM_SELECT': {
      const { selector, value } = p as { selector: string; value: string };
      const el = document.querySelector(selector) as HTMLSelectElement | null;
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `Select not found: ${selector}` });
      }
      break;
    }
    case 'DOM_SCROLL': {
      const { selector } = p as { selector?: string; y?: number };
      const el = selector ? document.querySelector(selector) : null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollBy({ top: (p as { y?: number }).y ?? 300, behavior: 'smooth' });
      }
      sendResponse({ ok: true });
      break;
    }
    case 'PAGE_SNAPSHOT': {
      sendResponse({
        url: location.href,
        title: document.title,
        html: document.documentElement.outerHTML.slice(0, 50_000),
      });
      break;
    }
    case 'RUN_SCRIPT': {
      const { scriptCode, runId } = p as { scriptCode: string; runId: string };
      runScript(scriptCode, runId);
      sendResponse({ ok: true });
      break;
    }
    default:
      // Not for us — let it fall through
      sendResponse({ ok: false, error: 'unknown message type' });
  }
}

function getAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) attrs[attr.name] = attr.value;
  return attrs;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
