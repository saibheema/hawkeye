/**
 * LLM Client abstraction — swap Gemini / Anthropic / OpenAI / Ollama at runtime
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMClient {
  chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse>;
}

// ─── Gemini Client (default) ─────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash';

export class GeminiClient implements LLMClient {
  constructor(private readonly apiKey: string) {}

  async chat(messages: LLMMessage[], tools?: LLMTool[]): Promise<LLMResponse> {
    // Gemini uses contents array — split system prompt out
    const systemMsg = messages.find((m) => m.role === 'system');
    const history = messages.filter((m) => m.role !== 'system');

    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    if (tools && tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    const res = await fetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Extract text
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
    const content = textParts.join('');

    // Extract tool calls
    const functionParts = parts.filter((p: any) => p.functionCall);
    const toolCalls = functionParts.map((p: any) => ({
      name: p.functionCall.name as string,
      arguments: p.functionCall.args as Record<string, unknown>,
    }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLLMClient(config: {
  provider: string;
  apiKey: string;
  model?: string;
}): LLMClient {
  switch (config.provider) {
    case 'gemini':
    default:
      return new GeminiClient(config.apiKey);
  }
}
