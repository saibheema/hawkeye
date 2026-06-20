/**
 * Interaction Recorder — captures manual page actions as replayable tool steps.
 */

import type { ExtensionMessage } from '@hawkeye/types';
import { getLocatorCandidates, getSelector } from './dom-reader.js';

type DataKind =
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'date'
  | 'time'
  | 'zip'
  | 'number'
  | 'mileage'
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
const suppressSubmitUntil = new WeakMap<HTMLFormElement, number>();
const resumingSubmissions = new WeakSet<HTMLFormElement>();
const lastRecordedFieldValues = new Map<string, string>();

export function initInteractionRecorder() {
  try {
    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === 'FLOW_RECORD_START') {
          recording = true;
          lastScrollY = window.scrollY;
          lastRecordedFieldValues.clear();
          sendResponse({ ok: true });
          return true;
        }
        if (message.type === 'FLOW_RECORD_STOP') {
          recording = false;
          lastRecordedFieldValues.clear();
          sendResponse({ ok: true });
          return true;
        }
        return false;
      }
    );
  } catch {
    return;
  }

  document.addEventListener('click', recordClick, true);
  document.addEventListener('input', recordInput, true);
  document.addEventListener('keydown', recordKeyDown, true);
  document.addEventListener('change', recordChange, true);
  document.addEventListener('submit', recordSubmit, true);
  document.addEventListener('scroll', recordScroll, true);

  try {
    chrome.runtime.sendMessage({ type: 'FLOW_RECORD_STATUS' }, (res) => {
      void chrome.runtime.lastError;
      recording = !!res?.recording;
      if (recording) lastScrollY = window.scrollY;
    });
  } catch {
    // Extension context may be unavailable during page teardown.
  }
}

function recordClick(event: MouseEvent) {
  if (!recording || !event.isTrusted) return;
  const el = closestActionable(event.target);
  if (!el || shouldSkipClick(el)) return;
  const clickStep: RecordedStep = { tool: 'click', args: locatorArgs(el), meta: { source: 'manual', label: labelFor(el) } };
  if (isSubmitControl(el)) {
    const form = (el as HTMLButtonElement | HTMLInputElement).form ?? el.closest('form');
    const formSteps = form ? getFormStateSteps(form) : [];
    if (form) suppressSubmitUntil.set(form, Date.now() + 1500);
    const steps = [
      ...formSteps,
      clickStep,
    ];
    if (form) {
      event.preventDefault();
      void flushStepsThenSubmit(form, steps, el instanceof HTMLButtonElement || el instanceof HTMLInputElement ? el : undefined);
      return;
    }
    sendSteps(steps);
    return;
  }
  if (el instanceof HTMLAnchorElement && el.href && !isModifiedClick(event) && (!el.target || el.target === '_self')) {
    event.preventDefault();
    void sendStepsAck([clickStep]).then(() => {
      location.href = el.href;
    });
    return;
  }
  sendStep(clickStep.tool, clickStep.args, clickStep.meta);
}

function recordInput(event: Event) {
  if (!recording || !event.isTrusted) return;
  recordFieldTarget(event.target);
}

function recordChange(event: Event) {
  if (!recording) return;
  if (!event.isTrusted && !isRecordableSyntheticChange(event.target)) return;
  recordFieldTarget(event.target);
}

function recordFieldTarget(target: EventTarget | null) {
  const step = inputStepFromElement(target);
  if (!step) return;
  if (isDuplicateFieldStep(step)) return;
  rememberFieldStep(step);
  sendStep(step.tool, step.args, step.meta);
}

function isRecordableSyntheticChange(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLSelectElement)) return false;
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && !target.disabled;
}

function inputStepFromElement(target: EventTarget | null): RecordedStep | null {
  const el = target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return null;

  const label = labelFor(el);

  if (el instanceof HTMLSelectElement) {
    return {
      tool: 'select_option',
      args: locatorArgs(el, { value: el.value }),
      meta: {
        source: 'manual',
        label,
        originalValue: el.value,
      },
    };
  }

  if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type)) {
    return null;
  }

  return {
    tool: 'type_text',
    args: locatorArgs(el, { text: el.value }),
    meta: {
      source: 'manual',
      dataKind: inferDataKind(el, label),
      label,
      originalValue: el.value,
    },
  };
}

function recordKeyDown(event: KeyboardEvent) {
  if (!recording || !event.isTrusted || event.key !== 'Enter') return;
  const el = event.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
  if (el instanceof HTMLTextAreaElement && !shouldRecordTextareaEnter(el, event)) return;

  const label = labelFor(el);
  const steps: RecordedStep[] = [];

  if (el instanceof HTMLSelectElement) {
    steps.push({
      tool: 'select_option',
      args: locatorArgs(el, { value: el.value }),
      meta: { source: 'manual', label, originalValue: el.value },
    });
  } else if (!(el instanceof HTMLInputElement && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(el.type))) {
    steps.push({
      tool: 'type_text',
      args: locatorArgs(el, { text: el.value }),
      meta: {
        source: 'manual',
        dataKind: inferDataKind(el, label),
        label,
        originalValue: el.value,
      },
    });
  }

  steps.push({
    tool: 'trigger_event',
    args: locatorArgs(el, { event: 'keydown', key: 'Enter' }),
    meta: { source: 'manual', label: 'Enter key' },
  });
  if (el.form) {
    suppressSubmitUntil.set(el.form, Date.now() + 1500);
    event.preventDefault();
    void flushStepsThenSubmit(el.form, steps);
    return;
  }
  sendSteps(steps);
}

function recordSubmit(event: SubmitEvent) {
  if (!recording || !event.isTrusted) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (resumingSubmissions.has(form)) return;
  if ((suppressSubmitUntil.get(form) ?? 0) > Date.now()) return;
  event.preventDefault();
  const formSteps = getFormStateSteps(form);
  void flushStepsThenSubmit(form, [
    ...formSteps,
    { tool: 'trigger_event', args: locatorArgs(form, { event: 'submit' }), meta: { source: 'manual', label: labelFor(form) || 'Submit form' } },
  ]);
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
  const semantic = target.closest([
    'button',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="option"]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="radio"]',
    'input[type="checkbox"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','));
  if (semantic) return semantic;

  const path = typeof (target as any).composedPath === 'function'
    ? (target as any).composedPath() as EventTarget[]
    : [];
  for (const item of path) {
    if (item instanceof Element && isLikelyClickableWidget(item)) return item;
    if (item instanceof HTMLBodyElement || item instanceof HTMLHtmlElement) break;
  }
  let current: Element | null = target;
  while (current && !(current instanceof HTMLBodyElement) && !(current instanceof HTMLHtmlElement)) {
    if (isLikelyClickableWidget(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function isLikelyClickableWidget(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
  if (el.isContentEditable) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.hasAttribute('disabled')) return false;

  const role = el.getAttribute('role')?.toLowerCase() ?? '';
  if (['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio'].includes(role)) return true;
  if (typeof el.onclick === 'function') return true;
  if (el.hasAttribute('jsaction')) return true;
  if (el.hasAttribute('data-href') || el.hasAttribute('data-url')) return true;
  if (el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') || el.hasAttribute('aria-selected')) return true;

  const classes = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  if (/\b(btn|button|link|tab|chip|card|tile|option|menu-item)\b/.test(classes)) return true;

  const style = window.getComputedStyle(el);
  return style.cursor === 'pointer';
}

function shouldSkipClick(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return !['button', 'submit', 'reset', 'radio', 'checkbox'].includes(el.type);
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return false;
}

function isSubmitControl(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return (el.type || 'submit') === 'submit';
  if (el instanceof HTMLInputElement) return el.type === 'submit';
  return false;
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function shouldRecordTextareaEnter(el: HTMLTextAreaElement, event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey) return true;
  const haystack = [
    el.getAttribute('role'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('type'),
    el.getAttribute('enterkeyhint'),
    el.name,
    el.id,
    labelFor(el),
    el.closest('form')?.getAttribute('role'),
    el.closest('form')?.getAttribute('aria-label'),
    el.closest('[role="search"]')?.getAttribute('role'),
  ].filter(Boolean).join(' ').toLowerCase();

  return /\b(search|combobox|submit|go|find|query)\b/.test(haystack);
}

function getFormStateSteps(form: HTMLFormElement): RecordedStep[] {
  const steps: RecordedStep[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    const label = labelFor(el);

    if (el instanceof HTMLSelectElement) {
      const step = {
        tool: 'select_option',
        args: locatorArgs(el, { value: el.value }),
        meta: { source: 'manual', label, originalValue: el.value },
      };
      if (isDuplicateFieldStep(step)) continue;
      steps.push({
        tool: 'select_option',
        args: locatorArgs(el, { value: el.value }),
        meta: { source: 'manual', label, originalValue: el.value },
      });
      continue;
    }

    if (['button', 'submit', 'reset', 'file', 'image'].includes(el.type)) continue;
    if (['checkbox', 'radio'].includes(el.type) && !el.checked) continue;

    const step = {
      tool: 'type_text',
      args: locatorArgs(el, { text: el.value }),
      meta: {
        source: 'manual',
        dataKind: inferDataKind(el, label),
        label,
        originalValue: el.value,
      },
    };
    if (isDuplicateFieldStep(step)) continue;
    steps.push(step);
  }
  return steps;
}

function locatorArgs(el: Element, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selector: getSelector(el),
    locatorCandidates: getLocatorCandidates(el),
    ...extra,
  };
}

function sendStep(tool: string, args: Record<string, unknown>, meta?: Record<string, unknown>) {
  try {
    chrome.runtime.sendMessage(
      { type: 'FLOW_RECORD_STEP', payload: { tool, args, meta } },
      () => { void chrome.runtime.lastError; }
    );
  } catch {
    recording = false;
  }
}

function sendSteps(steps: RecordedStep[]) {
  for (const step of steps) rememberFieldStep(step);
  void sendStepsAck(steps);
}

function rememberFieldStep(step: RecordedStep) {
  const key = fieldStepKey(step);
  const value = fieldStepValue(step);
  if (key && value !== null) lastRecordedFieldValues.set(key, value);
}

function isDuplicateFieldStep(step: RecordedStep): boolean {
  const key = fieldStepKey(step);
  const value = fieldStepValue(step);
  return !!key && value !== null && lastRecordedFieldValues.get(key) === value;
}

function fieldStepKey(step: RecordedStep): string | null {
  if (step.tool !== 'type_text' && step.tool !== 'select_option') return null;
  const selector = typeof step.args.selector === 'string' ? step.args.selector : '';
  return selector ? `${step.tool}:${selector}` : null;
}

function fieldStepValue(step: RecordedStep): string | null {
  if (step.tool === 'type_text') return typeof step.args.text === 'string' ? step.args.text : null;
  if (step.tool === 'select_option') return typeof step.args.value === 'string' ? step.args.value : null;
  return null;
}

function sendStepsAck(steps: RecordedStep[]): Promise<void> {
  if (steps.length === 0) return Promise.resolve();
  try {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = window.setTimeout(finish, 250);
      chrome.runtime.sendMessage(
        { type: 'FLOW_RECORD_STEPS', payload: { steps } },
        () => {
          window.clearTimeout(timer);
          void chrome.runtime.lastError;
          finish();
        }
      );
    });
  } catch {
    recording = false;
    return Promise.resolve();
  }
}

async function flushStepsThenSubmit(
  form: HTMLFormElement,
  steps: RecordedStep[],
  submitter?: HTMLButtonElement | HTMLInputElement
) {
  await sendStepsAck(steps);
  resumingSubmissions.add(form);
  window.setTimeout(() => resumingSubmissions.delete(form), 1500);
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit(submitter);
  } else {
    form.submit();
  }
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
  if (haystack.includes('mileage') || haystack.includes('odometer')) return 'mileage';
  if (haystack.includes('number') || (el instanceof HTMLInputElement && (el.type === 'number' || el.inputMode === 'numeric'))) return 'number';
  if (haystack.includes('note') || haystack.includes('comment') || el instanceof HTMLTextAreaElement) return 'notes';
  return 'text';
}
