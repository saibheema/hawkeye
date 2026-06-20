/**
 * Interaction Recorder — captures manual page actions as replayable tool steps.
 */

import type { ExtensionMessage } from '@hawkeye/types';
import { getSelector } from './dom-reader.js';

type DataKind =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'date'
  | 'time'
  | 'zip'
  | 'notes'
  | 'text';

type RecordedStep = {
  tool: string;
  args: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

let recording = false;
let lastScrollAt = 0;
let lastScrollY = 0;

export function initInteractionRecorder() {
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === 'FLOW_RECORD_START') {
        recording = true;
        lastScrollY = window.scrollY;
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === 'FLOW_RECORD_STOP') {
        recording = false;
        sendResponse({ ok: true });
        return true;
      }
      return false;
    }
  );

  document.addEventListener('click', recordClick, true);
  document.addEventListener('change', recordChange, true);
  document.addEventListener('scroll', recordScroll, true);
}

function recordClick(event: MouseEvent) {
  if (!recording || !event.isTrusted) return;
  const el = closestActionable(event.target);
  if (!el || shouldSkipClick(el)) return;
  if (isSubmitControl(el)) {
    const form = (el as HTMLButtonElement | HTMLInputElement).form ?? el.closest('form');
    const formSteps = form ? getFormStateSteps(form) : [];
    sendSteps([
      ...formSteps,
      { tool: 'click', args: { selector: getSelector(el) }, meta: { source: 'manual', label: labelFor(el) } },
    ]);
    return;
  }
  sendStep('click', { selector: getSelector(el) }, { source: 'manual', label: labelFor(el) });
}

function recordChange(event: Event) {
  if (!recording || !event.isTrusted) return;
  const el = event.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;

  const selector = getSelector(el);
  const label = labelFor(el);

  if (el instanceof HTMLSelectElement) {
    sendStep('select_option', { selector, value: el.value }, {
      source: 'manual',
      label,
      originalValue: el.value,
    });
    return;
  }

  if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type)) {
    return;
  }

  sendStep('type_text', { selector, text: el.value }, {
    source: 'manual',
    dataKind: inferDataKind(el, label),
    label,
    originalValue: el.value,
  });
}

function recordScroll() {
  if (!recording) return;
  const now = Date.now();
  if (now - lastScrollAt < 700) return;
  const deltaY = Math.round(window.scrollY - lastScrollY);
  if (Math.abs(deltaY) < 80) return;
  lastScrollAt = now;
  lastScrollY = window.scrollY;
  sendStep('scroll', { y: deltaY }, { source: 'manual' });
}

function closestActionable(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest('button,a,[role="button"],input[type="button"],input[type="submit"],input[type="radio"],input[type="checkbox"]');
}

function shouldSkipClick(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return !['button', 'submit', 'reset', 'radio', 'checkbox'].includes(el.type);
  }
  return false;
}

function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return (el.type || 'submit') === 'submit';
  if (el instanceof HTMLInputElement) return el.type === 'submit';
  return false;
}

function getFormStateSteps(form: HTMLFormElement): RecordedStep[] {
  const steps: RecordedStep[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    const selector = getSelector(el);
    const label = labelFor(el);

    if (el instanceof HTMLSelectElement) {
      steps.push({
        tool: 'select_option',
        args: { selector, value: el.value },
        meta: { source: 'manual', label, originalValue: el.value },
      });
      continue;
    }

    if (['button', 'submit', 'reset', 'file', 'image'].includes(el.type)) continue;
    if (['checkbox', 'radio'].includes(el.type) && !el.checked) continue;

    steps.push({
      tool: 'type_text',
      args: { selector, text: el.value },
      meta: {
        source: 'manual',
        dataKind: inferDataKind(el, label),
        label,
        originalValue: el.value,
      },
    });
  }
  return steps;
}

function sendStep(tool: string, args: Record<string, unknown>, meta?: Record<string, unknown>) {
  chrome.runtime.sendMessage(
    { type: 'FLOW_RECORD_STEP', payload: { tool, args, meta } },
    () => { void chrome.runtime.lastError; }
  );
}

function sendSteps(steps: RecordedStep[]) {
  chrome.runtime.sendMessage(
    { type: 'FLOW_RECORD_STEPS', payload: { steps } },
    () => { void chrome.runtime.lastError; }
  );
}

function labelFor(el: Element): string {
  const explicit = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  if (explicit) return explicit;

  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  const wrappedLabel = el.closest('label')?.textContent?.trim();
  if (wrappedLabel) return wrappedLabel;

  const name = (el as HTMLInputElement).name;
  if (name) return name;

  return el.textContent?.trim().slice(0, 80) ?? '';
}

function inferDataKind(el: HTMLInputElement | HTMLTextAreaElement, label: string): DataKind {
  const haystack = [
    label,
    el.id,
    (el as HTMLInputElement).name,
    (el as HTMLInputElement).type,
    el.getAttribute('autocomplete') ?? '',
    el.getAttribute('placeholder') ?? '',
  ].join(' ').toLowerCase();

  if (haystack.includes('email')) return 'email';
  if (haystack.includes('phone') || haystack.includes('mobile') || haystack.includes('tel')) return 'phone';
  if (haystack.includes('first')) return 'first_name';
  if (haystack.includes('last')) return 'last_name';
  if (haystack.includes('name')) return 'name';
  if (haystack.includes('date')) return 'date';
  if (haystack.includes('time')) return 'time';
  if (haystack.includes('zip') || haystack.includes('postal')) return 'zip';
  if (haystack.includes('note') || haystack.includes('comment') || el instanceof HTMLTextAreaElement) return 'notes';
  return 'text';
}
