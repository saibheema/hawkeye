/**
 * DOM Reader — analyzes the current page, generates unique CSS selectors,
 * and surfaces interactive elements for the agent
 */

import type { DOMElement, DOMAnalysis } from '@hawkeye/types';

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'LABEL']);
const MAX_ELEMENTS = 150;

export type LocatorCandidate = {
  type: 'css' | 'label' | 'text' | 'name' | 'placeholder' | 'aria' | 'role';
  value: string;
  selector?: string;
  score: number;
  tagName?: string;
  inputType?: string;
};

export function analyzeDom(rootSelector?: string): DOMAnalysis {
  const root = rootSelector
    ? (document.querySelector(rootSelector) ?? document.body)
    : document.body;

  const elements: DOMElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let node: Element | null = walker.currentNode as Element;
  while (node && elements.length < MAX_ELEMENTS) {
    if (isInteresting(node)) {
      elements.push(describeElement(node));
    }
    node = walker.nextNode() as Element | null;
  }

  // Extract forms
  const forms = Array.from(document.forms).map((form) => ({
    id: form.id || null,
    name: form.name || null,
    action: form.action || null,
    method: form.method || 'get',
    selector: getSelector(form),
    fields: Array.from(form.elements)
      .filter((el) => (el as HTMLInputElement).name)
      .map((el) => ({
        name: (el as HTMLInputElement).name,
        type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
        selector: getSelector(el as Element),
        required: (el as HTMLInputElement).required ?? false,
        value: (el as HTMLInputElement).value ?? '',
      })),
  }));

  return {
    url: location.href,
    title: document.title,
    elements,
    forms,
    interactiveCount: elements.filter((e) => e.interactive).length,
  };
}

function isInteresting(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('role')) return true;
  if ((el as HTMLElement).onclick) return true;
  if (el.getAttribute('data-testid')) return true;
  if (el.getAttribute('aria-label')) return true;
  return false;
}

function describeElement(el: Element): DOMElement {
  const rect = el.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0 &&
    rect.top >= 0 && rect.top < window.innerHeight;

  return {
    tagName: el.tagName.toLowerCase(),
    selector: getSelector(el),
    text: el.textContent?.trim().slice(0, 100) ?? '',
    placeholder: (el as HTMLInputElement).placeholder ?? '',
    type: (el as HTMLInputElement).type ?? '',
    name: (el as HTMLInputElement).name ?? '',
    id: el.id ?? '',
    classes: el.className ?? '',
    ariaLabel: el.getAttribute('aria-label') ?? '',
    role: el.getAttribute('role') ?? '',
    href: (el as HTMLAnchorElement).href ?? '',
    visible,
    interactive: INTERACTIVE_TAGS.has(el.tagName) || !!el.getAttribute('role'),
    boundingBox: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

/**
 * Generate a unique CSS selector for an element
 * Priority: id > data-testid > aria-label > nth-child path
 */
export function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${cssString(testId)}"]`;

  if (el instanceof HTMLLabelElement && el.htmlFor) {
    return `label[for="${cssString(el.htmlFor)}"]`;
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${cssString(ariaLabel)}"]`;

  const name = (el as HTMLInputElement).name;
  if (name && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
    const input = el as HTMLInputElement;
    if (input instanceof HTMLInputElement && ['radio', 'checkbox'].includes(input.type) && input.value) {
      return `${el.tagName.toLowerCase()}[name="${cssString(name)}"][value="${cssString(input.value)}"]`;
    }
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  // Build path
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const currentTag = current.tagName;
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === currentTag
    );
    if (siblings.length === 1) {
      path.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      path.unshift(`${tag}:nth-of-type(${index})`);
    }
    current = parent;
    if (current && current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
  }

  return path.join(' > ');
}

export function getLocatorCandidates(el: Element): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  const add = (candidate: LocatorCandidate) => {
    const key = `${candidate.type}:${candidate.selector ?? ''}:${candidate.value}`;
    if (!candidate.value || candidates.some((item) => `${item.type}:${item.selector ?? ''}:${item.value}` === key)) return;
    candidates.push(candidate);
  };
  const tagName = el.tagName.toLowerCase();
  const inputType = (el as HTMLInputElement).type || undefined;
  const primary = getSelector(el);

  add({ type: 'css', value: primary, selector: primary, score: 100, tagName, inputType });
  if (el.id) add({ type: 'css', value: `#${CSS.escape(el.id)}`, selector: `#${CSS.escape(el.id)}`, score: 95, tagName, inputType });

  if (el instanceof HTMLLabelElement && el.htmlFor) {
    add({ type: 'css', value: `label[for="${cssString(el.htmlFor)}"]`, selector: `label[for="${cssString(el.htmlFor)}"]`, score: 96, tagName, inputType });
    add({ type: 'label', value: humanizeLocatorText(el.htmlFor), score: 86, tagName, inputType });
  }

  const testId = el.getAttribute('data-testid');
  if (testId) add({ type: 'css', value: `[data-testid="${cssString(testId)}"]`, selector: `[data-testid="${cssString(testId)}"]`, score: 94, tagName, inputType });

  const name = (el as HTMLInputElement).name;
  if (name) {
    const input = el as HTMLInputElement;
    const isChoice = input instanceof HTMLInputElement && ['radio', 'checkbox'].includes(input.type);
    if (isChoice && input.value) {
      add({ type: 'css', value: `${tagName}[name="${cssString(name)}"][value="${cssString(input.value)}"]`, selector: `${tagName}[name="${cssString(name)}"][value="${cssString(input.value)}"]`, score: 92, tagName, inputType });
    } else {
      add({ type: 'css', value: `${tagName}[name="${cssString(name)}"]`, selector: `${tagName}[name="${cssString(name)}"]`, score: 90, tagName, inputType });
      add({ type: 'name', value: name, score: 76, tagName, inputType });
    }
  }

  const aria = el.getAttribute('aria-label');
  if (aria) {
    add({ type: 'css', value: `${tagName}[aria-label="${cssString(aria)}"]`, selector: `${tagName}[aria-label="${cssString(aria)}"]`, score: 88, tagName, inputType });
    add({ type: 'aria', value: aria, score: 84, tagName, inputType });
  }

  const placeholder = (el as HTMLInputElement).placeholder;
  if (placeholder) {
    add({ type: 'css', value: `${tagName}[placeholder="${cssString(placeholder)}"]`, selector: `${tagName}[placeholder="${cssString(placeholder)}"]`, score: 82, tagName, inputType });
    add({ type: 'placeholder', value: placeholder, score: 74, tagName, inputType });
  }

  const label = labelForElement(el);
  if (label) add({ type: 'label', value: label, score: 80, tagName, inputType });

  const role = el.getAttribute('role');
  if (role) add({ type: 'role', value: role, score: 62, tagName, inputType });

  const text = visibleText(el);
  if (text) add({ type: 'text', value: text.slice(0, 120), score: 58, tagName, inputType });

  return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
}

function labelForElement(el: Element): string {
  const explicit = el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || '';
  if (explicit) return explicit.trim();

  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  const wrappedLabel = el.closest('label')?.textContent?.trim();
  if (wrappedLabel) return wrappedLabel;

  if (el instanceof HTMLLabelElement && el.htmlFor) return humanizeLocatorText(el.htmlFor);

  return '';
}

function visibleText(el: Element): string {
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
    return el.value.trim();
  }
  return el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

function humanizeLocatorText(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}
