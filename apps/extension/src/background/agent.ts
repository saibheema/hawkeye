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

// Actions requiring user confirmation
const REQUIRES_PERMISSION = new Set(['navigate']);

const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are Hawkeye, an expert browser automation AI.
You have access to tools to interact with the current web page.
Your job is to complete the user's task precisely and efficiently.

CRITICAL: Never ask the user for permission or confirmation. Never say "Would you like me to…". Never ask "Should I…". Just execute the task immediately using the best available tool. If you are uncertain which selector to use, read the page first, then act.

Rules:
1. For text replacement tasks ("change X to Y", "rename", "translate"), call replace_text IMMEDIATELY — no need to read the page first.
2. For click / fill / navigate tasks, read_page ONCE to find the right selector, then act. Do NOT call read_page more than twice.
3. After reading, immediately execute the required tool(s). Do not pause or ask.
4. Use CSS selectors to interact with elements.
5. After each action, verify the result with get_property or query_element if needed.
6. If an element is not found, try an alternative selector or fall back to replace_text.
7. When the task is complete, summarise what you did in one or two sentences.
8. If a tool fails after two attempts with different approaches, try a simpler tool (e.g. replace_text instead of dom_op), then explain briefly.

Tool selection — pick the right one immediately:
- Change / replace visible text → replace_text (NO read_page needed — finds by text content directly)
- Change text on a known selector → dom_op (op: set_text)
- Change styles / colors / fonts → insert_css or set_style
- Re-theme with CSS variables → set_css_var
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
- **set_css_var**: Set a CSS custom property (design token) to re-theme sites that use variables.
  Example: set_css_var({ variable: "--primary-color", value: "#ff5722" })
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
- When read_page shows an <iframe> element, use read_page with iframe_selector to inspect its contents first.
- Then use click/type_text/select_option with the same iframe_selector to interact with elements inside it.
- Example: click({ selector: 'button[name="Continue"]', iframe_selector: 'iframe[title="service reservation form"]' })`;

export async function runAgent(
  userMessage: string,
  tabId: number,
  config: AgentConfig,
  onStep: StepCallback,
  permissionGate: (action: string, args: Record<string, unknown>) => Promise<boolean>
): Promise<string> {
  const llm = createLLMClient({
    provider: config.provider ?? 'gemini',
    apiKey: config.apiKey,
    model: config.model,
  });

  // Get current page URL to give context
  const tab = await chrome.tabs.get(tabId);
  const pageUrl = tab.url ?? 'unknown';

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Current page: ${pageUrl}\n\nTask: ${userMessage}`,
    },
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
