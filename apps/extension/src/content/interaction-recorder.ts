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
const suppressSubmitUntil = new WeakMap<HTMLFormElement, number>();
const resumingSubmissions = new WeakSet<HTMLFormElement>();

export function initInteractionRecorder() {
  try {
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
  } catch {
    return;
  }

  document.addEventListener('click', recordClick, true);
  document.addEventListener('input', recordInput, true);
  document.addEventListener('keydown', recordKeyDown, true);
  document.addEventListener('change', recordChange, true);
  document.addEventListener('submit', recordSubmit, true);
  document.addEventListener('scroll', recordScroll, true);
}

function recordClick(event: MouseEvent) {
  if (!recording || !event.isTrusted) return;
  const el = closestActionable(event.target);
  if (!el || shouldSkipClick(el)) return;
  if (isSubmitControl(el)) {
    const form = (el as HTMLButtonElement | HTMLInputElement).form ?? el.closest('form');
    const formSteps = form ? getFormStateSteps(form) : [];
    if (form) suppressSubmitUntil.set(form, Date.now() + 1500);
    const steps = [
      ...formSteps,
      { tool: 'click', args: { selector: getSelector(el) }, meta: { source: 'manual', label: labelFor(el) } },
    ];
    if (form) {
      event.preventDefault();
      void flushStepsThenSubmit(form, steps, el instanceof HTMLButtonElement || el instanceof HTMLInputElement ? el : undefined);
      return;
    }
    sendSteps(steps);
    return;
  }
  sendStep('click', { selector: getSelector(el) }, { source: 'manual', label: labelFor(el) });
}

function recordInput(event: Event) {
  if (!recording || !event.isTrusted) return;
  const step = inputStepFromElement(event.target);
  if (step) sendStep(step.tool, step.args, step.meta);
}

function recordChange(event: Event) {
  if (!recording || !event.isTrusted) return;
  const step = inputStepFromElement(event.target);
  if (!step) return;
  sendStep(step.tool, step.args, step.meta);
}

function inputStepFromElement(target: EventTarget | null): RecordedStep | null {
  const el = target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return null;

  const selector = getSelector(el);
  const label = labelFor(el);

  if (el instanceof HTMLSelectElement) {
    return {
      tool: 'select_option',
      args: { selector, value: el.value },
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
    args: { selector, text: el.value },
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
  if (el instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey) return;

  const selector = getSelector(el);
  const label = labelFor(el);
  const steps: RecordedStep[] = [];

  if (el instanceof HTMLSelectElement) {
    steps.push({
      tool: 'select_option',
      args: { selector, value: el.value },
      meta: { source: 'manual', label, originalValue: el.value },
    });
  } else if (!(el instanceof HTMLInputElement && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(el.type))) {
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

  steps.push({
    tool: 'trigger_event',
    args: { selector, event: 'keydown', key: 'Enter' },
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
  const selector = getSelector(form);
  void flushStepsThenSubmit(form, [
    ...formSteps,
    { tool: 'trigger_event', args: { selector, event: 'submit' }, meta: { source: 'manual', label: labelFor(form) || 'Submit form' } },
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
  void sendStepsAck(steps);
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
  if (haystack.includes('note') || haystack.includes('comment') || el instanceof HTMLTextAreaElement) return 'notes';
  return 'text';
}
