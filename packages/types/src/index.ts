// ─── Message Protocol ─────────────────────────────────────────────────────────

export type MessageType =
  | 'GET_SITE_CONTEXT'
  | 'SITE_CONTEXT_UPDATED'
  | 'ANALYZE_DOM'
  | 'DOM_ANALYSIS_RESULT'
  | 'CAPTURE_SNAPSHOT'
  | 'CAPTURE_SCREENSHOT'
  | 'INJECT_SCRIPT'
  | 'START_ELEMENT_PICKER'
  | 'STOP_ELEMENT_PICKER'
  | 'ELEMENT_SELECTED'
  | 'ELEMENT_PICKER_CANCELLED'
  | 'VERIFY_ELEMENT'
  | 'READ_PAGE_CONTENT'
  | 'CALL_API'
  | 'AGENT_START'
  | 'AGENT_STOP'
  | 'AGENT_STATE_UPDATE'
  | 'AGENT_PERMISSION_REQUEST'
  | 'AGENT_PERMISSION_RESPONSE'
  | 'GET_AGENT_STATE'
  | 'NETWORK_REQUEST_CAPTURED'
  | 'OPEN_SIDEPANEL'
  // Service-worker / content messaging
  | 'AUTH_GET_TOKEN'
  | 'AUTH_SET_TOKEN'
  | 'AUTH_CLEAR_TOKEN'
  | 'PAGE_SNAPSHOT'
  | 'RUN_SCRIPT'
  | 'GET_NETWORK_DATA'
  | 'CLEAR_NETWORK_DATA'
  | 'AGENT_STATE_GET'
  | 'AGENT_STATE_SET'
  | 'AGENT_RUN'
  | 'AGENT_STEP'
  | 'AGENT_DONE'
  | 'AGENT_ERROR'
  | 'API_REQUEST'
  | 'DOM_ANALYZE'
  | 'DOM_QUERY'
  | 'DOM_CLICK'
  | 'DOM_TYPE'
  | 'DOM_SELECT'
  | 'DOM_SCROLL'
  | 'PICKER_START'
  | 'PICKER_STOP'
  | 'FLOW_RECORD_START'
  | 'FLOW_RECORD_STOP'
  | 'FLOW_RECORD_STEP'
  | 'FLOW_RECORD_STEPS'
  | 'FLOW_RECORDING_STEP'
  | 'FLOW_SAVE'
  | 'FLOW_LIST'
  | 'FLOW_DELETE'
  | 'FLOW_REPLAY'
  | 'FLOW_REPLAY_EVENT';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload: T;
  tabId?: number;
}

// ─── Network / API Catalog ────────────────────────────────────────────────────

export interface CapturedRequest {
  id: string;
  tabId?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body?: string;
  requestBody?: string;
  status?: number;
  timestamp: number;
  duration?: number;
  type: 'xhr' | 'fetch' | 'websocket';
  initiator?: string;
}

export interface APIEndpoint {
  url: string;
  method: string;
  baseUrl: string;
  path: string;
  queryParams: Record<string, string>;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  authType?: 'bearer' | 'cookie' | 'api-key' | 'none';
  callCount: number;
  lastCalled: number;
}

export interface APICategory {
  name: string;
  endpoints: APIEndpoint[];
  type: 'rest' | 'graphql' | 'websocket' | 'unknown';
}

// ─── DOM Analysis ─────────────────────────────────────────────────────────────

export interface DOMElement {
  selector: string;
  tagName: string;
  id?: string;
  classes: string;
  text?: string;
  textContent?: string;
  placeholder?: string;
  type?: string;
  name?: string;
  ariaLabel?: string;
  role?: string;
  href?: string;
  attributes?: Record<string, string>;
  isInteractive?: boolean;
  interactive?: boolean;
  visible?: boolean;
  boundingBox?: { top: number; left: number; width: number; height: number };
  boundData?: string;
}

export interface DOMFormField {
  name: string;
  type: string;
  selector: string;
  required: boolean;
  value: string;
}

export interface DOMForm {
  id: string | null;
  name: string | null;
  action: string | null;
  method: string;
  selector: string;
  fields: DOMFormField[];
}

export interface DOMAnalysis {
  url?: string;
  title?: string;
  elements?: DOMElement[];
  forms?: DOMForm[];
  interactiveCount?: number;
  interactiveElements?: DOMElement[];
  dataContainers?: DOMElement[];
  navigation?: DOMElement[];
  timestamp?: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  timestamp: number;
  viewport: { width: number; height: number };
  sections: Array<{
    type: 'header' | 'nav' | 'main' | 'sidebar' | 'footer' | 'modal' | 'unknown';
    selector: string;
    html: string;
  }>;
  interactiveElements: Array<{
    selector: string;
    tagName: string;
    text?: string;
    ariaLabel?: string;
    location: string;
  }>;
  forms: Array<{
    selector: string;
    fields: Array<{
      selector: string;
      type: string;
      name?: string;
      label?: string;
      placeholder?: string;
    }>;
  }>;
  framework?: string;
  textContent: string;
}

// ─── Site Context ──────────────────────────────────────────────────────────────

export interface SiteContext {
  domain: string;
  url: string;
  title: string;
  apis: APICategory[];
  dom: DOMAnalysis;
  snapshot?: PageSnapshot;
  cookies: string[];
  localStorage: Record<string, string>;
  timestamp: number;
}

// ─── Element Picker ───────────────────────────────────────────────────────────

export interface SelectedElement {
  selector: string;
  alternativeSelectors: string[];
  tagName: string;
  id?: string;
  classes: string[];
  textContent?: string;
  innerHTML: string;
  outerHTML: string;
  attributes: Record<string, string>;
  boundingRect: { top: number; left: number; width: number; height: number };
  parentHTML?: string;
  siblingInfo?: string;
}

// ─── Scripts & Flows ──────────────────────────────────────────────────────────

export type ScriptStatus = 'draft' | 'review' | 'approved' | 'archived';

export interface Script {
  id: string;
  userId: string;
  orgId?: string;
  domain: string;
  name: string;
  description: string;
  code: string;
  prompt: string;
  model: string;
  status: ScriptStatus;
  enabled: boolean;
  autoRun: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScriptVersion {
  id: string;
  scriptId: string;
  version: number;
  code: string;
  changedBy: string;
  createdAt: number;
}

export interface RunResult {
  id: string;
  scriptId: string;
  userId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: number;
  completedAt?: number;
  error?: string;
  screenshotPath?: string;
  logs: string[];
}

// ─── Chat & Conversations ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  scriptId?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface Conversation {
  id: string;
  userId: string;
  domain: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_permission'
  | 'completed'
  | 'failed';

export interface AgentTask {
  id: string;
  description: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  timestamp: number;
}

export interface AgentState {
  id: string;
  domain: string;
  tabId: number;
  status: AgentStatus;
  tasks: AgentTask[];
  messages: ChatMessage[];
  activeScriptId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PermissionRequest {
  id: string;
  agentId: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  description: string;
  timestamp: number;
}

// ─── LLM Config ───────────────────────────────────────────────────────────────

export type LLMProvider = 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StorageData {
  llmConfig: LLMConfig;
  scripts: Record<string, Script[]>;
  conversations: Record<string, Conversation>;
  siteContexts: Record<string, SiteContext>;
}
