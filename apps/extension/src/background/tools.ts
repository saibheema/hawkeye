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
    description: 'Set one or more inline CSS properties directly on matched element(s). More targeted than insert_css — affects only those elements. Use a single styles object for compound requests like background + text color + border. Treat "boarder" as "border".',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for target element(s)' },
        property: { type: 'string', description: 'Optional single CSS property name in camelCase or kebab-case. Examples: "backgroundColor", "color", "fontSize", "border", "opacity", "display"' },
        value: { type: 'string', description: 'CSS value. Examples: "red", "24px", "none", "1px solid blue", "0.5"' },
        styles: {
          type: 'object',
          description: 'Multiple CSS styles to apply in one operation. Use color for text color, backgroundColor for background, border for visible borders.',
          properties: {
            color: { type: 'string', description: 'Text color, e.g. "white".' },
            backgroundColor: { type: 'string', description: 'Background color, e.g. "blue".' },
            background: { type: 'string', description: 'Background shorthand.' },
            border: { type: 'string', description: 'Visible border shorthand, e.g. "2px solid yellow". A bare color is accepted.' },
            borderColor: { type: 'string', description: 'Border color. Hawkeye will also ensure border width/style are visible.' },
            borderWidth: { type: 'string', description: 'Border width, e.g. "2px".' },
            borderStyle: { type: 'string', description: 'Border style, e.g. "solid".' },
            outline: { type: 'string', description: 'Outline shorthand.' },
            boxShadow: { type: 'string', description: 'Box shadow.' },
            fontSize: { type: 'string', description: 'Font size, e.g. "18px".' },
            fontWeight: { type: 'string', description: 'Font weight, e.g. "700" or "bold".' },
            opacity: { type: 'string', description: 'Opacity, e.g. "0.5".' },
            display: { type: 'string', description: 'Display value, e.g. "none" or "block".' },
          },
        },
      },
      required: ['selector'],
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
            border: { type: 'string', description: 'Visible border shorthand, e.g. "2px solid yellow". A bare color is accepted.' },
            borderColor: { type: 'string', description: 'Border color.' },
            borderWidth: { type: 'string', description: 'Border width, e.g. "2px".' },
            borderStyle: { type: 'string', description: 'Border style, e.g. "solid".' },
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
    description: 'Insert new HTML content relative to a target element. Use to add banners, badges, tooltips, buttons, form fields, text boxes, or any new DOM nodes without replacing existing content. Can target by selector or by nearby visible label text across page and iframes.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the reference element. Optional when label is provided.' },
        label: { type: 'string', description: 'Visible label/nearby text identifying the reference element, e.g. "Mileage". Used when selector is unknown.' },
        position: {
          type: 'string',
          enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'],
          description: 'Where to insert: beforebegin=before element, afterbegin=inside at start, beforeend=inside at end, afterend=after element',
        },
        html: { type: 'string', description: 'HTML string to insert. Example: "<span style=\'color:green\'>✓ Verified</span>"' },
      },
      required: ['position', 'html'],
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
  {
    name: 'replace_icon',
    description: 'Replace an icon-only button/control by accessible label, icon glyph, SVG title, or common icon name. Use for requests like "change + icon to X icon" or "change search icon to close".',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Icon to find, e.g. "+", "plus", "add", "search", "menu", "close".' },
        replacement: { type: 'string', description: 'Replacement icon text/glyph/label, e.g. "X", "×", "Close", "Search".' },
      },
      required: ['target', 'replacement'],
    },
  },
  {
    name: 'replace_selected_icon',
    description: 'Replace the icon inside one known selector. Use when the user picked an exact SVG/icon element and asks to change it to another icon. Preserves the existing icon box and fits the replacement inside it. For custom/non-standard icons, provide a simple safe SVG string generated by the LLM.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Exact CSS selector for the picked icon/SVG/control.' },
        replacement: { type: 'string', description: 'Replacement icon text/glyph/name, e.g. "X", "close", "search", "plus".' },
        svg: { type: 'string', description: 'Optional raw SVG markup for the replacement icon. Must be simple SVG with safe shapes/paths only; scripts/events are not allowed.' },
      },
      required: ['selector', 'replacement'],
    },
  },
  {
    name: 'set_background_image',
    description: 'Set a visual background image on matched element(s). Use when the user asks for a background image, pattern, illustration, texture, hero image, or generated backdrop. Gemini should generate a compact safe SVG and pass it as svg, or pass an existing URL/data URI as image.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for target element(s), e.g. "body", ".hero", or a picked selector.' },
        svg: { type: 'string', description: 'Optional raw SVG markup generated by the LLM for the background image.' },
        image: { type: 'string', description: 'Optional CSS image value, URL, or data URI. Used if svg is not provided.' },
        size: { type: 'string', description: 'background-size value. Default: "cover".' },
        position: { type: 'string', description: 'background-position value. Default: "center".' },
        repeat: { type: 'string', description: 'background-repeat value. Default: "no-repeat".' },
      },
      required: ['selector'],
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
              await performReplayClick(el);
              await ensureSelectedState(el, o);
              return { ok: true };
              async function performReplayClick(el: HTMLElement) {
                el.scrollIntoView?.({ block: 'center', inline: 'center' });
                await new Promise((resolve) => setTimeout(resolve, 40));
                const rect = el.getBoundingClientRect();
                const clientX = Math.max(0, Math.round(rect.left + rect.width / 2));
                const clientY = Math.max(0, Math.round(rect.top + rect.height / 2));
                for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
                  const EventCtor = eventName.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
                  el.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
                }
                el.click();
              }
              async function ensureSelectedState(el: HTMLElement, payload: Record<string, any>) {
                if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
                  const expected = payload.checked === false ? false : true;
                  const deadline = Date.now() + 600;
                  while (el.isConnected && el.checked !== expected && Date.now() < deadline) {
                    await performReplayClick(el);
                    await new Promise((resolve) => setTimeout(resolve, 80));
                  }
                  return;
                }
                if (payload.clickKind !== 'selectable') return;
                const deadline = Date.now() + 600;
                while (el.isConnected && selectedState(el) === false && Date.now() < deadline) {
                  await performReplayClick(el);
                  await new Promise((resolve) => setTimeout(resolve, 80));
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
              function findReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                if (kind === 'click') {
                  const choice = findChoiceElement(payload);
                  if (choice) return choice;
                  const semantic = findRecordedClickElement(payload);
                  if (semantic) return semantic;
                }
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
                const selector = kind === 'click' ? 'button,a,summary,[role="button"],[role="option"],[role="checkbox"],[role="radio"],input[type="button"],input[type="submit"],input[type="reset"],input[type="radio"],input[type="checkbox"],label,[onclick],[jsaction],[aria-expanded],[aria-controls],[data-href],[data-url],[tabindex],[class*="btn" i],[class*="button" i],[class*="link" i],[class*="chip" i]' : kind === 'select' ? 'select' : 'input:not([type="hidden"]),textarea';
                const elements = Array.from(document.querySelectorAll(selector));
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => matchesKind(el, kind) && normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function findRecordedClickElement(payload: Record<string, any>): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
                const needles = [payload.label, payload.text, ...candidates.filter((c: any) => ['label', 'text', 'aria'].includes(c.type)).map((c: any) => c.value)]
                  .map((value: any) => normalize(String(value ?? '')))
                  .filter((value: string) => value.length > 0);
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
                for (const needle of needles.filter((value: string) => value.length > 2)) {
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
              function findChoiceElement(payload: Record<string, any>): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
                const inputType = String(payload.inputType ?? candidates.find((c: any) => c.inputType)?.inputType ?? '').toLowerCase();
                const selectorText = String(payload.selector ?? '').toLowerCase();
                const isChoice = inputType === 'radio' || inputType === 'checkbox' || /input\[type=["']?(?:radio|checkbox)/.test(selectorText);
                if (!isChoice) return null;
                const elements = Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
                const labelNeedles = [payload.label, ...candidates.filter((c: any) => ['label', 'text', 'aria'].includes(c.type)).map((c: any) => c.value)]
                  .map((value: any) => normalize(String(value ?? '')))
                  .filter(Boolean);
                for (const needle of labelNeedles) {
                  const exact = elements.find((el) => normalize([labelFor(el), textFor(el), attrText(el)].filter(Boolean).join(' ')) === needle);
                  if (exact) return exact;
                }
                for (const needle of labelNeedles) {
                  const match = elements.find((el) => normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).value, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                const desiredValue = normalize(String(payload.value ?? ''));
                if (desiredValue && desiredValue !== 'on') {
                  const valueMatch = elements.find((el) => el instanceof HTMLInputElement && normalize(el.value) === desiredValue);
                  if (valueMatch) return valueMatch;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                parts.push(el.getAttribute('aria-label') ?? '');
                parts.push((el as HTMLInputElement).placeholder ?? '');
                parts.push((el.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.previousElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.parentElement as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.closest('[role="radio"],[role="checkbox"],[role="option"],[role="button"],li,fieldset,div') as HTMLElement | null)?.innerText?.trim() ?? '');
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
                const deadline = Date.now() + 12000;
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
              await performReplayClick(el);
              await ensureSelectedState(el, o);
              return { ok: true };
              async function performReplayClick(el: HTMLElement) {
                el.scrollIntoView?.({ block: 'center', inline: 'center' });
                await new Promise((resolve) => setTimeout(resolve, 40));
                const rect = el.getBoundingClientRect();
                const clientX = Math.max(0, Math.round(rect.left + rect.width / 2));
                const clientY = Math.max(0, Math.round(rect.top + rect.height / 2));
                for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
                  const EventCtor = eventName.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
                  el.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
                }
                el.click();
              }
              async function ensureSelectedState(el: HTMLElement, payload: Record<string, any>) {
                if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
                  const expected = payload.checked === false ? false : true;
                  const deadline = Date.now() + 600;
                  while (el.isConnected && el.checked !== expected && Date.now() < deadline) {
                    await performReplayClick(el);
                    await new Promise((resolve) => setTimeout(resolve, 80));
                  }
                  return;
                }
                if (payload.clickKind !== 'selectable') return;
                const deadline = Date.now() + 600;
                while (el.isConnected && selectedState(el) === false && Date.now() < deadline) {
                  await performReplayClick(el);
                  await new Promise((resolve) => setTimeout(resolve, 80));
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
              function findReplayElement(payload: Record<string, any>, kind: 'click' | 'type' | 'select'): Element | null {
                if (kind === 'click') {
                  const choice = findChoiceElement(payload);
                  if (choice) return choice;
                  const semantic = findRecordedClickElement(payload);
                  if (semantic) return semantic;
                }
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
                const selector = kind === 'click' ? 'button,a,summary,[role="button"],[role="option"],[role="checkbox"],[role="radio"],input[type="button"],input[type="submit"],input[type="reset"],input[type="radio"],input[type="checkbox"],label,[onclick],[jsaction],[aria-expanded],[aria-controls],[data-href],[data-url],[tabindex],[class*="btn" i],[class*="button" i],[class*="link" i],[class*="chip" i]' : kind === 'select' ? 'select' : 'input:not([type="hidden"]),textarea';
                const elements = Array.from(document.querySelectorAll(selector));
                for (const candidate of candidates) {
                  const needle = normalize(candidate.value || '');
                  const match = elements.find((el) => matchesKind(el, kind) && normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                return null;
              }
              function findRecordedClickElement(payload: Record<string, any>): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
                const needles = [payload.label, payload.text, ...candidates.filter((c: any) => ['label', 'text', 'aria'].includes(c.type)).map((c: any) => c.value)]
                  .map((value: any) => normalize(String(value ?? '')))
                  .filter((value: string) => value.length > 0);
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
                for (const needle of needles.filter((value: string) => value.length > 2)) {
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
              function findChoiceElement(payload: Record<string, any>): Element | null {
                const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
                const inputType = String(payload.inputType ?? candidates.find((c: any) => c.inputType)?.inputType ?? '').toLowerCase();
                const selectorText = String(payload.selector ?? '').toLowerCase();
                const isChoice = inputType === 'radio' || inputType === 'checkbox' || /input\[type=["']?(?:radio|checkbox)/.test(selectorText);
                if (!isChoice) return null;
                const elements = Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
                const labelNeedles = [payload.label, ...candidates.filter((c: any) => ['label', 'text', 'aria'].includes(c.type)).map((c: any) => c.value)]
                  .map((value: any) => normalize(String(value ?? '')))
                  .filter(Boolean);
                for (const needle of labelNeedles) {
                  const exact = elements.find((el) => normalize([labelFor(el), textFor(el), attrText(el)].filter(Boolean).join(' ')) === needle);
                  if (exact) return exact;
                }
                for (const needle of labelNeedles) {
                  const match = elements.find((el) => normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).value, el.id].filter(Boolean).join(' ')).includes(needle));
                  if (match) return match;
                }
                const desiredValue = normalize(String(payload.value ?? ''));
                if (desiredValue && desiredValue !== 'on') {
                  const valueMatch = elements.find((el) => el instanceof HTMLInputElement && normalize(el.value) === desiredValue);
                  if (valueMatch) return valueMatch;
                }
                return null;
              }
              function labelFor(el: Element) {
                const parts: string[] = [];
                if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
                parts.push(el.closest('label')?.textContent?.trim() ?? '');
                parts.push(el.getAttribute('aria-label') ?? '');
                parts.push((el as HTMLInputElement).placeholder ?? '');
                parts.push((el.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.previousElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.parentElement as HTMLElement | null)?.innerText?.trim() ?? '');
                parts.push((el.closest('[role="radio"],[role="checkbox"],[role="option"],[role="button"],li,fieldset,div') as HTMLElement | null)?.innerText?.trim() ?? '');
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
                const deadline = Date.now() + 12000;
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
                const deadline = Date.now() + 12000;
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
                const deadline = Date.now() + 12000;
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
              return await selectNativeOption(el, String(o.value ?? ''));
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
              function findOption(select: HTMLSelectElement, desiredValue: string): HTMLOptionElement | null {
                const desired = normalize(desiredValue);
                return Array.from(select.options).find((option) =>
                  option.value === desiredValue
                  || normalize(option.textContent ?? '') === desired
                  || normalize(option.label) === desired
                ) ?? null;
              }
              async function waitForOption(select: HTMLSelectElement, desiredValue: string) {
                const deadline = Date.now() + 10000;
                let option = findOption(select, desiredValue);
                while (!option && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 150));
                  option = findOption(select, desiredValue);
                }
                return option;
              }
              async function selectNativeOption(select: HTMLSelectElement, desiredValue: string) {
                const option = await waitForOption(select, desiredValue);
                if (!option) return { ok: false, error: `Option not found in frame for ${o.selector}: ${desiredValue}` };
                const value = option.value;
                const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                if (setter) setter.call(select, value);
                else select.value = value;
                option.selected = true;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (select.value !== value) return { ok: false, error: `Select value did not stick in frame for ${o.selector}: expected ${value}, got ${select.value}` };
                return { ok: true, value };
              }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 12000;
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
              return await selectNativeOption(el, String(o.value ?? ''));
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
              function findOption(select: HTMLSelectElement, desiredValue: string): HTMLOptionElement | null {
                const desired = normalize(desiredValue);
                return Array.from(select.options).find((option) =>
                  option.value === desiredValue
                  || normalize(option.textContent ?? '') === desired
                  || normalize(option.label) === desired
                ) ?? null;
              }
              async function waitForOption(select: HTMLSelectElement, desiredValue: string) {
                const deadline = Date.now() + 10000;
                let option = findOption(select, desiredValue);
                while (!option && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 150));
                  option = findOption(select, desiredValue);
                }
                return option;
              }
              async function selectNativeOption(select: HTMLSelectElement, desiredValue: string) {
                const option = await waitForOption(select, desiredValue);
                if (!option) return { ok: false, error: `Option not found in iframe for ${o.selector}: ${desiredValue}` };
                const value = option.value;
                const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                if (setter) setter.call(select, value);
                else select.value = value;
                option.selected = true;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (select.value !== value) return { ok: false, error: `Select value did not stick in iframe for ${o.selector}: expected ${value}, got ${select.value}` };
                return { ok: true, value };
              }
              async function waitForReplayElement(payload: Record<string, any>) {
                const deadline = Date.now() + 12000;
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

      case 'verify_replay_step': {
        type VerifyArgs = { stepTool: string; stepArgs: Record<string, any> };
        const a = args as unknown as VerifyArgs;
        const verifyInPage = (o: VerifyArgs) => {
          const payload = o.stepArgs ?? {};
          const stepTool = String(o.stepTool ?? '');
          const kind = stepTool === 'select_option' ? 'select' : stepTool === 'type_text' ? 'type' : 'click';
          const el = findReplayElement(payload, kind);
          if (!el) return { ok: true as const, found: false, verified: false, reason: 'target not found' };

          if (stepTool === 'type_text') {
            const value = (el as HTMLInputElement | HTMLTextAreaElement).value ?? '';
            const expected = String(payload.text ?? '');
            const verified = sameReplayValue(value, expected);
            return { ok: true as const, found: true, verified, reason: verified ? undefined : 'text value mismatch' };
          }

          if (stepTool === 'select_option') {
            const select = el as HTMLSelectElement;
            const expected = normalize(String(payload.value ?? ''));
            const selected = normalize(select.value);
            const selectedText = normalize(select.selectedOptions?.[0]?.textContent ?? '');
            const verified = selected === expected || selectedText === expected;
            return { ok: true as const, found: true, verified, reason: verified ? undefined : 'select value mismatch' };
          }

          if (stepTool === 'click') {
            if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
              const expected = payload.checked === false ? false : true;
              return { ok: true as const, found: true, verified: el.checked === expected, reason: el.checked === expected ? undefined : 'choice not selected' };
            }
            if (payload.clickKind === 'selectable') {
              const state = selectedState(el as HTMLElement);
              return { ok: true as const, found: true, verified: state !== false, observable: state !== null, reason: state === false ? 'tile not selected' : undefined };
            }
          }

          return { ok: true as const, found: true, verified: true };

          function findReplayElement(payload: Record<string, any>, targetKind: 'click' | 'type' | 'select'): Element | null {
            if (targetKind === 'click') {
              const choice = findChoiceElement(payload);
              if (choice) return choice;
              const semantic = findRecordedClickElement(payload);
              if (semantic) return semantic;
            }
            const selectors = [
              payload.selector,
              ...((Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [])
                .filter((candidate: any) => candidate.type === 'css')
                .map((candidate: any) => candidate.selector || candidate.value)),
            ].filter(Boolean);
            for (const selector of selectors) {
              try {
                const candidate = document.querySelector(selector);
                if (candidate && matchesKind(candidate, targetKind)) return candidate;
              } catch {}
            }
            const semanticCandidates = (Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : []).filter((candidate: any) => candidate.type !== 'css');
            for (const candidate of semanticCandidates) {
              const match = findBySemanticCandidate(candidate, targetKind);
              if (match) return match;
            }
            return null;
          }
          function matchesKind(el: Element, targetKind: 'click' | 'type' | 'select') {
            if (targetKind === 'select') return el instanceof HTMLSelectElement;
            if (targetKind === 'type') return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
            return el instanceof HTMLElement;
          }
          function findChoiceElement(payload: Record<string, any>): Element | null {
            const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
            const inputType = String(payload.inputType ?? candidates.find((candidate: any) => candidate.inputType)?.inputType ?? '').toLowerCase();
            const selectorText = String(payload.selector ?? '').toLowerCase();
            const isChoice = inputType === 'radio' || inputType === 'checkbox' || /input\[type=["']?(?:radio|checkbox)/.test(selectorText);
            if (!isChoice) return null;
            const elements = Array.from(document.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]'));
            const labelNeedles = [payload.label, ...candidates.filter((candidate: any) => ['label', 'text', 'aria'].includes(candidate.type)).map((candidate: any) => candidate.value)]
              .map((value: any) => normalize(String(value ?? '')))
              .filter(Boolean);
            for (const needle of labelNeedles) {
              const exact = elements.find((node) => normalize([labelFor(node), textFor(node), attrText(node)].filter(Boolean).join(' ')) === needle);
              if (exact) return exact;
            }
            for (const needle of labelNeedles) {
              const match = elements.find((node) => normalize([labelFor(node), textFor(node), attrText(node), (node as HTMLInputElement).value, node.id].filter(Boolean).join(' ')).includes(needle));
              if (match) return match;
            }
            const desiredValue = normalize(String(payload.value ?? ''));
            if (desiredValue && desiredValue !== 'on') {
              const valueMatch = elements.find((node) => node instanceof HTMLInputElement && normalize(node.value) === desiredValue);
              if (valueMatch) return valueMatch;
            }
            return null;
          }
          function findRecordedClickElement(payload: Record<string, any>): Element | null {
            const candidates = Array.isArray(payload.locatorCandidates) ? payload.locatorCandidates : [];
            const needles = [payload.label, payload.text, ...candidates.filter((candidate: any) => ['label', 'text', 'aria'].includes(candidate.type)).map((candidate: any) => candidate.value)]
              .map((value: any) => normalize(String(value ?? '')))
              .filter((value: string) => value.length > 0);
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
              .map((node) => ({ el: node, text: normalize([labelFor(node), textFor(node), attrText(node)].filter(Boolean).join(' ')) }))
              .filter((item) => item.text);
            for (const needle of needles) {
              const exact = ranked.filter((item) => item.text === needle).sort((x, y) => x.text.length - y.text.length)[0];
              if (exact) return exact.el;
            }
            for (const needle of needles.filter((value: string) => value.length > 2)) {
              const contains = ranked.filter((item) => item.text.includes(needle)).sort((x, y) => x.text.length - y.text.length)[0];
              if (contains) return contains.el;
            }
            return null;
          }
          function findBySemanticCandidate(candidate: any, targetKind: 'click' | 'type' | 'select'): Element | null {
            const value = normalize(String(candidate.value ?? ''));
            if (!value) return null;
            const selector = targetKind === 'click'
              ? 'button,a,summary,[role="button"],[role="option"],[role="checkbox"],[role="radio"],input[type="button"],input[type="submit"],input[type="reset"],input[type="radio"],input[type="checkbox"],label,[onclick],[jsaction],[aria-expanded],[aria-controls],[data-href],[data-url],[tabindex],[class*="btn" i],[class*="button" i],[class*="link" i],[class*="chip" i]'
              : targetKind === 'select'
                ? 'select'
                : 'input:not([type="hidden"]),textarea';
            const elements = Array.from(document.querySelectorAll(selector)).filter((node) => matchesKind(node, targetKind));
            const exact = elements.find((node) => normalize(labelFor(node)) === value || normalize(textFor(node)) === value || normalize(attrText(node)) === value);
            if (exact) return exact;
            return elements.find((node) => normalize([labelFor(node), textFor(node), attrText(node), (node as HTMLInputElement).name, node.id].filter(Boolean).join(' ')).includes(value)) ?? null;
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
          function isUsableClickTarget(el: Element): boolean {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
            return true;
          }
          function labelFor(el: Element) {
            const parts: string[] = [];
            if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
            parts.push(el.closest('label')?.textContent?.trim() ?? '');
            parts.push(el.getAttribute('aria-label') ?? '');
            parts.push((el as HTMLInputElement).placeholder ?? '');
            parts.push((el.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
            parts.push((el.previousElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
            parts.push((el.parentElement as HTMLElement | null)?.innerText?.trim() ?? '');
            parts.push((el.closest('[role="radio"],[role="checkbox"],[role="option"],[role="button"],li,fieldset,div') as HTMLElement | null)?.innerText?.trim() ?? '');
            return parts.filter(Boolean).join(' ');
          }
          function textFor(el: Element) {
            if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return el.value;
            return el.textContent ?? '';
          }
          function attrText(el: Element) {
            return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('role')].filter(Boolean).join(' ');
          }
          function sameReplayValue(actual: string, expected: string) {
            if (actual === expected) return true;
            if (normalize(actual) === normalize(expected)) return true;
            const actualDigits = actual.replace(/\D/g, '');
            const expectedDigits = expected.replace(/\D/g, '');
            return actualDigits.length > 0 && actualDigits === expectedDigits;
          }
          function normalize(value: string) { return value.replace(/\s+/g, ' ').trim().toLowerCase(); }
        };

        const frameId = await resolveRecordedFrameId(tabId, a.stepArgs ?? {});
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId, verifyInPage, a);
          return res.ok ? { ok: true, data: res } : res;
        }
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: verifyInPage,
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const verified = res.some((frameResult) => (frameResult.result as any)?.verified === true);
        if (verified) return { ok: true, data: { verified: true, found: true } };
        const foundUnverified = res.find((frameResult) => (frameResult.result as any)?.found);
        if (foundUnverified?.result) return { ok: true, data: foundUnverified.result };
        return { ok: true, data: { verified: false, found: false, reason: 'target not found' } };
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
        type SetStyleArgs = { selector: string; property?: string; value?: string; styles?: Record<string, string> };
        const a = args as unknown as SetStyleArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: SetStyleArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector)) as HTMLElement[];
            const styles = styleEntries(o);
            if (styles.length === 0) return { ok: false, error: 'No style property/value provided' };
            for (const el of els) applyStyles(el, styles);
            return { ok: true, count: els.length, frameUrl: location.href, styles };

            function styleEntries(payload: SetStyleArgs): Array<[string, string]> {
              const entries: Array<[string, string]> = [];
              if (payload.styles && typeof payload.styles === 'object') {
                for (const [key, value] of Object.entries(payload.styles)) {
                  if (value !== undefined && value !== null && String(value).trim()) entries.push([key, String(value)]);
                }
              }
              if (payload.property && payload.value !== undefined && payload.value !== null) {
                entries.push([payload.property, String(payload.value)]);
              }
              return normalizeEntries(entries);
            }
            function normalizeEntries(entries: Array<[string, string]>): Array<[string, string]> {
              const out: Array<[string, string]> = [];
              const names = new Set(entries.map(([key]) => normalizeProp(key)));
              for (const [rawProp, rawValue] of entries) {
                const prop = normalizeProp(rawProp);
                let value = rawValue;
                if (prop === 'border' && looksLikeColor(value)) value = `2px solid ${value}`;
                out.push([prop, value]);
                if (prop === 'border-color' && !names.has('border-style')) out.push(['border-style', 'solid']);
                if (prop === 'border-color' && !names.has('border-width')) out.push(['border-width', '2px']);
              }
              return out;
            }
            function normalizeProp(prop: string): string {
              const compact = String(prop).trim()
                .replace(/\s+/g, '-')
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .toLowerCase();
              const aliases: Record<string, string> = {
                bg: 'background-color',
                backgroundcolour: 'background-color',
                backgroundcolor: 'background-color',
                'background-colour': 'background-color',
                text: 'color',
                'text-color': 'color',
                textcolor: 'color',
                fontcolor: 'color',
                'font-color': 'color',
                boarder: 'border',
                'boarder-color': 'border-color',
                boardercolor: 'border-color',
              };
              return aliases[compact] ?? compact;
            }
            function looksLikeColor(value: string): boolean {
              const v = value.trim();
              return /^#[0-9a-f]{3,8}$/i.test(v)
                || /^rgba?\(/i.test(v)
                || /^hsla?\(/i.test(v)
                || /^[a-z]+$/i.test(v);
            }
            function applyStyles(el: HTMLElement, stylesToApply: Array<[string, string]>) {
              for (const [prop, value] of stylesToApply) {
                el.style.setProperty(prop, value, 'important');
              }
            }
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
        type InsertHtmlArgs = { selector?: string; label?: string; position: InsertPosition; html: string };
        const a = args as unknown as InsertHtmlArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: InsertHtmlArgs) => {
            const id = stableInsertId(o);
            if (document.querySelector(`[data-hawkeye-insert="${CSS.escape(id)}"]`)) {
              return { ok: true as const, count: 1, frameUrl: location.href, skippedDuplicate: true };
            }
            const els = findTargets(o);
            for (const el of els) insertMarkedHtml(el, o.position, o.html, id);
            return { ok: true as const, count: els.length, frameUrl: location.href };

            function findTargets(payload: InsertHtmlArgs): Element[] {
              const selector = String(payload.selector ?? '').trim();
              if (selector) {
                try {
                  const matches = Array.from(document.querySelectorAll(selector));
                  if (matches.length > 0) return matches;
                } catch {}
              }
              const needle = normalize(String(payload.label ?? ''));
              if (!needle) return [];
              const candidates = Array.from(document.querySelectorAll([
                'input:not([type="hidden"])',
                'textarea',
                'select',
                'button',
                'label',
                '[aria-label]',
                '[placeholder]',
                '[name]',
                '[id]',
                '[role="button"]',
                '[role="textbox"]',
                '[role="combobox"]',
              ].join(','))).filter((el) => el instanceof HTMLElement);
              const ranked = candidates
                .map((el) => ({ el, text: normalize([labelFor(el), textFor(el), attrText(el), (el as HTMLInputElement).name, el.id].filter(Boolean).join(' ')) }))
                .filter((item) => item.text);
              const exact = ranked.find((item) => item.text === needle);
              if (exact) return [referenceTarget(exact.el)];
              const contains = ranked
                .filter((item) => item.text.includes(needle))
                .sort((a, b) => a.text.length - b.text.length)[0];
              return contains ? [referenceTarget(contains.el)] : [];
            }

            function referenceTarget(el: Element): Element {
              if (el instanceof HTMLLabelElement && el.htmlFor) {
                const input = document.getElementById(el.htmlFor);
                if (input) return input;
              }
              return el;
            }

            function insertMarkedHtml(target: Element, position: InsertPosition, html: string, id: string) {
              const template = document.createElement('template');
              template.innerHTML = html;
              const nodes = Array.from(template.content.childNodes);
              if (nodes.length === 0) return;
              for (const node of nodes) {
                if (node instanceof Element) node.setAttribute('data-hawkeye-insert', id);
              }
              const fragment = document.createDocumentFragment();
              for (const node of nodes) fragment.appendChild(node);
              switch (position) {
                case 'beforebegin':
                  target.parentNode?.insertBefore(fragment, target);
                  break;
                case 'afterbegin':
                  target.insertBefore(fragment, target.firstChild);
                  break;
                case 'beforeend':
                  target.appendChild(fragment);
                  break;
                case 'afterend':
                  target.parentNode?.insertBefore(fragment, target.nextSibling);
                  break;
              }
            }

            function stableInsertId(payload: InsertHtmlArgs): string {
              const value = [payload.selector, payload.label, payload.position, payload.html].filter(Boolean).join('|');
              let hash = 0;
              for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
              return `insert_${Math.abs(hash)}`;
            }

            function labelFor(el: Element) {
              const parts: string[] = [];
              if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim() ?? '');
              parts.push(el.closest('label')?.textContent?.trim() ?? '');
              parts.push((el.previousElementSibling as HTMLElement | null)?.innerText?.trim() ?? '');
              parts.push((el.parentElement as HTMLElement | null)?.innerText?.trim() ?? '');
              return parts.filter(Boolean).join(' ');
            }

            function textFor(el: Element) {
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return '';
              return (el as HTMLElement).innerText ?? el.textContent ?? '';
            }

            function attrText(el: Element) {
              return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('role')].filter(Boolean).join(' ');
            }

            function normalize(value: string) {
              return value.replace(/\s+/g, ' ').trim().toLowerCase();
            }
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const insertedCount = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (insertedCount === 0) return { ok: false, error: `No elements match selector or label: ${a.selector ?? a.label ?? ''}` };
        await persistDomMutation(tabId, 'insert_html', a as unknown as Record<string, unknown>, res);
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
              && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)
              && !!(el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).form;
            if ((o.event === 'submit' && el instanceof HTMLFormElement && !evt.defaultPrevented) || (isEnterSubmit && !evt.defaultPrevented)) {
              const form = el instanceof HTMLFormElement ? el : (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).form;
              if (form?.isConnected) {
                if (typeof form.requestSubmit === 'function') form.requestSubmit();
                else form.submit();
              }
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
            const deadline = Date.now() + 12000;
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
              for (const [property, value] of normalizeStyleEntries(Object.entries(o.styles))) {
                el.style.setProperty(property, value, 'important');
              }
              count++;
              if (o.elementKind !== 'button') break;
            }
            return { ok: true as const, count, frameUrl: location.href };
            function normalizeStyleEntries(entries: Array<[string, string]>): Array<[string, string]> {
              const out: Array<[string, string]> = [];
              const names = new Set(entries.map(([key]) => normalizeStyleProp(key)));
              for (const [rawProp, rawValue] of entries) {
                const prop = normalizeStyleProp(rawProp);
                let value = rawValue;
                if (prop === 'border' && looksLikeColor(value)) value = `2px solid ${value}`;
                out.push([prop, value]);
                if (prop === 'border-color' && !names.has('border-style')) out.push(['border-style', 'solid']);
                if (prop === 'border-color' && !names.has('border-width')) out.push(['border-width', '2px']);
              }
              return out;
            }
            function normalizeStyleProp(prop: string): string {
              const compact = String(prop).trim()
                .replace(/\s+/g, '-')
                .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                .toLowerCase();
              const aliases: Record<string, string> = {
                bg: 'background-color',
                backgroundcolor: 'background-color',
                text: 'color',
                'text-color': 'color',
                textcolor: 'color',
                boarder: 'border',
                'boarder-color': 'border-color',
                boardercolor: 'border-color',
              };
              return aliases[compact] ?? compact;
            }
            function looksLikeColor(value: string): boolean {
              const v = value.trim();
              return /^#[0-9a-f]{3,8}$/i.test(v)
                || /^rgba?\(/i.test(v)
                || /^hsla?\(/i.test(v)
                || /^[a-z]+$/i.test(v);
            }
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

      case 'replace_icon': {
        type ReplaceIconArgs = { target: string; replacement: string };
        const a = args as unknown as ReplaceIconArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: ReplaceIconArgs) => {
            const target = normalizeIconText(o.target);
            const replacement = cleanReplacement(o.replacement);
            if (!target || !replacement) return { ok: true as const, count: 0, frameUrl: location.href };
            let count = 0;

            const candidates = Array.from(document.querySelectorAll([
              'button',
              'a',
              '[role="button"]',
              '[role="link"]',
              'input[type="button"]',
              'input[type="submit"]',
              '[aria-label]',
              '[title]',
              '[data-icon]',
              '[jsaction]',
              'svg',
              'i',
              'span',
            ].join(',')));

            for (const candidate of candidates) {
              const control = iconControl(candidate);
              if (!control || control.dataset.hawkeyeIconReplaced === replacement) continue;
              if (!isSafeIconTarget(control, candidate)) continue;
              const labels = iconLabels(candidate, control).map(normalizeIconText).filter(Boolean);
              if (!labels.some((label) => iconMatches(label, target))) continue;
              replaceControlIcon(control, replacement);
              count++;
            }

            return { ok: true as const, count, frameUrl: location.href };

            function iconControl(el: Element): HTMLElement | null {
              if (el instanceof SVGElement) {
                return el.closest('button,a,[role="button"],[role="link"],[aria-label],[title],[jsaction]') as HTMLElement | null ?? el as unknown as HTMLElement;
              }
              if (!(el instanceof HTMLElement)) return null;
              return el.closest('button,a,[role="button"],[role="link"],input[type="button"],input[type="submit"]') as HTMLElement | null ?? el;
            }

            function isSafeIconTarget(control: HTMLElement, source: Element): boolean {
              const rect = control.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              const tag = control.tagName.toLowerCase();
              const role = control.getAttribute('role')?.toLowerCase() ?? '';
              const isExplicitControl = ['button', 'a', 'input'].includes(tag) || ['button', 'link'].includes(role);
              const isIconSource = source instanceof SVGElement || ['svg', 'i'].includes(source.tagName.toLowerCase());
              const text = control instanceof HTMLInputElement
                ? control.value.trim()
                : (control.innerText || control.textContent || '').replace(/\s+/g, ' ').trim();
              const childCount = control.querySelectorAll('*').length;
              const hasIconChild = !!control.querySelector('svg,i,[data-icon],[aria-hidden="true"]');

              if (isExplicitControl) {
                if (control instanceof HTMLInputElement && text.length > 3) return false;
                if (!hasIconChild && text.length > 24) return false;
                return rect.width <= 160 && rect.height <= 120 && text.length <= 80 && childCount <= 12;
              }
              if (isIconSource) {
                return rect.width <= 120 && rect.height <= 120 && text.length <= 40 && childCount <= 8;
              }
              const style = window.getComputedStyle(control);
              const hasIconSignal = control.hasAttribute('aria-label')
                || control.hasAttribute('title')
                || control.hasAttribute('data-icon')
                || control.hasAttribute('jsaction')
                || style.cursor === 'pointer';
              return hasIconSignal && rect.width <= 96 && rect.height <= 96 && text.length <= 24 && childCount <= 6;
            }

            function iconLabels(source: Element, control: HTMLElement): string[] {
              const svgTitles = Array.from(control.querySelectorAll('svg title')).map((title) => title.textContent ?? '');
              const useHrefs = Array.from(control.querySelectorAll('use')).map((use) => use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '');
              return [
                source instanceof HTMLElement ? source.innerText : '',
                source.textContent,
                control.innerText,
                control.textContent,
                source.getAttribute('aria-label'),
                source.getAttribute('title'),
                source.getAttribute('data-icon'),
                source.getAttribute('data-testid'),
                source.getAttribute('class'),
                source.id,
                control.getAttribute('aria-label'),
                control.getAttribute('title'),
                control.getAttribute('data-icon'),
                control.getAttribute('data-testid'),
                control.getAttribute('class'),
                control.id,
                ...svgTitles,
                ...useHrefs,
              ].filter((value): value is string => !!value);
            }

            function replaceControlIcon(control: HTMLElement, value: string) {
              const display = displayIcon(value);
              control.dataset.hawkeyeIconReplaced = value;
              control.setAttribute('aria-label', value);
              control.setAttribute('title', value);
              if (control instanceof HTMLInputElement) {
                control.value = display;
                return;
              }
              control.replaceChildren();
              const span = document.createElement('span');
              span.dataset.hawkeyeIconReplacement = 'true';
              span.textContent = display;
              span.style.display = 'inline-flex';
              span.style.alignItems = 'center';
              span.style.justifyContent = 'center';
              span.style.width = '100%';
              span.style.height = '100%';
              span.style.font = 'inherit';
              span.style.fontWeight = '700';
              span.style.lineHeight = '1';
              control.appendChild(span);
            }

            function iconMatches(label: string, wanted: string): boolean {
              if (!label || !wanted) return false;
              const wantedAliases = aliasesFor(wanted);
              const labelAliases = aliasesFor(label);
              if (wantedAliases.some((alias) => aliasMatches(label, alias) || labelAliases.includes(alias))) return true;
              if (wantedAliases.includes('+') && /\+/.test(label)) return true;
              return false;
            }

            function aliasMatches(label: string, alias: string): boolean {
              if (label === alias) return true;
              if (alias === '+') return /\+/.test(label);
              if (alias.length < 3) return false;
              return ` ${label} `.includes(` ${alias} `);
            }

            function aliasesFor(value: string): string[] {
              const normalized = normalizeIconText(value);
              const aliases: Record<string, string[]> = {
                '+': ['+', 'plus', 'add'],
                plus: ['+', 'plus', 'add'],
                add: ['+', 'plus', 'add'],
                new: ['new', 'create', 'add'],
                create: ['create', 'new', 'add'],
                x: ['x', '×', 'close', 'clear', 'remove', 'dismiss'],
                '×': ['x', '×', 'close', 'clear', 'remove', 'dismiss'],
                close: ['x', '×', 'close', 'clear', 'remove', 'dismiss'],
                search: ['search', 'magnify', 'magnifying glass'],
                menu: ['menu', 'hamburger'],
              };
              return Array.from(new Set([normalized, ...(aliases[normalized] ?? [])].filter(Boolean)));
            }

            function displayIcon(value: string): string {
              const cleaned = cleanReplacement(value);
              if (normalizeIconText(cleaned) === 'close') return '×';
              return cleaned;
            }

            function cleanReplacement(value: string): string {
              return String(value ?? '')
                .replace(/\bicon\b/gi, '')
                .replace(/\blike\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            }

            function normalizeIconText(value: string): string {
              return String(value ?? '')
                .replace(/[_-]+/g, ' ')
                .replace(/\b(?:icon|button|btn|symbol)\b/gi, '')
                .replace(/[#"'.]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            }
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No icon matched: ${a.target}` };
        await persistDomMutation(tabId, 'replace_icon', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
      }

      case 'replace_selected_icon': {
        type ReplaceSelectedIconArgs = { selector: string; replacement: string; svg?: string };
        const a = args as unknown as ReplaceSelectedIconArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: ReplaceSelectedIconArgs) => {
            const replacement = cleanReplacement(o.replacement);
            if (!o.selector || !replacement) return { ok: true as const, count: 0, frameUrl: location.href };
            const replacementSvg = sanitizeSvg(o.svg);
            const targets = Array.from(document.querySelectorAll(o.selector));
            let count = 0;

            for (const target of targets) {
              if (target instanceof SVGElement) {
                const svg = target.tagName.toLowerCase() === 'svg' ? target : target.ownerSVGElement;
                if (!svg) continue;
                renderSvgIcon(svg, replacement, replacementSvg);
                labelControl(svg, replacement);
                count++;
                continue;
              }

              if (!(target instanceof HTMLElement)) continue;
              const svg = target.querySelector('svg');
              if (svg instanceof SVGElement) {
                renderSvgIcon(svg, replacement, replacementSvg);
                labelControl(target, replacement);
                count++;
                continue;
              }

              replaceControlIcon(target, replacement);
              count++;
            }

            return { ok: true as const, count, frameUrl: location.href };

            function labelControl(el: Element, value: string) {
              const control = el.closest('button,a,[role="button"],[role="link"],[aria-label],[title],[jsaction]') as HTMLElement | null;
              const labelTarget = control ?? (el instanceof HTMLElement ? el : null);
              if (!labelTarget) return;
              labelTarget.dataset.hawkeyeIconReplaced = value;
              labelTarget.setAttribute('aria-label', value);
              labelTarget.setAttribute('title', value);
            }

            function renderSvgIcon(svg: SVGElement, value: string, generatedSvg: SVGElement | null) {
              const display = displayIcon(value);
              const normalized = normalizeIconText(value);
              const originalWidth = svg.getAttribute('width');
              const originalHeight = svg.getAttribute('height');
              const originalStyleWidth = svg.style.width;
              const originalStyleHeight = svg.style.height;
              svg.replaceChildren();
              svg.dataset.hawkeyeIconReplacement = value;
              svg.setAttribute('viewBox', generatedSvg?.getAttribute('viewBox') || '0 0 24 24');
              svg.setAttribute('aria-label', value);
              svg.setAttribute('role', 'img');
              svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
              if (originalWidth) svg.setAttribute('width', originalWidth);
              else if (!originalStyleWidth) svg.setAttribute('width', '24');
              if (originalHeight) svg.setAttribute('height', originalHeight);
              else if (!originalStyleHeight) svg.setAttribute('height', '24');
              svg.style.overflow = 'hidden';
              svg.style.display = svg.style.display || 'inline-block';
              svg.style.verticalAlign = svg.style.verticalAlign || 'middle';

              if (generatedSvg) {
                for (const child of Array.from(generatedSvg.childNodes)) {
                  svg.appendChild(document.importNode(child, true));
                }
                return;
              }

              if (['x', '×', 'close', 'remove', 'dismiss', 'clear'].includes(normalized)) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M6 6L18 18M18 6L6 18');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'currentColor');
                path.setAttribute('stroke-width', '2.75');
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
                return;
              }

              const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              text.setAttribute('x', '12');
              text.setAttribute('y', '12');
              text.setAttribute('text-anchor', 'middle');
              text.setAttribute('dominant-baseline', 'central');
              text.setAttribute('fill', 'currentColor');
              text.setAttribute('font-size', display.length <= 2 ? '15' : '9');
              text.setAttribute('font-weight', '700');
              text.textContent = display;
              svg.appendChild(text);
            }

            function replaceControlIcon(control: HTMLElement, value: string) {
              const display = displayIcon(value);
              control.dataset.hawkeyeIconReplaced = value;
              control.setAttribute('aria-label', value);
              control.setAttribute('title', value);
              if (control instanceof HTMLInputElement) {
                control.value = display;
                return;
              }
              control.replaceChildren();
              const span = document.createElement('span');
              span.dataset.hawkeyeIconReplacement = 'true';
              span.textContent = display;
              span.style.display = 'inline-flex';
              span.style.alignItems = 'center';
              span.style.justifyContent = 'center';
              span.style.width = '100%';
              span.style.height = '100%';
              span.style.font = 'inherit';
              span.style.fontWeight = '700';
              span.style.lineHeight = '1';
              control.appendChild(span);
            }

            function displayIcon(value: string): string {
              const cleaned = cleanReplacement(value);
              if (normalizeIconText(cleaned) === 'close') return '×';
              return cleaned;
            }

            function cleanReplacement(value: string) {
              return String(value ?? '')
                .replace(/\bicon\b/gi, '')
                .replace(/\blike\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            }

            function sanitizeSvg(value?: string): SVGElement | null {
              if (!value || value.length > 25_000) return null;
              const doc = new DOMParser().parseFromString(value, 'image/svg+xml');
              const parsed = doc.documentElement;
              if (!parsed || parsed.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
              const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas']);
              for (const el of Array.from(parsed.querySelectorAll('*'))) {
                if (blocked.has(el.tagName.toLowerCase())) {
                  el.remove();
                  continue;
                }
                for (const attr of Array.from(el.attributes)) {
                  const name = attr.name.toLowerCase();
                  const val = attr.value.trim().toLowerCase();
                  if (name.startsWith('on') || val.startsWith('javascript:') || name === 'href' || name === 'xlink:href') {
                    el.removeAttribute(attr.name);
                  }
                }
              }
              for (const attr of Array.from(parsed.attributes)) {
                const name = attr.name.toLowerCase();
                const val = attr.value.trim().toLowerCase();
                if (name.startsWith('on') || val.startsWith('javascript:')) parsed.removeAttribute(attr.name);
              }
              return parsed as unknown as SVGElement;
            }

            function normalizeIconText(value: string): string {
              return String(value ?? '')
                .replace(/[_-]+/g, ' ')
                .replace(/\b(?:icon|button|btn|symbol)\b/gi, '')
                .replace(/[#"'.]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            }
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        await persistDomMutation(tabId, 'replace_selected_icon', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
      }

      case 'set_background_image': {
        type SetBackgroundImageArgs = {
          selector: string;
          svg?: string;
          image?: string;
          size?: string;
          position?: string;
          repeat?: string;
        };
        const a = args as unknown as SetBackgroundImageArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: (o: SetBackgroundImageArgs) => {
            const selector = String(o.selector ?? '');
            if (!selector) return { ok: true as const, count: 0, frameUrl: location.href };
            const image = cssImageValue(o.svg, o.image);
            if (!image) return { ok: false as const, error: 'No valid SVG, image URL, or data URI provided.' };
            const targets = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            for (const el of targets) {
              el.style.backgroundImage = image;
              el.style.backgroundSize = o.size || 'cover';
              el.style.backgroundPosition = o.position || 'center';
              el.style.backgroundRepeat = o.repeat || 'no-repeat';
            }
            return { ok: true as const, count: targets.length, frameUrl: location.href };

            function cssImageValue(svg?: string, image?: string): string {
              const safeSvg = sanitizeSvg(svg);
              if (safeSvg) return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(safeSvg))}")`;
              const raw = String(image ?? '').trim();
              if (!raw) return '';
              if (/^url\(/i.test(raw) || /^data:image\//i.test(raw)) return raw;
              if (/^https?:\/\//i.test(raw) || raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) {
                return `url("${raw.replace(/"/g, '%22')}")`;
              }
              return '';
            }

            function sanitizeSvg(value?: string): SVGElement | null {
              if (!value || value.length > 200_000) return null;
              const doc = new DOMParser().parseFromString(value, 'image/svg+xml');
              const parsed = doc.documentElement;
              if (!parsed || parsed.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
              parsed.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
              const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas']);
              for (const el of Array.from(parsed.querySelectorAll('*'))) {
                if (blocked.has(el.tagName.toLowerCase())) {
                  el.remove();
                  continue;
                }
                for (const attr of Array.from(el.attributes)) {
                  const name = attr.name.toLowerCase();
                  const val = attr.value.trim().toLowerCase();
                  if (name.startsWith('on') || val.startsWith('javascript:')) el.removeAttribute(attr.name);
                }
              }
              for (const attr of Array.from(parsed.attributes)) {
                const name = attr.name.toLowerCase();
                const val = attr.value.trim().toLowerCase();
                if (name.startsWith('on') || val.startsWith('javascript:')) parsed.removeAttribute(attr.name);
              }
              return parsed as unknown as SVGElement;
            }
          },
          args: [a],
        });
        const failed = res.find((frameResult) => frameResult.result && !(frameResult.result as any).ok);
        if (failed?.result && !(failed.result as any).ok) return { ok: false, error: (failed.result as any).error };
        const affected = res.reduce((sum, frameResult) => sum + ((frameResult.result as any)?.count ?? 0), 0);
        if (affected === 0) return { ok: false, error: `No elements match selector: ${a.selector}` };
        await persistDomMutation(tabId, 'set_background_image', a as unknown as Record<string, unknown>, res);
        return { ok: true, data: { affected } };
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

function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete' || Date.now() - startedAt >= timeoutMs) resolve();
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
      args: safeScriptArgs([iframeSelector, fn.toString(), extraArgs]),
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
      args: safeScriptArgs(args),
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
      args: safeScriptArgs(args),
    });
    return results?.[0]?.result ?? { ok: false, error: 'No result from frame executeScript' };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

function safeScriptArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeScriptValue(arg, new WeakSet<object>()));
}

function sanitizeScriptValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitizeScriptValue(item, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sanitizeScriptValue(item, seen);
  }
  return output;
}
