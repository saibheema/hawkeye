/**
 * Element Picker — visual overlay to pick DOM elements
 * Sends selected element info back to the side panel
 */

import { getSelector } from './dom-reader.js';

let active = false;
let overlay: HTMLElement | null = null;
let promptBox: HTMLElement | null = null;
let lastTarget: Element | null = null;
let promptForChange = false;

export function initElementPicker() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PICKER_START') {
      startPicker(message.payload as { promptForChange?: boolean } | undefined);
      sendResponse({ ok: true });
    } else if (message.type === 'PICKER_STOP') {
      stopPicker();
      sendResponse({ ok: true });
    }
    return false;
  });
}

function startPicker(options?: { promptForChange?: boolean }) {
  if (active) return;
  removePrompt();
  promptForChange = !!options?.promptForChange;
  active = true;

  overlay = document.createElement('div');
  overlay.id = '__hawkeye_picker_overlay__';
  Object.assign(overlay.style, {
    position: 'fixed',
    border: '2px solid #3b82f6',
    background: 'rgba(59,130,246,0.1)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    borderRadius: '3px',
    transition: 'all 0.05s ease',
    display: 'none',
  });
  document.body.appendChild(overlay);

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.body.style.cursor = 'crosshair';
}

function stopPicker() {
  if (!active) return;
  active = false;
  promptForChange = false;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.body.style.cursor = '';

  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  removePrompt();
  lastTarget = null;
}

function onMouseMove(e: MouseEvent) {
  const target = e.target as Element;
  if (!target || isHawkeyePickerElement(target)) return;

  lastTarget = target;
  if (!overlay) return;

  const rect = target.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: 'block',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

function onClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  const target = e.target as Element;
  if (!target || isHawkeyePickerElement(target)) return;

  const selector = getSelector(target);
  const rect = target.getBoundingClientRect();
  const payload = {
    selector,
    tagName: target.tagName.toLowerCase(),
    text: target.textContent?.trim().slice(0, 200),
    ariaLabel: target.getAttribute('aria-label'),
    type: (target as HTMLInputElement).type ?? '',
    name: (target as HTMLInputElement).name ?? '',
    id: target.id,
    pageUrl: location.href,
    boundingBox: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };

  if (promptForChange) {
    finishPickingButKeepOverlay();
    showChangePrompt(payload, rect);
    return;
  }

  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload }, () => { void chrome.runtime.lastError; });
  stopPicker();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    stopPicker();
    chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }, () => { void chrome.runtime.lastError; });
  }
}

function finishPickingButKeepOverlay() {
  active = false;
  promptForChange = false;
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.body.style.cursor = '';
}

function showChangePrompt(payload: Record<string, unknown>, rect: DOMRect) {
  removePrompt();

  promptBox = document.createElement('div');
  promptBox.id = '__hawkeye_picker_prompt__';
  Object.assign(promptBox.style, {
    position: 'fixed',
    zIndex: '2147483647',
    width: '320px',
    maxWidth: 'calc(100vw - 24px)',
    background: '#ffffff',
    border: '1px solid #dadce0',
    borderRadius: '8px',
    boxShadow: '0 14px 40px rgba(60,64,67,0.28)',
    padding: '10px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    color: '#202124',
  });

  const left = Math.max(12, Math.min(window.innerWidth - 332, rect.left));
  const below = rect.bottom + 10;
  const top = below + 150 < window.innerHeight ? below : Math.max(12, rect.top - 170);
  promptBox.style.left = `${left}px`;
  promptBox.style.top = `${top}px`;

  const title = document.createElement('div');
  title.textContent = 'Change selected element';
  Object.assign(title.style, { fontSize: '13px', fontWeight: '700', marginBottom: '6px' });

  const meta = document.createElement('div');
  meta.textContent = `${String(payload.tagName ?? 'element')}${payload.text ? ` · ${String(payload.text).slice(0, 70)}` : ''}`;
  Object.assign(meta.style, { fontSize: '11px', color: '#5f6368', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

  const input = document.createElement('textarea');
  input.placeholder = 'What should change? e.g. make text red, rename to Client, hide it';
  Object.assign(input.style, {
    width: '100%',
    height: '72px',
    boxSizing: 'border-box',
    border: '1px solid #dadce0',
    borderRadius: '6px',
    padding: '8px',
    font: '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    resize: 'vertical',
    outline: 'none',
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' });

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  Object.assign(cancel.style, buttonStyle('#f1f3f4', '#202124'));
  cancel.addEventListener('click', () => {
    cleanupPromptSelection();
    chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }, () => { void chrome.runtime.lastError; });
  });

  const apply = document.createElement('button');
  apply.textContent = 'Apply';
  Object.assign(apply.style, buttonStyle('#1a73e8', '#ffffff'));
  apply.addEventListener('click', () => {
    const instruction = input.value.trim();
    if (!instruction) {
      input.focus();
      return;
    }
    chrome.runtime.sendMessage({
      type: 'ELEMENT_CHANGE_REQUESTED',
      payload: { ...payload, instruction },
    }, () => { void chrome.runtime.lastError; });
    cleanupPromptSelection();
  });

  promptBox.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      cleanupPromptSelection();
      chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }, () => { void chrome.runtime.lastError; });
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') apply.click();
  });
  promptBox.addEventListener('click', (event) => event.stopPropagation());

  actions.append(cancel, apply);
  promptBox.append(title, meta, input, actions);
  document.body.appendChild(promptBox);
  input.focus();
}

function cleanupPromptSelection() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  removePrompt();
  lastTarget = null;
}

function removePrompt() {
  if (promptBox) {
    promptBox.remove();
    promptBox = null;
  }
}

function isHawkeyePickerElement(target: Element): boolean {
  return !!target.closest('#__hawkeye_picker_overlay__,#__hawkeye_picker_prompt__');
}

function buttonStyle(background: string, color: string): Partial<CSSStyleDeclaration> {
  return {
    background,
    color,
    border: 'none',
    borderRadius: '6px',
    padding: '7px 12px',
    font: '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    cursor: 'pointer',
  };
}
