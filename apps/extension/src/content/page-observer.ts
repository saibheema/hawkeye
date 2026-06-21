/**
 * Page Observer — MutationObserver + message handler for the page
 * Bridges content world ↔ service worker
 */

import type { ExtensionMessage } from '@hawkeye/types';
import { analyzeDom } from './dom-reader.js';
import { runScript } from './script-runner.js';

type LocatorCandidate = {
  type?: string;
  value?: string;
  selector?: string;
  tagName?: string;
  inputType?: string;
};

export function initPageObserver() {
  // Listen for messages from service worker / side panel
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (!isPageObserverMessage(message.type)) return false;
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

function isPageObserverMessage(type: string): boolean {
  return [
    'DOM_ANALYZE',
    'DOM_QUERY',
    'DOM_CLICK',
    'DOM_TYPE',
    'DOM_SELECT',
    'DOM_SCROLL',
    'PAGE_SNAPSHOT',
    'RUN_SCRIPT',
  ].includes(type);
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
      const el = await waitForElement(p, 'click') as HTMLElement | null;
      if (el) {
        await performReplayClick(el);
        await ensureSelectedState(el, p);
        sendResponse({ ok: true, selector: selectorForResponse(el, p?.selector) });
      } else {
        sendResponse({ ok: false, error: `Element not found: ${p?.selector}` });
      }
      break;
    }
    case 'DOM_TYPE': {
      const { text } = p as { text: string };
      const el = await waitForElement(p, 'type') as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ ok: true, selector: selectorForResponse(el, p?.selector) });
      } else {
        sendResponse({ ok: false, error: `Input not found: ${p?.selector}` });
      }
      break;
    }
    case 'DOM_SELECT': {
      const { value } = p as { value: string };
      const el = await waitForElement(p, 'select') as HTMLSelectElement | null;
      if (el) {
        const selected = await selectNativeOption(el, value);
        sendResponse(selected.ok
          ? { ok: true, selector: selectorForResponse(el, p?.selector), value: selected.value }
          : selected);
      } else {
        sendResponse({ ok: false, error: `Select not found: ${p?.selector}` });
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

async function selectNativeOption(el: HTMLSelectElement, desiredValue: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const desired = String(desiredValue ?? '');
  const option = await waitForOption(el, desired);
  if (!option) {
    return { ok: false, error: `Option not found for select ${selectorForResponse(el, undefined)}: ${desired}` };
  }

  const value = option.value;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  option.selected = true;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (el.value !== value) {
    return { ok: false, error: `Select value did not stick for ${selectorForResponse(el, undefined)}: expected ${value}, got ${el.value}` };
  }
  return { ok: true, value };
}

async function waitForOption(el: HTMLSelectElement, desiredValue: string): Promise<HTMLOptionElement | null> {
  const deadline = Date.now() + 10_000;
  let option = findOption(el, desiredValue);
  while (!option && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    option = findOption(el, desiredValue);
  }
  return option;
}

async function performReplayClick(el: HTMLElement): Promise<void> {
  el.scrollIntoView?.({ block: 'center', inline: 'center' });
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  const rect = el.getBoundingClientRect();
  const clientX = Math.max(0, Math.round(rect.left + rect.width / 2));
  const clientY = Math.max(0, Math.round(rect.top + rect.height / 2));
  for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    const EventCtor = eventName.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    el.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
  }
  el.click();
}

async function ensureSelectedState(el: HTMLElement, payload: any): Promise<void> {
  if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
    const expected = payload?.checked === false ? false : true;
    const deadline = Date.now() + 600;
    while (el.isConnected && el.checked !== expected && Date.now() < deadline) {
      await performReplayClick(el);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    return;
  }
  if (payload?.clickKind !== 'selectable') return;
  const deadline = Date.now() + 600;
  while (el.isConnected && selectedState(el) === false && Date.now() < deadline) {
    await performReplayClick(el);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}

function selectedState(el: HTMLElement): boolean | null {
  const aria = el.getAttribute('aria-selected') ?? el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  const dataState = [el.getAttribute('data-state'), el.getAttribute('data-selected'), el.getAttribute('data-active')].filter(Boolean).join(' ').toLowerCase();
  const classes = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  const stateText = `${dataState} ${classes}`;
  if (/\b(selected|active|checked|chosen|current)\b/.test(stateText)) return true;
  if (/\b(unselected|inactive|disabled)\b/.test(stateText)) return false;
  const checked = el.querySelector('input[type="radio"]:checked,input[type="checkbox"]:checked');
  if (checked) return true;
  return null;
}

function findOption(el: HTMLSelectElement, desiredValue: string): HTMLOptionElement | null {
  const desired = normalizeValue(desiredValue);
  return Array.from(el.options).find((option) =>
    option.value === desiredValue
    || normalizeValue(option.textContent ?? '') === desired
    || normalizeValue(option.label) === desired
  ) ?? null;
}

function normalizeValue(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function waitForElement(payload: any, kind: 'click' | 'type' | 'select', timeoutMs = 5_000): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;
  let found = findElement(payload, kind);
  while (!found && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    found = findElement(payload, kind);
  }
  return found;
}

function findElement(payload: any, kind: 'click' | 'type' | 'select'): Element | null {
  if (kind === 'click') {
    const choice = findChoiceElement(payload);
    if (choice) return choice;
    const semantic = findRecordedClickElement(payload);
    if (semantic) return semantic;
  }
  const selectors = [
    typeof payload?.selector === 'string' ? payload.selector : '',
    ...locatorCandidates(payload).filter((candidate) => candidate.type === 'css').map((candidate) => candidate.selector || candidate.value || ''),
  ].filter(Boolean);

  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el && matchesKind(el, kind)) return el;
    } catch {
      // Ignore broken selectors from older recordings.
    }
  }

  const semanticCandidates = locatorCandidates(payload).filter((candidate) => candidate.type !== 'css');
  for (const candidate of semanticCandidates) {
    const el = findBySemanticCandidate(candidate, kind);
    if (el) return el;
  }

  return null;
}

function findRecordedClickElement(payload: any): Element | null {
  const candidates = locatorCandidates(payload);
  const needles = [
    payload?.label,
    payload?.text,
    ...candidates.filter((candidate) => ['label', 'text', 'aria'].includes(candidate.type)).map((candidate) => candidate.value),
  ].map((value) => normalize(String(value ?? ''))).filter(Boolean);
  if (needles.length === 0) return null;

  const elements = Array.from(document.querySelectorAll([
    'button',
    'a[href]',
    '[role="button"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="tab"]',
    '[aria-selected]',
    '[aria-pressed]',
    '[aria-checked]',
    '[aria-expanded]',
    '[aria-controls]',
    '[jsaction]',
    '[data-href]',
    '[data-url]',
    'summary',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    'label',
    '[onclick]',
    '[class*="btn" i]',
    '[class*="button" i]',
    '[class*="link" i]',
    '[class*="chip" i]',
    '[tabindex]',
    '[class*="tile" i]',
    '[class*="card" i]',
    '[class*="option" i]',
    '[class*="slot" i]',
    '[class*="time" i]',
  ].join(','))).filter(isUsableClickTarget);
  const ranked = elements
    .map((el) => ({ el, text: normalize([labelFor(el), textFor(el), attrText(el)].filter(Boolean).join(' ')) }))
    .filter((item) => item.text);

  for (const needle of needles) {
    const exact = ranked.filter((item) => item.text === needle).sort((a, b) => a.text.length - b.text.length)[0];
    if (exact) return exact.el;
  }
  for (const needle of needles.filter((value) => value.length > 2)) {
    const contains = ranked.filter((item) => item.text.includes(needle)).sort((a, b) => a.text.length - b.text.length)[0];
    if (contains) return contains.el;
  }
  return null;
}

function isUsableClickTarget(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function findChoiceElement(payload: any): Element | null {
  const candidates = locatorCandidates(payload);
  const inputType = String(payload?.inputType ?? candidates.find((candidate) => candidate.inputType)?.inputType ?? '').toLowerCase();
  const selectorText = String(payload?.selector ?? '').toLowerCase();
  const isChoice = inputType === 'radio' || inputType === 'checkbox' || /input\[type=["']?(?:radio|checkbox)/.test(selectorText);
  if (!isChoice) return null;

  const elements = Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
  const labelNeedles = [
    payload?.choiceLabel,
    payload?.label,
    payload?.text,
    ...candidates.filter((candidate) => ['label', 'text', 'aria'].includes(candidate.type)).map((candidate) => candidate.value),
  ].map((value) => normalize(String(value ?? ''))).filter(Boolean);

  for (const needle of labelNeedles) {
    const exact = elements.find((el) => choiceMatches(el, payload) && normalize(choiceLabelFor(el)) === needle);
    if (exact) return exact;
  }
  for (const needle of labelNeedles) {
    const match = elements.find((el) => choiceMatches(el, payload) && normalize([choiceLabelFor(el), attrText(el), (el as HTMLInputElement).value, el.id].filter(Boolean).join(' ')).includes(needle));
    if (match) return match;
  }

  const desiredValue = normalize(String(payload?.value ?? ''));
  if (desiredValue && desiredValue !== 'on') {
    return elements.find((el) => el instanceof HTMLInputElement && choiceMatches(el, payload) && normalize(el.value) === desiredValue) ?? null;
  }
  return null;
}

function choiceMatches(el: Element, payload: any): boolean {
  const expectedType = String(payload?.inputType ?? '').toLowerCase();
  if (expectedType && el instanceof HTMLInputElement && el.type !== expectedType) return false;
  const expectedName = normalize(String(payload?.name ?? payload?.choiceGroup ?? ''));
  if (expectedName && el instanceof HTMLInputElement) {
    const actualName = normalize(el.name || groupLabelFor(el));
    if (actualName && actualName !== expectedName && !actualName.includes(expectedName) && !expectedName.includes(actualName)) return false;
  }
  return true;
}

function choiceLabelFor(el: Element): string {
  const explicitLabel = labelFor(el);
  if (explicitLabel) return explicitLabel;
  if (el instanceof HTMLInputElement && el.id) {
    const labelled = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelled?.textContent?.trim()) return labelled.textContent.trim();
  }
  return [textFor(el), attrText(el)].filter(Boolean).join(' ');
}

function groupLabelFor(el: Element): string {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector('legend')?.textContent?.trim();
  if (legend) return legend;
  const group = el.closest('[role="radiogroup"],[role="group"],[aria-labelledby]');
  const labelledBy = group?.getAttribute('aria-labelledby');
  if (!labelledBy) return '';
  return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ');
}

function locatorCandidates(payload: any): LocatorCandidate[] {
  return Array.isArray(payload?.locatorCandidates) ? payload.locatorCandidates : [];
}

function matchesKind(el: Element, kind: 'click' | 'type' | 'select'): boolean {
  if (kind === 'select') return el instanceof HTMLSelectElement;
  if (kind === 'type') {
    return el instanceof HTMLTextAreaElement
      || (el instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(el.type));
  }
  return el instanceof HTMLElement;
}

function findBySemanticCandidate(candidate: LocatorCandidate, kind: 'click' | 'type' | 'select'): Element | null {
  const value = normalize(candidate.value ?? '');
  if (!value) return null;
  const selector = kind === 'click'
    ? 'button,a,summary,[role="button"],[role="option"],[role="checkbox"],[role="radio"],input[type="button"],input[type="submit"],input[type="reset"],input[type="radio"],input[type="checkbox"],label,[onclick],[jsaction],[aria-expanded],[aria-controls],[data-href],[data-url],[tabindex],[class*="btn" i],[class*="button" i],[class*="link" i],[class*="chip" i]'
    : kind === 'select'
      ? 'select'
      : 'input:not([type="hidden"]),textarea';
  const elements = Array.from(document.querySelectorAll(selector)).filter((el) => matchesKind(el, kind));

  const exact = elements.find((el) => normalize(labelFor(el)) === value || normalize(textFor(el)) === value || normalize(attrText(el)) === value);
  if (exact) return exact;

  return elements.find((el) => {
    const haystack = normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' '));
    return haystack.includes(value);
  }) ?? null;
}

function labelFor(el: Element): string {
  const parts: string[] = [];
  if (el.id) parts.push(textOf(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
  parts.push(textOf(el.closest('label')));
  parts.push(el.getAttribute('aria-label') ?? '');
  parts.push((el as HTMLInputElement).placeholder ?? '');
  return parts.filter(Boolean).join(' ');
}

function textFor(el: Element): string {
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
  return el.textContent ?? '';
}

function attrText(el: Element): string {
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('placeholder'),
    el.getAttribute('name'),
    el.getAttribute('role'),
  ].filter(Boolean).join(' ');
}

function textOf(el: Element | null): string {
  return el?.textContent?.trim() ?? '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function selectorForResponse(el: Element, fallback: string | undefined): string {
  if (fallback) {
    try {
      if (document.querySelector(fallback) === el) return fallback;
    } catch {}
  }
  if (el.id) return `#${CSS.escape(el.id)}`;
  return fallback ?? el.tagName.toLowerCase();
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
