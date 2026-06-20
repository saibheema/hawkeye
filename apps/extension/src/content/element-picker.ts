/**
 * Element Picker — visual overlay to pick DOM elements
 * Sends selected element info back to the side panel
 */

import { getSelector } from './dom-reader.js';

let active = false;
let overlay: HTMLElement | null = null;
let lastTarget: Element | null = null;

export function initElementPicker() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PICKER_START') {
      startPicker();
      sendResponse({ ok: true });
    } else if (message.type === 'PICKER_STOP') {
      stopPicker();
      sendResponse({ ok: true });
    }
    return false;
  });
}

function startPicker() {
  if (active) return;
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

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.body.style.cursor = '';

  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  lastTarget = null;
}

function onMouseMove(e: MouseEvent) {
  const target = e.target as Element;
  if (!target || target.id === '__hawkeye_picker_overlay__') return;

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
  if (!target || target.id === '__hawkeye_picker_overlay__') return;

  const selector = getSelector(target);
  const rect = target.getBoundingClientRect();

  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTED',
    payload: {
      selector,
      tagName: target.tagName.toLowerCase(),
      text: target.textContent?.trim().slice(0, 200),
      ariaLabel: target.getAttribute('aria-label'),
      type: (target as HTMLInputElement).type ?? '',
      name: (target as HTMLInputElement).name ?? '',
      id: target.id,
      boundingBox: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    },
  }, () => { void chrome.runtime.lastError; });

  stopPicker();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    stopPicker();
    chrome.runtime.sendMessage({ type: 'PICKER_CANCELLED' }, () => { void chrome.runtime.lastError; });
  }
}
