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
      },
      required: ['selector', 'value'],
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
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (!el) return { ok: false, error: `Element not found in frame: ${sel}` };
              el.click();
              return { ok: true };
            }, args.selector as string);
          return res.ok ? { ok: true, data: { clicked: args.selector } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (!el) return { ok: false, error: `Element not found in iframe: ${sel}` };
              el.click();
              return { ok: true };
            }, args.selector as string);
          return res.ok ? { ok: true, data: { clicked: args.selector } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_CLICK', payload: { selector: args.selector } });
        return res.ok
          ? { ok: true, data: { clicked: args.selector } }
          : { ok: false, error: res.error };
      }

      case 'type_text': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            (sel: string, text: string) => {
              const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
              if (!el) return { ok: false, error: `Input not found in frame: ${sel}` };
              el.focus();
              el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }, args.selector as string, args.text as string);
          return res.ok ? { ok: true, data: { typed: args.text } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            (sel: string, text: string) => {
              const el = document.querySelector(sel) as HTMLInputElement | null;
              if (!el) return { ok: false, error: `Input not found in iframe: ${sel}` };
              el.focus();
              el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }, args.selector as string, args.text as string);
          return res.ok ? { ok: true, data: { typed: args.text } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_TYPE', payload: { selector: args.selector, text: args.text } });
        return res.ok
          ? { ok: true, data: { typed: args.text } }
          : { ok: false, error: res.error };
      }

      case 'select_option': {
        const frameId = await resolveRecordedFrameId(tabId, args);
        if (frameId !== null) {
          const res = await execInFrameId(tabId, frameId,
            (sel: string, value: string) => {
              const el = document.querySelector(sel) as HTMLSelectElement | null;
              if (!el) return { ok: false, error: `Select not found in frame: ${sel}` };
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }, args.selector as string, args.value as string);
          return res.ok ? { ok: true, data: { selected: args.value } } : res;
        }
        if (args.iframe_selector) {
          const res = await execInFrame(tabId, args.iframe_selector as string,
            (sel: string, value: string) => {
              const el = document.querySelector(sel) as HTMLSelectElement | null;
              if (!el) return { ok: false, error: `Select not found in iframe: ${sel}` };
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }, args.selector as string, args.value as string);
          return res.ok ? { ok: true, data: { selected: args.value } } : res;
        }
        const res = await sendToContent(tabId, { type: 'DOM_SELECT', payload: { selector: args.selector, value: args.value } });
        return res.ok
          ? { ok: true, data: { selected: args.value } }
          : { ok: false, error: res.error };
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
            target: { tabId },
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

        const analysis = results?.[0]?.result;
        if (!analysis) return { ok: false, error: 'Could not analyze page — scripting permission may not cover this URL' };
        return { ok: true, data: analysis };
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
        const res = await sendToContent(tabId, { type: 'DOM_QUERY', payload: { selector: args.selector } });
        return { ok: true, data: res };
      }

      case 'dom_op': {
        type DomOpArgs = { op: string; selector: string; value?: string; attr?: string };
        const op = args as unknown as DomOpArgs;
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (o: DomOpArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector)) as HTMLElement[];
            if (els.length === 0) return { ok: false, error: `No elements match selector: ${o.selector}` };
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
            return { ok: true, count: els.length };
          },
          args: [op],
        });
        const r = results?.[0]?.result ?? { ok: false, error: 'No result from executeScript' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { affected: r.count } };
      }

      case 'insert_css': {
        const css = args.css as string;
        await chrome.scripting.insertCSS({
          target: { tabId },
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
          target: { tabId },
          world: 'MAIN',
          func: (o: SetStyleArgs) => {
            const els = Array.from(document.querySelectorAll(o.selector)) as HTMLElement[];
            if (els.length === 0) return { ok: false, error: `No elements: ${o.selector}` };
            // Accept both camelCase and kebab-case property names
            const prop = o.property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            for (const el of els) (el.style as any)[prop] = o.value;
            return { ok: true, count: els.length };
          },
          args: [a],
        });
        const r = res?.[0]?.result ?? { ok: false, error: 'No result' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { affected: r.count } };
      }

      case 'insert_html': {
        type InsertHtmlArgs = { selector: string; position: InsertPosition; html: string };
        const a = args as unknown as InsertHtmlArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (o: InsertHtmlArgs) => {
            const el = document.querySelector(o.selector);
            if (!el) return { ok: false, error: `Element not found: ${o.selector}` };
            el.insertAdjacentHTML(o.position, o.html);
            return { ok: true };
          },
          args: [a],
        });
        const r = res?.[0]?.result ?? { ok: false, error: 'No result' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { inserted: true } };
      }

      case 'trigger_event': {
        type TriggerArgs = { selector: string; event: string; key?: string };
        const a = args as unknown as TriggerArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (o: TriggerArgs) => {
            const el = document.querySelector(o.selector) as HTMLElement | null;
            if (!el) return { ok: false, error: `Element not found: ${o.selector}` };
            let evt: Event;
            if (['keydown', 'keyup', 'keypress'].includes(o.event)) {
              evt = new KeyboardEvent(o.event, { key: o.key ?? '', bubbles: true, cancelable: true });
            } else if (['click', 'dblclick', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'].includes(o.event)) {
              evt = new MouseEvent(o.event, { bubbles: true, cancelable: true });
            } else {
              evt = new Event(o.event, { bubbles: true, cancelable: true });
            }
            el.dispatchEvent(evt);
            if (o.event === 'focus') (el as HTMLElement).focus?.();
            if (o.event === 'blur')  (el as HTMLElement).blur?.();
            return { ok: true };
          },
          args: [a],
        });
        const r = res?.[0]?.result ?? { ok: false, error: 'No result' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { fired: args.event } };
      }

      case 'get_property': {
        type GetPropArgs = { selector: string; kind: string; name?: string };
        const a = args as unknown as GetPropArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId },
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
        const r = res?.[0]?.result ?? { ok: false, error: 'No result' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { value: r.value } };
      }

      case 'replace_text': {
        type ReplaceTextArgs = { find: string; replace: string; case_sensitive?: boolean };
        const a = args as unknown as ReplaceTextArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (o: ReplaceTextArgs) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            const flags = o.case_sensitive ? 'g' : 'gi';
            const pattern = new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
            let count = 0;
            let node: Text | null;
            while ((node = walker.nextNode() as Text | null)) {
              if (node.parentElement?.tagName === 'SCRIPT' || node.parentElement?.tagName === 'STYLE') continue;
              if (pattern.test(node.textContent ?? '')) {
                node.textContent = (node.textContent ?? '').replace(pattern, o.replace);
                count++;
              }
            }
            return { ok: true as const, count };
          },
          args: [a],
        });
        const r = res?.[0]?.result ?? { ok: false as const, error: 'No result' };
        if (!r.ok) return { ok: false, error: (r as any).error };
        return { ok: true, data: { replaced: (r as any).count } };
      }

      case 'set_css_var': {
        type SetCssVarArgs = { variable: string; value: string; selector?: string };
        const a = args as unknown as SetCssVarArgs;
        const res = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (o: SetCssVarArgs) => {
            const target = o.selector
              ? document.querySelector(o.selector) as HTMLElement | null
              : document.documentElement;
            if (!target) return { ok: false, error: `Not found: ${o.selector}` };
            target.style.setProperty(o.variable, o.value);
            return { ok: true };
          },
          args: [a],
        });
        const r = res?.[0]?.result ?? { ok: false, error: 'No result' };
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, data: { set: args.variable, to: args.value } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendToContent(tabId: number, message: unknown): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      // Consume lastError to prevent "Unchecked runtime.lastError" when the
      // content script isn't present on the tab (chrome:// pages, PDFs, etc.)
      void chrome.runtime.lastError;
      resolve(res ?? { ok: false, error: 'No response from content script' });
    });
  });
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
