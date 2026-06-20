/**
 * DOM Reader — analyzes the current page, generates unique CSS selectors,
 * and surfaces interactive elements for the agent
 */

import type { DOMElement, DOMAnalysis } from '@hawkeye/types';

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'LABEL']);
const MAX_ELEMENTS = 150;

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
  if (testId) return `[data-testid="${testId}"]`;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;

  const name = (el as HTMLInputElement).name;
  if (name && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
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
