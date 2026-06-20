/**
 * Tool Executor — 8 browser automation tools available to the agent
 * Each tool maps to a content-script or service-worker action
 */

import type { LLMTool } from './llm-client.js';

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type PersistedDomMutation = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
};

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

export const TOOLS: LLMTool[] = [
  {
    name: 'navigate',
    description: 'Navigate the browser tab to a URL',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description: 'Click a DOM element identified by a CSS selector. Use iframe_selector if the target is inside an <iframe>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
        iframe_selector: { type: 'string', description: 'CSS selector of the <iframe> that contains the target (optional)' },
        frameId: { type: 'number', description: 'Chrome frameId from read_page for iframe targets (optional).' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an input or textarea element. Use iframe_selector if the target is inside an <iframe>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input field' },
        text: { type: 'string', description: 'Text to type into the field' },
        iframe_selector: { type: 'string', description: 'CSS selector of the <iframe> that contains the target (optional)' },
        frameId: { type: 'number', description: 'Chrome frameId from read_page for iframe targets (optional).' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'select_option',
    description: 'Select a value from a <select> dropdown. Use iframe_selector if the element is inside an <iframe>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the select element' },
        value: { type: 'string', description: 'Option value to select' },
        iframe_selector: { type: 'string', description: 'CSS selector of the <iframe> that contains the target (optional)' },
        frameId: { type: 'number', description: 'Chrome frameId from read_page for iframe targets (optional).' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'add_dropdown_option',
    description: 'Add a temporary option to a native <select> or custom dropdown/combobox by label or nearby text. Works across the page and iframes. Use for requests like "add ROD as another option in Make field".',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Label or nearby text identifying the dropdown, e.g. "Make", "Year", or "Vehicle Type".' },
        optionLabel: { type: 'string', description: 'Visible option text to add, e.g. "ROD".' },
        optionValue: { type: 'string', description: 'Option value to add. Defaults to optionLabel.' },
      },
      required: ['label', 'optionLabel'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a specific element into view',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to scroll to (optional)' },
        y: { type: 'number', description: 'Pixels to scroll down (used if no selector)' },
      },
    },
  },
  {
    name: 'read_page',
    description: 'Read the current page DOM: returns interactive elements, forms, and visible text. Use iframe_selector to read inside an <iframe>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional root selector to narrow the analysis' },
        iframe_selector: { type: 'string', description: 'CSS selector of the <iframe> to read inside (optional)' },
      },
    },
  },
  {
    name: 'wait',
    description: 'Wait for a number of milliseconds before proceeding',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (max 5000)' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'query_element',
    description: 'Query whether a specific element exists and get its current value/text. Use iframe_selector if the element is inside an <iframe>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to query' },
        iframe_selector: { type: 'string', description: 'CSS selector of the <iframe> that contains the target (optional)' },
        frameId: { type: 'number', description: 'Chrome frameId from read_page for iframe targets (optional).' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_op',
    description: 'Perform a structural DOM operation: change text content, set/remove an attribute, remove an element, or toggle a CSS class. Use when insert_css is not enough (e.g. changing button labels, placeholder text, link URLs, hiding/removing elements by selector).',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['set_text', 'set_html', 'set_attr', 'remove_attr', 'remove', 'add_class', 'remove_class'],
          description: 'Operation: set_text (change innerText), set_html (change innerHTML), set_attr (set attribute), remove_attr (remove attribute), remove (delete element), add_class / remove_class (toggle CSS class).',
        },
        selector: { type: 'string', description: 'CSS selector — applies to all matching elements.' },
        value: { type: 'string', description: 'New value for set_text, set_html, set_attr, add_class, remove_class.' },
        attr: { type: 'string', description: 'Attribute name for set_attr / remove_attr (e.g. "href", "placeholder", "disabled").' },
      },
      required: ['op', 'selector'],
    },
  },
  {
    name: 'insert_css',
    description: 'Inject CSS rules into the page to change visual styles (background color, fonts, layout, visibility, etc.). Persists across page reloads for the domain. Prefer this over any JS-based styling.',
    parameters: {
      type: 'object',
      properties: {
        css: { type: 'string', description: 'Valid CSS rules to inject. Examples: "body { background: lightblue !important; }" or "h1 { color: red; font-weight: bold; }" or ".banner { display: none !important; }"' },
      },
      required: ['css'],
    },
  },
  {
    name: 'set_style',
    description: 'Set inline CSS properties directly on matched element(s). More targeted than insert_css — affects only those elements. Good for one-off per-element style overrides like color, fontSize, border, opacity, display.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for target element(s)' },
        property: { type: 'string', description: 'CSS property name in camelCase or kebab-case. Examples: "backgroundColor", "fontSize", "border", "opacity", "display"' },
        value: { type: 'string', description: 'CSS value. Examples: "red", "24px", "none", "1px solid blue", "0.5"' },
      },
      required: ['selector', 'property', 'value'],
    },
  },
  {
    name: 'style_by_text',
    description: 'Find visible elements by their text and apply inline styles. Works across the page and iframes. Use for requests like "change Welcome color to red" or "make New Customer button blue" when the user gives visible text instead of a selector.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Visible text to find, e.g. "Welcome" or "New Customer".' },
        elementKind: {
          type: 'string',
          enum: ['any', 'button'],
          description: 'Use button when the user specifically mentions a button; otherwise use any.',
        },
        styles: {
          type: 'object',
          description: 'CSS styles to apply, using camelCase or kebab-case keys. Example: {"color":"red"} or {"backgroundColor":"blue","color":"#fff"}.',
          properties: {
            color: { type: 'string', description: 'Text color, e.g. "red" or "#ff0000".' },
            backgroundColor: { type: 'string', description: 'Background color, e.g. "blue".' },
            borderColor: { type: 'string', description: 'Border color.' },
            fontSize: { type: 'string', description: 'Font size, e.g. "18px".' },
            fontWeight: { type: 'string', description: 'Font weight, e.g. "700" or "bold".' },
            opacity: { type: 'string', description: 'Opacity, e.g. "0.5".' },
            display: { type: 'string', description: 'Display value, e.g. "none" or "block".' },
          },
        },
      },
      required: ['text', 'styles'],
    },
  },
  {
    name: 'set_placeholder_by_label',
    description: 'Find an input or textarea by label, nearby text, aria-label, placeholder, name, or id, then set its placeholder. Works across the page and iframes. Use for requests like "add placeholder for phone number textbox".',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Label or nearby text identifying the field, e.g. "phone number" or "email".' },
        placeholder: { type: 'string', description: 'Placeholder text to set.' },
      },
      required: ['label', 'placeholder'],
    },
  },
  {
    name: 'insert_html',
    description: 'Insert new HTML content relative to a target element. Use to add banners, badges, tooltips, buttons, or any new DOM nodes without replacing existing content.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the reference element' },
        position: {
          type: 'string',
          enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'],
          description: 'Where to insert: beforebegin=before element, afterbegin=inside at start, beforeend=inside at end, afterend=after element',
        },
        html: { type: 'string', description: 'HTML string to insert. Example: "<span style=\'color:green\'>✓ Verified</span>"' },
      },
      required: ['selector', 'position', 'html'],
    },
  },
  {
    name: 'trigger_event',
    description: 'Programmatically fire a DOM event on an element. Use to simulate hover (mouseover/mouseout), focus/blur, input/change for reactive UIs, or submit a form.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the target element' },
        event: {
          type: 'string',
          enum: ['click', 'dblclick', 'focus', 'blur', 'change', 'input', 'submit', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'keydown', 'keyup', 'scroll'],
          description: 'Event type to dispatch',
        },
        key: { type: 'string', description: 'Key value for keydown/keyup events (e.g. "Enter", "Escape", "Tab")' },
      },
      required: ['selector', 'event'],
    },
  },
  {
    name: 'get_property',
    description: 'Read a value from a DOM element: its text, attribute, computed CSS style, or form value. Use to verify changes, inspect the current state, or collect data before acting.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the target element' },
        kind: {
          type: 'string',
          enum: ['text', 'html', 'value', 'attr', 'computed_style', 'count', 'bounding_rect'],
          description: 'What to read: text=innerText, html=innerHTML, value=form input value, attr=any attribute, computed_style=getComputedStyle property, count=number of matching elements, bounding_rect=position and size',
        },
        name: { type: 'string', description: 'Attribute name (for kind=attr) or CSS property name (for kind=computed_style). Example: "href", "data-id", "color", "font-size"' },
      },
      required: ['selector', 'kind'],
    },
  },
  {
    name: 'replace_text',
    description: 'Find and replace text anywhere in the visible page content. Searches all text nodes in the DOM and replaces exact string matches. Does not affect script/style tags.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Exact text string to find' },
        replace: { type: 'string', description: 'Text to replace it with' },
        case_sensitive: { type: 'boolean', description: 'Whether the match is case-sensitive (default: false)' },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'set_css_var',
    description: 'Set a CSS custom property (CSS variable) on :root or a specific element. Instantly re-themes sites that use design tokens. Example: change --primary-color to rebrand a whole site.',
    parameters: {
      type: 'object',
      properties: {
        variable: { type: 'string', description: 'CSS variable name including --. Example: "--primary-color", "--font-size-base"' },
        value: { type: 'string', description: 'New value. Example: "#e91e63", "18px", "bold"' },
        selector: { type: 'string', description: 'Element to set the variable on (default: ":root")' },
      },
      required: ['variable', 'value'],
    },
  },
];

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tabId: number
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'navigate': {
        await chrome.tabs.update(tabId, { url: args.url as string });
        // Wait for load
        await waitForTabLoad(tabId);
        return { ok: true, data: { navigated: args.url } };
      }

      case 'click': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o, 'click') as HTMLElement | null;
              if (!el) return { ok: false, error: `Element not found in frame: ${o.selector}` };
              el.click();
              return { ok: true };
              function findReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el && matchesKind(el, kind)) return el;
                  } catch {}
                }
                return findBySemantic(payload, kind);
              }
              function matchesKind(el: Element, kind: 'click' | 'type' | 'select') {
                if (kind === 'select') return el instanceof HTMLSelectElement;
                if (kind === 'type') return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
                return el instanceof HTMLElement;
              }
              function findBySemantic(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                const selector = kind === 'click' ? 'button,a,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],label,[onclick]' : kind === 'select' ? 'select' : 'input:not([type="hidden"]),textarea';
                const elements = Array.from(document.querySelectorAll(selector));
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => matchesKind(el, kind) && normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                parts.push(el.getAttribute('aria-label') ?? '');
                parts.push((el as HTMLInputElement).placeholder ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function textFor(el: Element) {
                if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
                return el.textContent ?? '';
              }
              function attrText(el: Element) {
                return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('role')].filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select') {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload, kind);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload, kind);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { clicked: args.selector } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o, 'click') as HTMLElement | null;
              if (!el) return { ok: false, error: `Element not found in iframe: ${o.selector}` };
              el.click();
              return { ok: true };
              function findReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el && matchesKind(el, kind)) return el;
                  } catch {}
                }
                return findBySemantic(payload, kind);
              }
              function matchesKind(el: Element, kind: 'click' | 'type' | 'select') {
                if (kind === 'select') return el instanceof HTMLSelectElement;
                if (kind === 'type') return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
                return el instanceof HTMLElement;
              }
              function findBySemantic(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                const selector = kind === 'click' ? 'button,a,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],label,[onclick]' : kind === 'select' ? 'select' : 'input:not([type="hidden"]),textarea';
                const elements = Array.from(document.querySelectorAll(selector));
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => matchesKind(el, kind) && normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                parts.push(el.getAttribute('aria-label') ?? '');
                parts.push((el as HTMLInputElement).placeholder ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function textFor(el: Element) {
                if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
                return el.textContent ?? '';
              }
              function attrText(el: Element) {
                return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('role')].filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select') {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload, kind);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload, kind);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { clicked: args.selector } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_CLICK', payload: args });
        return res.ok
          ? { ok: true, data: { clicked: args.selector } }
          : { ok: false, error: res.error };
      }

      case 'type_text': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o) as HTMLInputElement | HTMLTextAreaElement | null;
              if (!el) return { ok: false, error: `Input not found in frame: ${o.selector}` };
              el.focus();
              el.value = String(o.text ?? '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
              function findReplayElement(payload: Record<string, any>): Element | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
                  } catch {}
                }
                const elements = Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => normalize([labelFor(el), el.placeholder, el.name, el.id, el.getAttribute('aria-label')].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { typed: args.text } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o) as HTMLInputElement | HTMLTextAreaElement | null;
              if (!el) return { ok: false, error: `Input not found in iframe: ${o.selector}` };
              el.focus();
              el.value = String(o.text ?? '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
              function findReplayElement(payload: Record<string, any>): Element | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
                  } catch {}
                }
                const elements = Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => normalize([labelFor(el), el.placeholder, el.name, el.id, el.getAttribute('aria-label')].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { typed: args.text } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_TYPE', payload: args });
        return res.ok
          ? { ok: true, data: { typed: args.text } }
          : { ok: false, error: res.error };
      }

      case 'select_option': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o);
              if (!el) return { ok: false, error: `Select not found in frame: ${o.selector}` };
              el.value = String(o.value ?? '');
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
              function findReplayElement(payload: Record<string, any>): HTMLSelectElement | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el instanceof HTMLSelectElement) return el;
                  } catch {}
                }
                const elements = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => normalize([labelFor(el), el.name, el.id, el.getAttribute('aria-label')].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { selected: args.value } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            async (o: Record<string, any>) => {
              const el = await waitForReplayElement(o);
              if (!el) return { ok: false, error: `Select not found in iframe: ${o.selector}` };
              el.value = String(o.value ?? '');
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
              function findReplayElement(payload: Record<string, any>): HTMLSelectElement | null {
                const selectors = [payload.selector, ...(Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type === 'css').map((c: any) => c.selector || c.value) : [])].filter(Boolean);
                for (const selector of selectors) {
                  try {
                    const el = document.querySelector(selector);
                    if (el instanceof HTMLSelectElement) return el;
                  } catch {}
                }
                const elements = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates.filter((c: any) => c.type !== 'css') : [];
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => normalize([labelFor(el), el.name, el.id, el.getAttribute('aria-label')].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                return parts.filter(Boolean).join(' ');
              }
              function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 5000;
                let el = findReplayElement(payload);
                while (!el && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  el = findReplayElement(payload);
                }
                return el;
              }
            }, args);
          return res.ok ? { ok: true, data: { selected: args.value } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_SELECT', payload: args });
        return res.ok
          ? { ok: true, data: { selected: args.value } }
          : { ok: false, error: res.error };
      }

      case 'add_dropdown_option': {
        type AddDropdownOptionArgs = { label: string; optionLabel: string; optionValue?: string };
        const a = args as unknown as AddDropdownOptionArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: AddDropdownOptionArgs) => {
            const needle = o.label.trim().toLowerCase()
              .replace(/\b(?:dropdown|drop\s*down|select|field|option)\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            const optionLabel = o.optionLabel.trim();
            const optionValue = (o.optionValue ?? o.optionLabel).trim();
            if (!needle || !optionLabel) return { ok: true as const, count: 0, frameUrl: location.href };

            const textOf = (node: Element | null): string => node?.textContent?.trim() ?? '';
            const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();
            const labelFor = (el: Element): string => {
              const parts: string[] = [];
              const id = el.getAttribute('id');
              if (id) parts.push(textOf(document.querySelector(`label[for="${CSS.escape(id)}"]`)));
              parts.push(textOf(el.closest('label')));
              parts.push(el.getAttribute('aria-label') ?? '');
              parts.push(el.getAttribute('placeholder') ?? '');
              parts.push(el.getAttribute('name') ?? '');
              parts.push(id ?? '');
              parts.push(textOf(el.previousElementSibling));
              parts.push(textOf(el.parentElement));
              parts.push(textOf(el.closest('div, section, form, fieldset')));
              return normalize(parts.filter(Boolean).join(' '));
            };
            const matchesLabel = (el: Element) => labelFor(el).includes(needle);
            let count = 0;

            for (const select of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
              if (!matchesLabel(select)) continue;
              const exists = Array.from(select.options).some((option) =>
                normalize(option.textContent ?? '') === normalize(optionLabel)
                || option.value === optionValue
              );
              if (!exists) select.add(new Option(optionLabel, optionValue));
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));
              count++;
            }

            const controls = Array.from(document.querySelectorAll('[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"],button,input,.select,.dropdown,[class*="select"],[class*="dropdown"]')) as HTMLElement[];
            for (const control of controls) {
              if (!matchesLabel(control)) continue;
              control.dataset.hawkeyeDropdownLabel = needle;
              control.dataset.hawkeyeDropdownOptionLabel = optionLabel;
              control.dataset.hawkeyeDropdownOptionValue = optionValue;
              count++;
            }

            const activeLabel = document.activeElement instanceof Element ? labelFor(document.activeElement) : '';
            const expandedControl = controls.find((control) => control.getAttribute('aria-expanded') === 'true' && matchesLabel(control));
            const shouldPatchOpenMenu = activeLabel.includes(needle) || !!expandedControl || count > 0;
            if (shouldPatchOpenMenu) {
              const menus = Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],ul[class*="menu"],div[class*="menu"],div[class*="dropdown"],div[class*="option"]')) as HTMLElement[];
              for (const menu of menus) {
                const rect = menu.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                const exists = Array.from(menu.querySelectorAll('[role="option"],li,button,div,span')).some((item) =>
                  normalize(item.textContent ?? '') === normalize(optionLabel)
                );
                if (exists) continue;
                const option = document.createElement(menu.tagName === 'UL' ? 'li' : 'div');
                option.setAttribute('role', 'option');
                option.setAttribute('data-hawkeye-added-option', 'true');
                option.setAttribute('data-value', optionValue);
                option.textContent = optionLabel;
                option.style.cursor = 'pointer';
                option.style.padding = '8px 12px';
                option.addEventListener('click', () => {
                  const target = expandedControl ?? document.activeElement;
                  if (target instanceof HTMLInputElement) target.value = optionLabel;
                  if (target instanceof HTMLElement) {
                    target.textContent = target instanceof HTMLInputElement ? target.value : optionLabel;
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                    target.dispatchEvent(new Event('change', { bubbles: true }));
                    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  }
                });
                menu.appendChild(option);
                count++;
              }
            }

            return { ok: true as const, count, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No dropdown matched label: ${a.label}` };
        await persistDomMutation(tabId, 'add_dropdown_option', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected, optionLabel: a.optionLabel } };
      }

      case 'scroll': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            (selector?: string, y?: number) => {
              const el = selector ? document.querySelector(selector) : null;
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                window.scrollBy({ top: y ?? 300, behavior: 'smooth' });
              }
              return { ok: true };
            }, args.selector as string | undefined, args.y as number | undefined);
          return res.ok ? { ok: true, data: res } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_SCROLL', payload: { selector: args.selector, y: args.y } });
        return { ok: true, data: res };
      }

      case 'read_page': {
        type ReadPageArgs = { selector?: string; iframe_selector?: string };
        const rpa = args as ReadPageArgs;

        if (rpa.iframe_selector) {
          const res = await execInFrame(tabId, rpa.iframe_selector,
            () => {
              const INTERACTIVE = ['input','select','textarea','button','a','[role="button"]','[role="combobox"]','[role="listbox"]','[role="option"]','[role="checkbox"]','[role="radio"]'];
              const inputs = Array.from(document.querySelectorAll(INTERACTIVE.join(',')))
                .slice(0, 120)
                .map((el) => ({
                  tag: el.tagName.toLowerCase(),
                  type: (el as HTMLInputElement).type ?? null,
                  name: (el as HTMLInputElement).name ?? null,
                  id: el.id || null,
                  placeholder: (el as HTMLInputElement).placeholder ?? null,
                  value: (el as HTMLInputElement).value ?? null,
                  disabled: (el as HTMLInputElement).disabled ?? false,
                  ariaLabel: el.getAttribute('aria-label'),
                  text: el.textContent?.trim().slice(0, 100) ?? null,
                  selector: el.id ? '#' + el.id : el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : el.tagName.toLowerCase(),
                }));
              const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,[role="heading"]'))
                .slice(0, 20)
                .map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 200) ?? '' }))
                .filter(s => s.text.length > 0);
              return { ok: true, elements: inputs, textSections: headings, title: document.title, url: location.href };
            });
          return { ok: true, data: res };
        }

        let results;
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: 'MAIN',
          func: (rootSel?: string) => {
            const root = rootSel ? (document.querySelector(rootSel) ?? document.body) : document.body;
            const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'LABEL']);

            function getSelector(el: Element): string {
              if (el.id) return '#' + CSS.escape(el.id);
              const tid = el.getAttribute('data-testid');
              if (tid) return `[data-testid="${tid}"]`;
              const aria = el.getAttribute('aria-label');
              if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`;
              const nm = (el as HTMLInputElement).name;
              if (nm && ['INPUT','SELECT','TEXTAREA'].includes(el.tagName))
                return `${el.tagName.toLowerCase()}[name="${nm}"]`;
              const path: string[] = [];
              let cur: Element | null = el;
              while (cur && cur !== document.documentElement) {
                const tag = cur.tagName.toLowerCase();
                const parent: Element | null = cur.parentElement;
                if (!parent) break;
                const sibs = Array.from(parent.children).filter((c: Element) => c.tagName === cur!.tagName);
                path.unshift(sibs.length === 1 ? tag : `${tag}:nth-of-type(${sibs.indexOf(cur) + 1})`);
                cur = parent;
                if (cur?.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
              }
              return path.join(' > ');
            }

            const elements: object[] = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node: Element | null = walker.currentNode as Element;
            while (node && elements.length < 200) {
              const isInteractive = INTERACTIVE.has(node.tagName) || !!node.getAttribute('role') || !!node.getAttribute('aria-label') || !!(node as HTMLElement).onclick || !!node.getAttribute('data-testid');
              if (isInteractive) {
                const rect = node.getBoundingClientRect();
                elements.push({
                  tag: node.tagName.toLowerCase(),
                  selector: getSelector(node),
                  frameUrl: location.href,
                  text: node.textContent?.trim().slice(0, 120) ?? '',
                  type: (node as HTMLInputElement).type ?? '',
                  name: (node as HTMLInputElement).name ?? '',
                  id: node.id ?? '',
                  placeholder: (node as HTMLInputElement).placeholder ?? '',
                  ariaLabel: node.getAttribute('aria-label') ?? '',
                  role: node.getAttribute('role') ?? '',
                  href: (node as HTMLAnchorElement).href ?? '',
                  value: (node as HTMLInputElement).value ?? '',
                  disabled: (node as HTMLInputElement).disabled ?? false,
                  visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight,
                });
              }
              node = walker.nextNode() as Element | null;
            }

            // Visible text sections (headings + paragraphs)
            const textSections = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,[role="heading"]'))
              .slice(0, 30)
              .map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 200) ?? '' }))
              .filter(s => s.text.length > 0);

            // Forms
            const forms = Array.from(document.forms).map(form => ({
              id: form.id || null,
              action: form.action || null,
              method: form.method || 'get',
              selector: getSelector(form),
              frameUrl: location.href,
              fields: Array.from(form.elements)
                .filter(el => (el as HTMLInputElement).name)
                .map(el => ({
                  name: (el as HTMLInputElement).name,
                  type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
                  selector: getSelector(el as Element),
                  value: (el as HTMLInputElement).value ?? '',
                  required: (el as HTMLInputElement).required ?? false,
                })),
            }));

            // Iframes on the page
            const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
              selector: getSelector(f),
              src: f.src,
              title: f.title,
              name: f.name,
            }));

            return {
              ok: true,
              url: location.href,
              title: document.title,
              frameUrl: location.href,
              elements,
              textSections,
              forms,
              iframes,
              interactiveCount: elements.length,
            };
          },
          args: [rpa.selector],
          });
        } catch (e: any) {
          // executeScript can fail on restricted pages — return a graceful fallback
          // so the agent can still proceed with replace_text / dom_op using guessed selectors
          return { ok: true, data: { url: '', title: '', elements: [], textSections: [], forms: [], iframes: [], interactiveCount: 0, warning: `read_page unavailable: ${e?.message ?? e}` } };
        }

        const frameAnalyses = (results ?? [])
          .map((entry) => entry.result ? { ...(entry.result as any), frameId: entry.frameId } : null)
          .filter(Boolean);
        const analysis = frameAnalyses[0];
        if (!analysis) return { ok: false, error: 'Could not analyze page — scripting permission may not cover this URL' };
        return {
          ok: true,
          data: {
            ...analysis,
            elements: frameAnalyses.flatMap((frame: any) => (frame.elements ?? []).map((el: any) => ({ ...el, frameId: frame.frameId }))),
            textSections: frameAnalyses.flatMap((frame: any) => (frame.textSections ?? []).map((section: any) => ({ ...section, frameId: frame.frameId, frameUrl: frame.frameUrl }))),
            forms: frameAnalyses.flatMap((frame: any) => (frame.forms ?? []).map((form: any) => ({ ...form, frameId: frame.frameId }))),
            frames: frameAnalyses.map((frame: any) => ({
              frameId: frame.frameId,
              url: frame.url,
              title: frame.title,
              elementCount: frame.elements?.length ?? 0,
              textCount: frame.textSections?.length ?? 0,
              formCount: frame.forms?.length ?? 0,
            })),
            interactiveCount: frameAnalyses.reduce((sum: number, frame: any) => sum + (frame.interactiveCount ?? 0), 0),
          },
        };
      }

      case 'wait': {
        const ms = Math.min(Number(args.ms ?? 1000), 5000);
        await new Promise((r) => setTimeout(r, ms));
        return { ok: true, data: { waited: ms } };
      }

      case 'query_element': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement | null;
              return {
                found: !!el,
                tagName: el?.tagName ?? null,
                value: el?.value ?? null,
                text: el?.textContent?.slice(0, 200) ?? null,
                disabled: el ? (el as HTMLInputElement).disabled : null,
              };
            }, args.selector as string);
          return { ok: true, data: res };
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement | null;
              return {
                found: !!el,
                tagName: el?.tagName ?? null,
                value: el?.value ?? null,
                text: el?.textContent?.slice(0, 200) ?? null,
                disabled: el ? (el as HTMLInputElement).disabled : null,
              };
            }, args.selector as string);
          return { ok: true, data: res };
        }
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            return {
              found: !!el,
              tagName: el?.tagName ?? null,
              value: el?.value ?? null,
              text: el?.textContent?.slice(0, 200) ?? null,
              disabled: el ? (el as HTMLInputElement).disabled : null,
              frameUrl: location.href,
            };
          },
          args: [args.selector as string],
        });
        const match = res.find((frameResult) => (frameResult.result as any)?.found);
        return { ok: true, data: match?.result ?? { found: false } };
      }

      case 'dom_op': {
        type DomOpArgs = { op: string; selector: string; value?: string; attr?: string };
        const op = args as unknown as DomOpArgs;
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: DomOpArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector)) as HTMLElement[];
            for (const el of els) {
              switch (o.op) {
                case 'set_text':     el.innerText = o.value ?? ''; break;
                case 'set_html':     el.innerHTML = o.value ?? ''; break;
                case 'set_attr':     el.setAttribute(o.attr!, o.value ?? ''); break;
                case 'remove_attr':  el.removeAttribute(o.attr!); break;
                case 'remove':       el.remove(); break;
                case 'add_class':    el.classList.add(o.value!); break;
                case 'remove_class': el.classList.remove(o.value!); break;
                default: return { ok: false, error: `Unknown op: ${o.op}` };
              }
            }
            return { ok: true, count: els.length, frameUrl: location.href };
          },
          args: [op],
        });
        const failed = results.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = results.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${op.selector}` };
        await persistDomMutation(tabId, 'dom_op', op as unknown as Record<string, unknown>, results);
        return { ok: true, data: { affected } };
      }

      case 'insert_css': {
        const css = args.css as string;
        await chrome.scripting.insertCSS({
          target: { tabId, allFrames: true },
          css,
        });
        // Persist so content script can re-inject after page reload
        const tab = await chrome.tabs.get(tabId);
        const domain = tab.url ? new URL(tab.url).hostname : null;
        if (domain) {
          const key = `hawkeye_css_${domain}`;
          const stored = await chrome.storage.local.get(key);
          const rules: string[] = stored[key] ?? [];
          rules.push(css);
          await chrome.storage.local.set({ [key]: rules });
        }
        return { ok: true, data: { injected: true, css } };
      }

      case 'set_style': {
        type SetStyleArgs = { selector: string; property: string; value: string };
        const a = args as unknown as SetStyleArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: SetStyleArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector)) as HTMLElement[];
            // Accept both camelCase and kebab-case property names
            const prop = o.property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            for (const el of els) (el.style as any)[prop] = o.value;
            return { ok: true, count: els.length, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        await persistDomMutation(tabId, 'set_style', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
      }

      case 'insert_html': {
        type InsertHtmlArgs = { selector: string; position: InsertPosition; html: string };
        const a = args as unknown as InsertHtmlArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: InsertHtmlArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector));
            for (const el of els) el.insertAdjacentHTML(o.position, o.html);
            return { ok: true, count: els.length, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const insertedCount = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (insertedCount === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        return { ok: true, data: { inserted: true, insertedCount } };
      }

      case 'trigger_event': {
        type TriggerArgs = { selector: string; event: string; key?: string; locatorCandidates?: Array<Record<string, unknown>> };
        const a = args as unknown as TriggerArgs;
        const fireEvent = async (o: TriggerArgs) => {
          const els = await waitForReplayElements(o);
          for (const el of els) {
            let evt: Event;
            if (['keydown', 'keyup', 'keypress'].includes(o.event)) {
              evt = new KeyboardEvent(o.event, { key: o.key ?? '', bubbles: true, cancelable: true });
            } else if (['click', 'dblclick', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'].includes(o.event)) {
              evt = new MouseEvent(o.event, { bubbles: true, cancelable: true });
            } else {
              evt = new Event(o.event, { bubbles: true, cancelable: true });
            }
            el.dispatchEvent(evt);
            const isEnterSubmit = o.event === 'keydown'
              && o.key === 'Enter'
              && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)
              && !!el.form;
            if ((o.event === 'submit' && el instanceof HTMLFormElement && !evt.defaultPrevented) || (isEnterSubmit && !evt.defaultPrevented)) {
              const form = el instanceof HTMLFormElement ? el : (el as HTMLInputElement | HTMLSelectElement).form;
              if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
              else form?.submit();
            }
            if (o.event === 'focus') el.focus?.();
            if (o.event === 'blur')  el.blur?.();
          }
          return { ok: true as const, count: els.length };
          function findReplayElements(payload: TriggerArgs): HTMLElement[] {
            const found: HTMLElement[] = [];
            const selectors = [
              payload.selector,
              ...((Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [])
                .filter((candidate) => candidate.type === 'css')
                .map((candidate) => String(candidate.selector ?? candidate.value ?? ''))),
            ].filter(Boolean);
            for (const selector of selectors) {
              try {
                for (const el of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
                  if (!found.includes(el)) found.push(el);
                }
              } catch {}
            }
            if (found.length > 0) return found;

            const semantic = (Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : []).filter((candidate) => candidate.type !== 'css');
            const elements = Array.from(document.querySelectorAll('button,a,[role="button"],input,textarea,select,form,label,[onclick]')) as HTMLElement[];
            for (const candidate of semantic) {
              const needle = normalize(String(candidate.value ?? ''));
              if (!needle) continue;
              const match = elements.find((el) => normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')).includes(needle));
              if (match && !found.includes(match)) found.push(match);
            }
            return found;
          }
          function labelFor(el: Element) {
            const parts: string[] = [];
            if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
            parts.push(el.closest('label')?.textContent?.trim() ?? '');
            parts.push(el.getAttribute('aria-label') ?? '');
            parts.push((el as HTMLInputElement).placeholder ?? '');
            return parts.filter(Boolean).join(' ');
          }
          function textFor(el: Element) {
            if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
            return el.textContent ?? '';
          }
          function attrText(el: Element) {
            return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('role')].filter(Boolean).join(' ');
          }
          function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
          async function waitForReplayElements(payload: TriggerArgs): Promise<HTMLElement[]> {
            const deadline = Date.now() + 5000;
            let elements = findReplayElements(payload);
            while (elements.length === 0 && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              elements = findReplayElements(payload);
            }
            return elements;
          }
        };
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId, fireEvent, a);
          if (!res.ok) return res;
          const count = Number((res.data as any)?.count ?? 0);
          if (count === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
          return { ok: true, data: { fired: args.event, affected: count } };
        }
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: fireEvent,
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        return { ok: true, data: { fired: args.event, affected } };
      }

      case 'get_property': {
        type GetPropArgs = { selector: string; kind: string; name?: string };
        const a = args as unknown as GetPropArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: GetPropArgs) => {
            if (o.kind === 'count') {
              return { ok: true, value: document.querySelectorAll(o.selector).length };
            }
            const el = document.querySelector(o.selector) as HTMLElement | null;
            if (!el) return { ok: false, error: `Not found: ${o.selector}` };
            switch (o.kind) {
              case 'text':    return { ok: true, value: el.innerText };
              case 'html':    return { ok: true, value: el.innerHTML };
              case 'value':   return { ok: true, value: (el as HTMLInputElement).value };
              case 'attr':    return { ok: true, value: el.getAttribute(o.name ?? '') };
              case 'computed_style': {
                const style = window.getComputedStyle(el);
                return { ok: true, value: style.getPropertyValue(o.name ?? '') };
              }
              case 'bounding_rect': {
                const r = el.getBoundingClientRect();
                return { ok: true, value: { top: r.top, left: r.left, width: r.width, height: r.height } };
              }
              default: return { ok: false, error: `Unknown kind: ${o.kind}` };
            }
          },
          args: [a],
        });
        if (a.kind === 'count') {
          const value = res.reduce((sum, frameResult) => sum + (Number((frameResult.result as any)?.value) || 0), 0);
          return { ok: true, data: { value } };
        }
        const match = res.find((frameResult) => (frameResult.result as any)?.ok);
        if (!match?.result) return { ok: false, error: `Not found: ${a.selector}` };
        return { ok: true, data: { value: (match.result as any).value } };
      }

      case 'replace_text': {
        type ReplaceTextArgs = { find: string; replace: string; case_sensitive?: boolean };
        const a = args as unknown as ReplaceTextArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: ReplaceTextArgs) => {
            const root = document.body ?? document.documentElement;
            if (!root) return { ok: true as const, count: 0 };
            const flags = o.case_sensitive ? 'g' : 'gi';
            const escapedFind = o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const replaceValue = (value: string | null | undefined) => {
              if (!value) return null;
              const testPattern = new RegExp(escapedFind, flags);
              if (!testPattern.test(value)) return null;
              return value.replace(new RegExp(escapedFind, flags), o.replace);
            };
            let count = 0;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node: Text | null;
            while ((node = walker.nextNode() as Text | null)) {
              if (node.parentElement?.tagName === 'SCRIPT' || node.parentElement?.tagName === 'STYLE') continue;
              const nextText = replaceValue(node.textContent);
              if (nextText !== null) {
                node.textContent = nextText;
                count++;
              }
            }
            const candidates = Array.from(root.querySelectorAll(
              'input,textarea,button,option,optgroup,[role="button"],[aria-label],[title],[value]'
            )) as HTMLElement[];
            for (const el of candidates) {
              const input = el as HTMLInputElement | HTMLTextAreaElement;
              if ('value' in input) {
                const nextValue = replaceValue(input.value);
                if (nextValue !== null && nextValue !== input.value) {
                  input.value = nextValue;
                  count++;
                }
              }
              for (const attr of ['value', 'aria-label', 'title', 'alt']) {
                if (!el.hasAttribute(attr)) continue;
                const current = el.getAttribute(attr);
                const nextAttr = replaceValue(current);
                if (nextAttr !== null && nextAttr !== current) {
                  el.setAttribute(attr, nextAttr);
                  count++;
                }
              }
            }
            return { ok: true as const, count, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const replaced = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (replaced === 0) return { ok: false, error: `No visible text matched: ${a.find}` };
        await persistDomMutation(tabId, 'replace_text', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { replaced } };
      }

      case 'style_by_text': {
        type StyleByTextArgs = { text: string; styles: Record<string, string>; elementKind?: 'any' | 'button' };
        const a = args as unknown as StyleByTextArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: StyleByTextArgs) => {
            const needle = o.text.trim().toLowerCase();
            if (!needle) return { ok: true as const, count: 0 };
            const selector = o.elementKind === 'button'
              ? 'button,a,[role="button"],input[type="button"],input[type="submit"]'
              : 'h1,h2,h3,h4,h5,h6,p,span,label,button,a,[role="button"],input[type="button"],input[type="submit"],div';
            const candidates = (Array.from(document.querySelectorAll(selector)) as HTMLElement[])
              .filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              })
              .sort((a, b) => (a.textContent?.trim().length ?? 0) - (b.textContent?.trim().length ?? 0));
            let count = 0;
            for (const el of candidates) {
              const label = [
                el.innerText,
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('title'),
                (el as HTMLInputElement).value,
              ].filter(Boolean).join(' ').trim().toLowerCase();
              if (!label.includes(needle)) continue;
              if (o.elementKind !== 'button' && el.children.length > 0 && label !== needle) continue;
              for (const [property, value] of Object.entries(o.styles)) {
                const prop = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                (el.style as any)[prop] = value;
              }
              count++;
              if (o.elementKind !== 'button') break;
            }
            return { ok: true as const, count, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No visible element matched text: ${a.text}` };
        await persistDomMutation(tabId, 'style_by_text', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
      }

      case 'set_placeholder_by_label': {
        type PlaceholderArgs = { label: string; placeholder: string };
        const a = args as unknown as PlaceholderArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: PlaceholderArgs) => {
            const needle = o.label.trim().toLowerCase()
              .replace(/\b(?:text\s*box|textbox|input|field|label|placeholder)\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (!needle) return { ok: true as const, count: 0 };

            function textOf(el: Element | null): string {
              return el?.textContent?.trim() ?? '';
            }

            function associatedLabel(el: HTMLInputElement | HTMLTextAreaElement): string {
              const parts: string[] = [];
              if (el.id) parts.push(textOf(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
              parts.push(textOf(el.closest('label')));
              parts.push(el.getAttribute('aria-label') ?? '');
              parts.push(el.getAttribute('placeholder') ?? '');
              parts.push(el.name ?? '');
              parts.push(el.id ?? '');
              parts.push(textOf(el.previousElementSibling));
              parts.push(textOf(el.parentElement));
              parts.push(textOf(el.closest('div, section, form, fieldset')));
              return parts.filter(Boolean).join(' ').toLowerCase();
            }

            const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
            let count = 0;
            for (const field of fields) {
              const type = field instanceof HTMLInputElement ? field.type : 'textarea';
              if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type)) continue;
              const haystack = associatedLabel(field);
              if (!haystack.includes(needle)) continue;
              field.setAttribute('placeholder', o.placeholder);
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.dispatchEvent(new Event('change', { bubbles: true }));
              count++;
            }
            return { ok: true as const, count, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No input matched label: ${a.label}` };
        await persistDomMutation(tabId, 'set_placeholder_by_label', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
      }

      case 'set_css_var': {
        type SetCssVarArgs = { variable: string; value: string; selector?: string };
        const a = args as unknown as SetCssVarArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: SetCssVarArgs) => {
            const targets = o.selector
              ? Array.from(document.querySelectorAll(o.selector)) as HTMLElement[]
              : [document.documentElement];
            for (const target of targets) target.style.setProperty(o.variable, o.value);
            return { ok: true, count: targets.length, frameUrl: location.href };
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        await persistDomMutation(tabId, 'set_css_var', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { set: args.variable, to: args.value, affected } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function persistDomMutation(
  tabId: number,
  tool: string,
  args: Record<string, unknown>,
  results?: chrome.scripting.InjectionResult<unknown>[]
): Promise<void> {
  const hosts = new Set<string>();
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) {
    try { hosts.add(new URL(tab.url).hostname); } catch {}
  }
  for (const frameResult of results ?? []) {
    const result = frameResult.result as any;
    if (!result || Number(result.count ?? 0) <= 0 || !result.frameUrl) continue;
    try { hosts.add(new URL(result.frameUrl).hostname); } catch {}
  }

  const mutation: PersistedDomMutation = {
    id: stableMutationId(tool, args),
    tool,
    args,
    createdAt: Date.now(),
  };

  await Promise.all(Array.from(hosts).map(async (host) => {
    const key = `hawkeye_dom_mutations_${host}`;
    const stored = await chrome.storage.local.get(key);
    const existing: PersistedDomMutation[] = stored[key] ?? [];
    const next = [
      ...existing.filter((item) => item.id !== mutation.id),
      mutation,
    ].slice(-100);
    await chrome.storage.local.set({ [key]: next });
  }));
}

function stableMutationId(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args)}`;
}

async function sendToContent(tabId: number, message: unknown): Promise<any> {
  let res = await sendMessageToContent(tabId, message);
  if (res?.ok || res?.error !== 'No response from content script') return res;
  await injectConfiguredContentScripts(tabId);
  res = await sendMessageToContent(tabId, message);
  return res;
}

function sendMessageToContent(tabId: number, message: unknown): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      // Consume lastError to prevent "Unchecked runtime.lastError" when the
      // content script isn't present on the tab (chrome:// pages, PDFs, etc.)
      void chrome.runtime.lastError;
      resolve(res ?? { ok: false, error: 'No response from content script' });
    });
  });
}

async function injectConfiguredContentScripts(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const scripts = manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? [];
  if (scripts.length === 0) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: scripts });
  } catch {
    // The tab may be a restricted URL or may have navigated mid-replay.
  }
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') resolve();
        else setTimeout(check, 300);
      });
    };
    setTimeout(check, 500);
  });
}

/**
 * Execute a function inside the page context targeting a specific iframe.
 * Uses chrome.scripting.executeScript to run in the tab's main world, then
 * locates the iframe via iframeSelector and calls fn(iframeEl, ...extraArgs).
 */
async function execInIframe(
  tabId: number,
  iframeSelector: string,
  fn: (...args: unknown[]) => unknown,
  ...extraArgs: unknown[]
): Promise<any> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (iframeSel: string, fnStr: string, args: unknown[]) => {
        try {
          const iframeEl = document.querySelector(iframeSel);
          if (!iframeEl) return { ok: false, error: `iframe not found: ${iframeSel}` };
          // Reconstruct function from string and call it
          // eslint-disable-next-line no-new-func
          const fn = new Function('return ' + fnStr)();
          return fn(iframeEl, ...args);
        } catch (e: any) {
          return { ok: false, error: e.message };
        }
      },
      args: [iframeSelector, fn.toString(), extraArgs],
    });
    return results?.[0]?.result ?? { ok: false, error: 'No result from executeScript' };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Resolves the Chrome frameId for an iframe on the page, supporting cross-origin frames.
 * Uses chrome.webNavigation.getAllFrames to enumerate all frames regardless of origin.
 */
async function resolveFrameId(tabId: number, iframeSelector: string): Promise<number | null> {
  // Get the iframe's current src from the parent frame
  const srcRes = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLIFrameElement | null;
      if (!el) return null;
      return el.src || el.getAttribute('src') || null;
    },
    args: [iframeSelector],
  });
  const iframeSrc = srcRes?.[0]?.result as string | null;
  if (!iframeSrc) return null;

  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return null;

  // Match by exact URL or by URL prefix (iframe may redirect)
  const match = frames.find(
    (f) => f.url === iframeSrc || iframeSrc.startsWith(f.url) || f.url.startsWith(iframeSrc.split('?')[0])
  );
  return match?.frameId ?? null;
}

async function resolveRecordedFrameId(tabId: number, args: Record<string, unknown>): Promise<number | null> {
  const explicitFrameId = typeof args.frameId === 'number' ? args.frameId : null;
  const frameUrl = typeof args.frameUrl === 'string' ? args.frameUrl : null;
  if (explicitFrameId === null && !frameUrl) return null;

  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames) return explicitFrameId;

  if (explicitFrameId !== null && frames.some((f) => f.frameId === explicitFrameId)) {
    return explicitFrameId;
  }

  if (!frameUrl) return explicitFrameId;
  const normalized = frameUrl.split('#')[0];
  const match = frames.find((f) => {
    const candidate = f.url.split('#')[0];
    return candidate === normalized || candidate.startsWith(normalized) || normalized.startsWith(candidate);
  });
  return match?.frameId ?? explicitFrameId;
}

async function execInFrameId(
  tabId: number,
  frameId: number,
  func: (...args: any[]) => any,
  ...args: any[]
): Promise<any> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func,
      args,
    });
    return results?.[0]?.result ?? { ok: false, error: 'No result from frame executeScript' };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

/**
 * Execute a compiled function directly inside an iframe's frame context.
 * Works for both same-origin AND cross-origin iframes — no contentDocument needed.
 */
async function execInFrame(
  tabId: number,
  iframeSelector: string,
  func: (...args: any[]) => any,
  ...args: any[]
): Promise<any> {
  const frameId = await resolveFrameId(tabId, iframeSelector);
  if (frameId === null) {
    return { ok: false, error: `iframe not found or not yet loaded: ${iframeSelector}` };
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func,
      args,
    });
    return results?.[0]?.result ?? { ok: false, error: 'No result from frame executeScript' };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
