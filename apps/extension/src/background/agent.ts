/**
 * Agent Engine — orchestrates the LLM ↔ tools loop
 * Max 10 iterations, permission gate for destructive actions, streams progress
 */

import type { LLMMessage } from './llm-client.js';
import { createLLMClient } from './llm-client.js';
import { TOOLS, executeTool } from './tools.js';

export interface AgentConfig {
  apiKey: string;
  provider?: string;
  model?: string;
}

export interface AgentStep {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'answer' | 'error';
  content: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

export type StepCallback = (step: AgentStep) => void;
export type AgentHistoryMessage = { role: 'user' | 'agent'; text: string };

// Actions requiring user confirmation
const REQUIRES_PERMISSION = new Set(['navigate']);

const MAX_ITERATIONS = 10;
const PAGE_MUTATION_TOOLS = new Set([
  'replace_text',
  'dom_op',
  'insert_css',
  'set_style',
  'style_by_text',
  'set_placeholder_by_label',
  'add_dropdown_option',
  'insert_html',
  'set_css_var',
  'replace_icon',
]);
const SYSTEM_PROMPT = `You are Hawkeye, an expert browser automation AI.
You have access to tools to interact with the current web page.
Your job is to complete the user's task precisely and efficiently.

Use the conversation history. Follow-up requests like "make that red", "change it back", or "use a different label" refer to previous page elements or changes when clear.

If the request is clear, execute it immediately with the best tool. If the request is genuinely ambiguous and choosing wrong could change the wrong element, ask exactly one short clarifying question and do not call a tool yet.

Rules:
1. For exact visible text replacement tasks ("change X text to Y", "rename X to Y"), call replace_text immediately.
2. For color/style changes by visible text ("change Welcome color to red", "make New Customer button blue"), prefer style_by_text.
3. For placeholder changes on inputs ("add placeholder for phone number", "set email placeholder to X"), prefer set_placeholder_by_label.
4. For adding a new dropdown/select option ("add ROD as another option in Make field"), use add_dropdown_option.
4. For click / fill / navigate tasks, read_page ONCE to find the right selector, then act. Do NOT call read_page more than twice.
3. After reading, immediately execute the required tool(s). Do not pause or ask.
4. Use CSS selectors to interact with elements.
5. After each action, verify the result with get_property or query_element if needed.
6. If an element is not found, try an alternative selector or fall back to replace_text.
7. When the task is complete, summarise what you did in one or two sentences.
8. If a tool fails after two attempts with different approaches, try a simpler tool (e.g. replace_text instead of dom_op), then explain briefly.

Tool selection — pick the right one immediately:
- Change / replace visible text → replace_text (NO read_page needed — finds by text content directly)
- Change color/style of visible text, labels, headings, or buttons → style_by_text
- Change text on a known selector → dom_op (op: set_text)
- Change styles / colors / fonts → insert_css or set_style
- Change an input placeholder by label/nearby text → set_placeholder_by_label
- Add an option to a dropdown/select by label → add_dropdown_option
- Re-theme with CSS variables → set_css_var
- Change icon-only controls ("change + icon to X", "replace search icon with close") → replace_icon
- Remove elements → dom_op (op: remove)
- Change attributes (href, placeholder, src) → dom_op (op: set_attr)
- Add new HTML nodes → insert_html
- Read element value / text / style → get_property
- Fire events (click, focus, hover) → trigger_event

Visual / UI changes — choose the right tool:
- **insert_css**: Inject a <style> block for broad style rules. Best for theming, hiding/showing, responsive changes.
  Example: insert_css({ css: "body { background: lightblue !important; } h1 { color: navy; }" })
- **set_style**: Set an inline style on specific element(s). Best for targeted per-element overrides.
  Example: set_style({ selector: "button.cta", property: "backgroundColor", value: "#e91e63" })
- **style_by_text**: Find visible elements by their text and apply inline styles across the page and iframes.
  Example: style_by_text({ text: "Welcome", styles: { color: "red" } })
  Example: style_by_text({ text: "New Customer", elementKind: "button", styles: { backgroundColor: "blue", borderColor: "blue", color: "#fff" } })
- **set_placeholder_by_label**: Find a form input/textarea by its label, nearby text, aria-label, placeholder, name, or id, then set placeholder text across page and iframes.
  Example: set_placeholder_by_label({ label: "phone number", placeholder: "BLABH BLAASDA" })
- **add_dropdown_option**: Find a native select or custom dropdown by label, nearby text, aria-label, name, or id, then add a new option across page and iframes.
  Example: add_dropdown_option({ label: "Make", optionLabel: "ROD", optionValue: "ROD" })
- **set_css_var**: Set a CSS custom property (design token) to re-theme sites that use variables.
  Example: set_css_var({ variable: "--primary-color", value: "#ff5722" })
- **replace_icon**: Replace icon-only buttons or controls by glyph/accessibility label/SVG title/common icon name.
  Example: replace_icon({ target: "+", replacement: "X" })
  Example: replace_icon({ target: "search", replacement: "close" })
- **dom_op**: Change text/HTML content, attributes, remove elements, or toggle classes.
  Example: dom_op({ op: "set_text", selector: "h1", value: "Welcome back!" })
  Example: dom_op({ op: "remove", selector: ".cookie-popup" })
  Example: dom_op({ op: "set_attr", selector: "a.logo", attr: "href", value: "https://example.com" })
- **insert_html**: Inject new HTML nodes before/after/inside an existing element.
  Example: insert_html({ selector: "nav", position: "beforeend", html: "<a href='/new'>New Page</a>" })
- **replace_text**: Find and replace visible text anywhere on the page.
  Example: replace_text({ find: "Add to Cart", replace: "Buy Now" })
- **trigger_event**: Fire a DOM event to activate reactive UI behaviour.
  Example: trigger_event({ selector: "#menu-toggle", event: "click" })
  Example: trigger_event({ selector: "input#search", event: "focus" })
- **get_property**: Read element text, attributes, computed styles, or position.
  Example: get_property({ selector: "h1", kind: "text" })
  Example: get_property({ selector: ".price", kind: "computed_style", name: "color" })

Never use eval or new Function for any DOM or style manipulation.

Iframe handling:
- Many forms on dealership and booking sites are embedded in an <iframe>.
- read_page returns elements from the top page and accessible iframes. If an element includes frameId, pass that frameId to click/type_text/select_option/query_element.
- When read_page shows an iframe but not its inner elements, use read_page with iframe_selector to inspect its contents first.
- Then use click/type_text/select_option with frameId or the same iframe_selector to interact with elements inside it.
- Example: click({ selector: 'button[name="Continue"]', iframe_selector: 'iframe[title="service reservation form"]' })`;

function parseDirectTextReplacement(message: string): { find: string; replace: string } | null {
  if (/\b(colou?r|background|font|style|border|size)\b/i.test(message)) return null;
  if (/\b(placeholder|text\s*box|textbox|input|field)\b/i.test(message)) return null;
  if (/\bicon\b/i.test(message)) return null;
  if (/\b(same|it|that|this|previous|last|iframe|frame|footer|header)\b/i.test(message)) return null;

  const normalized = message
    .trim()
    .replace(/^[\s"'`]*(?:can you|please|pls)\s+/i, '')
    .replace(/^(?:change|replace|rename|text)\s*[-:]?\s+/i, '');

  const explicitLabelMatch =
    normalized.match(/^(?:(?:the\s+)?(?:bu+t+on|button|link)\s+)?(?:label|text|copy|wording)\s+["'`](.+?)["'`]\s+(?:to|with|as)\s+["'`](.+?)["'`]$/i)
    ?? normalized.match(/^(?:the\s+)?(?:bu+t+on|button|link)\s+["'`](.+?)["'`]\s+(?:label|text|copy|wording)?\s*(?:to|with|as)\s+["'`](.+?)["'`]$/i);

  const match = explicitLabelMatch
    ?? normalized.match(/^["'`]?(.+?)["'`]?\s+(?:to|with|as)\s+["'`](.+?)["'`]$/i)
    ?? normalized.match(/^["'`]?(.+?)["'`]?\s+(?:to|with|as)\s+(.+?)$/i);

  if (!match) return null;

  const find = cleanTargetText(match[1]);
  const replace = match[2].trim().replace(/^["'`]+|["'`]+$/g, '');
  if (looksLikeColor(replace)) return null;
  if (/\b(button|link|field|input)\b/i.test(match[1]) && looksLikeColor(replace)) return null;
  if (!find || !replace || find.length > 200 || replace.length > 500) return null;

  return { find, replace };
}

function parseDirectStyleChange(message: string): { text: string; color: string } | null {
  const normalized = message
    .trim()
    .replace(/^[\s"'`]*(?:can you|please|pls)\s+/i, '')
    .replace(/\s+please[?.!]?$/i, '');

  const match = normalized.match(/^(?:change|make|set)\s+(.+?)\s+(?:button\s+)?(?:colou?r|background(?:\s+colou?r)?)\s+(?:to\s+)?(.+?)$/i);
  if (!match) return null;
  if (!/\bbutton\b/i.test(match[1]) && !/\bbutton\b/i.test(normalized)) return null;

  const text = cleanTargetText(match[1]);
  const color = match[2].trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!text || !color || text.length > 200 || color.length > 100) return null;

  return { text, color };
}

function parseDirectPlaceholderChange(message: string): { label: string; placeholder: string } | null {
  const normalized = message
    .trim()
    .replace(/^[\s"'`]*(?:can you|please|pls)\s+/i, '')
    .replace(/\s+please[?.!]?$/i, '');

  const match =
    normalized.match(/^(?:add|set|change|put|show)\s+(?:a\s+)?placeholder\s+(?:for|on|in|to)\s+(.+?)\s+(?:to|as|called|named|:|-)\s+(.+?)$/i)
    ?? normalized.match(/^(?:set|change)\s+(.+?)\s+placeholder\s+(?:to|as|called|named|:|-)\s+(.+?)$/i);

  if (!match) return null;

  const label = cleanTargetText(match[1])
    .replace(/\b(?:text\s*box|textbox|input|field|placeholder)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const placeholder = match[2]
    .trim()
    .replace(/^[-:\s]+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!label || !placeholder || label.length > 200 || placeholder.length > 500) return null;
  return { label, placeholder };
}

function parseDirectDropdownOption(message: string): { label: string; optionLabel: string; optionValue: string } | null {
  const normalized = message
    .trim()
    .replace(/^[\s"'`]*(?:can you|please|pls)\s+/i, '')
    .replace(/\s+please[?.!]?$/i, '');

  const match =
    normalized.match(/^(?:add|insert|put)\s+(.+?)\s+(?:as\s+)?(?:an(?:other)?\s+)?option\s+(?:in|into|to|for|on)\s+(.+?)\s+(?:dropdown|drop\s*down|select|field)\b/i)
    ?? normalized.match(/^(?:add|insert|put)\s+(?:an(?:other)?\s+)?option\s+(.+?)\s+(?:in|into|to|for|on)\s+(.+?)\s+(?:dropdown|drop\s*down|select|field)\b/i);

  if (!match) return null;
  const optionLabel = match[1].trim().replace(/^["'`]+|["'`]+$/g, '');
  const label = cleanTargetText(match[2])
    .replace(/\b(?:dropdown|drop\s*down|select|field|option)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || !optionLabel || label.length > 200 || optionLabel.length > 300) return null;
  return { label, optionLabel, optionValue: optionLabel };
}

function parseDirectIconReplacement(message: string): { target: string; replacement: string } | null {
  const normalized = message
    .trim()
    .replace(/^[\s"'`]*(?:can you|please|pls)\s+/i, '')
    .replace(/\s+please[?.!]?$/i, '');

  if (!/\bicon\b/i.test(normalized)) return null;
  const match =
    normalized.match(/^(?:change|replace|rename|set|update|make|turn)\s+(.+?)\s+(?:icon\s+)?(?:to|with|as|into)\s+(.+?)$/i)
    ?? normalized.match(/^(?:change|replace|rename|set|update|make|turn)\s+(?:the\s+)?icon\s+(.+?)\s+(?:to|with|as|into)\s+(.+?)$/i);
  if (!match) return null;

  const target = cleanIconText(match[1]);
  const replacement = cleanIconText(match[2]);
  if (!target || !replacement || target.length > 100 || replacement.length > 100) return null;
  return { target, replacement };
}

function cleanIconText(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\b(?:the\s+)?icon\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeColor(value: string): boolean {
  return /^(?:#[0-9a-f]{3,8}|rgb\(|hsl\(|red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown|cyan|magenta|lime|navy|teal|transparent)\b/i.test(value.trim());
}

function cleanTargetText(value: string): string {
  let cleaned = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[\s"'`]*(?:the\s+)?(?:(?:bu+t+on|button|link|field|input)\s+)?(?:label|text|copy|wording)\s+["'`]*/i, '')
    .replace(/^[\s"'`]*(?:the\s+)?(?:bu+t+on|button|link)\s+["'`]*/i, '');
  let previous = '';
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(/\s+(?:bu+t+on|button|link|field|input|label|text|copy|wording)$/i, '')
      .replace(/\s+(?:bu+t+on|button|link|field|input)\s+(?:label|text|copy|wording)$/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
  }
  return cleaned;
}

function getSuccessfulMutationSummary(tool: string, data: unknown): string | null {
  if (!PAGE_MUTATION_TOOLS.has(tool)) return null;
  const d = (data ?? {}) as Record<string, unknown>;
  const count = Number(d.replaced ?? d.affected ?? d.insertedCount ?? d.count ?? 0);

  if (tool === 'insert_css' && d.injected) return 'Done. I applied the CSS change.';
  if (tool === 'insert_html' && d.inserted) return 'Done. I inserted the requested content.';
  if (tool === 'set_css_var' && d.set) return `Done. I updated ${String(d.set)}.`;
  if (Number.isFinite(count) && count > 0) return `Done. I updated ${count} matching element${count === 1 ? '' : 's'}.`;

  return null;
}

function compactPageContext(data: unknown): string {
  const page = (data ?? {}) as any;
  const frames = (page.frames ?? []).slice(0, 12).map((frame: any) => ({
    frameId: frame.frameId,
    url: frame.url,
    title: frame.title,
    elements: frame.elementCount,
    text: frame.textCount,
    forms: frame.formCount,
  }));
  const textSections = (page.textSections ?? []).slice(0, 80).map((section: any) => ({
    frameId: section.frameId,
    frameUrl: section.frameUrl,
    tag: section.tag,
    text: section.text,
  }));
  const elements = (page.elements ?? []).slice(0, 120).map((element: any) => ({
    frameId: element.frameId,
    frameUrl: element.frameUrl,
    tag: element.tag,
    selector: element.selector,
    text: element.text,
    type: element.type,
    name: element.name,
    id: element.id,
    placeholder: element.placeholder,
    ariaLabel: element.ariaLabel,
    role: element.role,
    visible: element.visible,
    disabled: element.disabled,
  }));
  const forms = (page.forms ?? []).slice(0, 20).map((form: any) => ({
    frameId: form.frameId,
    frameUrl: form.frameUrl,
    selector: form.selector,
    fields: (form.fields ?? []).slice(0, 30),
  }));

  return JSON.stringify({
    url: page.url,
    title: page.title,
    frames,
    textSections,
    elements,
    forms,
    warning: page.warning,
  });
}

export async function runAgent(
  userMessage: string,
  tabId: number,
  config: AgentConfig,
  history: AgentHistoryMessage[],
  onStep: StepCallback,
  permissionGate: (action: string, args: Record<string, unknown>) => Promise<boolean>
): Promise<string> {
  const directIconReplacement = parseDirectIconReplacement(userMessage);
  if (directIconReplacement) {
    onStep({
      type: 'tool_call',
      content: 'Calling replace_icon',
      tool: 'replace_icon',
      args: directIconReplacement,
    });

    const result = await executeTool('replace_icon', directIconReplacement, tabId);
    onStep({
      type: 'tool_result',
      content: result.ok ? JSON.stringify(result.data ?? { ok: true }) : `ERROR: ${result.error}`,
      tool: 'replace_icon',
      result: result.data ?? result.error,
    });

    if (result.ok) {
      const affected = (result.data as { affected?: number } | undefined)?.affected ?? 0;
      const answer = affected > 0
        ? `Changed ${affected} matching icon${affected === 1 ? '' : 's'} to "${directIconReplacement.replacement}".`
        : `I could not find an icon matching "${directIconReplacement.target}".`;
      onStep({ type: 'answer', content: answer });
      return answer;
    }

    const answer = `I could not change the icon: ${result.error}`;
    onStep({ type: 'answer', content: answer });
    return answer;
  }

  const directDropdownOption = parseDirectDropdownOption(userMessage);
  if (directDropdownOption) {
    onStep({
      type: 'tool_call',
      content: 'Calling add_dropdown_option',
      tool: 'add_dropdown_option',
      args: directDropdownOption,
    });

    const result = await executeTool('add_dropdown_option', directDropdownOption, tabId);
    onStep({
      type: 'tool_result',
      content: result.ok ? JSON.stringify(result.data ?? { ok: true }) : `ERROR: ${result.error}`,
      tool: 'add_dropdown_option',
      result: result.data ?? result.error,
    });

    if (result.ok) {
      const count = Number((result.data as any)?.affected ?? 0);
      return `Done. I added "${directDropdownOption.optionLabel}" to ${count || 'the'} matching dropdown${count === 1 ? '' : 's'}.`;
    }
    return `I could not add the dropdown option: ${result.error}`;
  }

  const directPlaceholderChange = parseDirectPlaceholderChange(userMessage);
  if (directPlaceholderChange) {
    onStep({
      type: 'tool_call',
      content: 'Calling set_placeholder_by_label',
      tool: 'set_placeholder_by_label',
      args: directPlaceholderChange,
    });

    const result = await executeTool('set_placeholder_by_label', directPlaceholderChange, tabId);
    onStep({
      type: 'tool_result',
      content: result.ok ? JSON.stringify(result.data ?? { ok: true }) : `ERROR: ${result.error}`,
      tool: 'set_placeholder_by_label',
      result: result.data ?? result.error,
    });

    if (!result.ok) {
      const answer = `I could not set the placeholder: ${result.error}`;
      onStep({ type: 'answer', content: answer });
      return answer;
    }

    const affected = (result.data as { affected?: number } | undefined)?.affected ?? 0;
    const answer = affected > 0
      ? `Set the placeholder on ${affected} matching field${affected === 1 ? '' : 's'}.`
      : `I could not find a field matching "${directPlaceholderChange.label}".`;
    onStep({ type: 'answer', content: answer });
    return answer;
  }

  const directStyleChange = parseDirectStyleChange(userMessage);
  if (directStyleChange) {
    const args = {
      text: directStyleChange.text,
      elementKind: 'button',
      styles: {
        backgroundColor: directStyleChange.color,
        borderColor: directStyleChange.color,
        color: '#fff',
      },
    };
    onStep({
      type: 'tool_call',
      content: 'Calling style_by_text',
      tool: 'style_by_text',
      args,
    });

    const result = await executeTool('style_by_text', args, tabId);
    onStep({
      type: 'tool_result',
      content: result.ok ? JSON.stringify(result.data ?? { ok: true }) : `ERROR: ${result.error}`,
      tool: 'style_by_text',
      result: result.data ?? result.error,
    });

    if (!result.ok) {
      const answer = `I could not change the button color: ${result.error}`;
      onStep({ type: 'answer', content: answer });
      return answer;
    }

    const affected = (result.data as { affected?: number } | undefined)?.affected ?? 0;
    const answer = affected > 0
      ? `Changed the "${directStyleChange.text}" button color to ${directStyleChange.color}.`
      : `I could not find a button matching "${directStyleChange.text}".`;
    onStep({ type: 'answer', content: answer });
    return answer;
  }

  const directReplacement = parseDirectTextReplacement(userMessage);
  if (directReplacement) {
    onStep({
      type: 'tool_call',
      content: 'Calling replace_text',
      tool: 'replace_text',
      args: { ...directReplacement, case_sensitive: false },
    });

    const result = await executeTool('replace_text', { ...directReplacement, case_sensitive: false }, tabId);
    onStep({
      type: 'tool_result',
      content: result.ok ? JSON.stringify(result.data ?? { ok: true }) : `ERROR: ${result.error}`,
      tool: 'replace_text',
      result: result.data ?? result.error,
    });

    if (!result.ok) {
      const answer = `I could not change the text: ${result.error}`;
      onStep({ type: 'answer', content: answer });
      return answer;
    }

    const replaced = (result.data as { replaced?: number } | undefined)?.replaced ?? 0;
    const answer = replaced > 0
      ? `Changed "${directReplacement.find}" to "${directReplacement.replace}".`
      : `I could not find visible text matching "${directReplacement.find}".`;
    onStep({ type: 'answer', content: answer });
    return answer;
  }

  const llm = createLLMClient({
    provider: config.provider ?? 'gemini',
    apiKey: config.apiKey,
    model: config.model,
  });

  // Get current page URL to give context
  const tab = await chrome.tabs.get(tabId);
  const pageUrl = tab.url ?? 'unknown';
  const pageContext = await executeTool('read_page', {}, tabId);
  const contextText = pageContext.ok
    ? compactPageContext(pageContext.data)
    : JSON.stringify({ warning: pageContext.error });

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current page: ${pageUrl}\n\nCompact current DOM/frame context:\n${contextText}`,
    },
    ...history
      .filter((m) => m.text.trim())
      .slice(-12)
      .map((m): LLMMessage => ({
        role: m.role === 'agent' ? 'assistant' : 'user',
        content: m.text,
      })),
    { role: 'user', content: `Task: ${userMessage}` },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Call LLM
    let response;
    try {
      response = await llm.chat(messages, TOOLS);
    } catch (err: any) {
      const errMsg = `LLM error: ${err.message}`;
      onStep({ type: 'error', content: errMsg });
      return errMsg;
    }

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content });

    // If no tool calls → final answer
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const answer = response.content || 'Task complete.';
      onStep({ type: 'answer', content: answer });
      return answer;
    }

    // Emit thinking if there's text content alongside tool calls
    if (response.content.trim()) {
      onStep({ type: 'thinking', content: response.content });
    }

    // Execute tool calls sequentially
    const toolResultParts: string[] = [];

    for (const toolCall of response.toolCalls) {
      const { name, arguments: args } = toolCall;

      // Permission gate for potentially destructive actions
      if (REQUIRES_PERMISSION.has(name)) {
        const allowed = await permissionGate(name, args);
        if (!allowed) {
          const denied = `User denied permission for: ${name}(${JSON.stringify(args)})`;
          onStep({ type: 'tool_result', content: denied, tool: name });
          toolResultParts.push(`Tool ${name}: DENIED by user`);
          continue;
        }
      }

      onStep({ type: 'tool_call', content: `Calling ${name}`, tool: name, args });

      const result = await executeTool(name, args, tabId);

      const resultStr = result.ok
        ? JSON.stringify(result.data ?? { ok: true })
        : `ERROR: ${result.error}`;

      onStep({
        type: 'tool_result',
        content: resultStr,
        tool: name,
        result: result.data ?? result.error,
      });

      toolResultParts.push(`Tool ${name} result: ${resultStr}`);

      if (result.ok) {
        const summary = getSuccessfulMutationSummary(name, result.data);
        if (summary) {
          onStep({ type: 'answer', content: summary });
          return summary;
        }
      }
    }

    // Feed tool results back to LLM
    messages.push({
      role: 'user',
      content: toolResultParts.join('\n'),
    });
  }

  const limitMsg = `Reached maximum iterations (${MAX_ITERATIONS}). Task may be incomplete.`;
  onStep({ type: 'error', content: limitMsg });
  return limitMsg;
}
