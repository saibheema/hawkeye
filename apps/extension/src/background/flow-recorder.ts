/**
 * Flow Recorder — captures agent tool calls into replayable flows
 */

export interface FlowStep {
  tool: string;
  args: Record<string, unknown>;
  meta?: {
    source?: 'agent' | 'manual';
    dataKind?: string;
    label?: string;
    originalValue?: string;
  };
}

export type FlowFieldStrategy = 'same' | 'random';

export interface FlowField {
  id: string;
  stepIndex: number;
  selector: string;
  label: string;
  dataKind: string;
  originalValue: string;
  strategy: FlowFieldStrategy;
  frameId?: number;
  frameUrl?: string;
}

export interface FlowReplayDefaults {
  repeatCount: number;
  dataMode: FlowFieldStrategy;
  fieldStrategies: Record<string, FlowFieldStrategy>;
}

export interface Flow {
  id: string;
  name: string;
  domain: string;
  createdAt: number;
  updatedAt?: number;
  version?: number;
  steps: FlowStep[];
  stepCount: number;
  fields?: FlowField[];
  replayDefaults?: FlowReplayDefaults;
}

// In-memory recording state (per tab)
const recording = new Map<number, FlowStep[]>();

export function startRecording(tabId: number): void {
  recording.set(tabId, []);
}

export function stopRecording(tabId: number): FlowStep[] {
  const steps = recording.get(tabId) ?? [];
  recording.delete(tabId);
  return steps;
}

export function isRecording(tabId: number): boolean {
  return recording.has(tabId);
}

export function recordStep(
  tabId: number,
  tool: string,
  args: Record<string, unknown>,
  meta?: FlowStep['meta']
): void {
  const steps = recording.get(tabId);
  if (!steps) return;
  const last = steps[steps.length - 1];
  if (
    tool === 'type_text'
    && last?.tool === 'type_text'
    && last.args.selector === args.selector
    && last.args.frameId === args.frameId
  ) {
    steps[steps.length - 1] = { tool, args, meta };
    return;
  }
  steps.push({ tool, args, meta });
}

export function getRecordingSteps(tabId: number): FlowStep[] {
  return recording.get(tabId) ?? [];
}

export function extractFlowFields(steps: FlowStep[]): FlowField[] {
  return steps.flatMap((step, stepIndex) => {
    if (step.tool !== 'type_text') return [];
    const selector = typeof step.args.selector === 'string' ? step.args.selector : '';
    const originalValue = typeof step.args.text === 'string'
      ? step.args.text
      : typeof step.meta?.originalValue === 'string'
        ? step.meta.originalValue
        : '';
    if (!selector && !originalValue) return [];
    const dataKind = typeof step.meta?.dataKind === 'string' ? step.meta.dataKind : inferDataKindFromValue(originalValue);
    return [{
      id: `field_${stepIndex}`,
      stepIndex,
      selector,
      label: step.meta?.label || selector || `Field ${stepIndex + 1}`,
      dataKind,
      originalValue,
      strategy: 'same',
      frameId: typeof step.args.frameId === 'number' ? step.args.frameId : undefined,
      frameUrl: typeof step.args.frameUrl === 'string' ? step.args.frameUrl : undefined,
    }];
  });
}

function inferDataKindFromValue(value: string): string {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/\d{3}.*\d{3}.*\d{4}/.test(value)) return 'phone';
  if (/^\d{5}(-\d{4})?$/.test(value)) return 'zip';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{1,2}:\d{2}/.test(value)) return 'time';
  if (/^[a-z]+ [a-z]+$/i.test(value)) return 'name';
  return 'text';
}

// ─── Persistent storage ───────────────────────────────────────────────────────

function storageKey(domain: string): string {
  return `hawkeye_flows_${domain}`;
}

export async function saveFlow(
  name: string,
  domain: string,
  steps: FlowStep[],
  replayDefaults?: Partial<FlowReplayDefaults>
): Promise<Flow> {
  const fields = extractFlowFields(steps);
  const fieldStrategies = {
    ...Object.fromEntries(fields.map((field) => [field.id, field.strategy])),
    ...(replayDefaults?.fieldStrategies ?? {}),
  };
  const flow: Flow = {
    id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    domain,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    steps,
    stepCount: steps.length,
    fields: fields.map((field) => ({
      ...field,
      strategy: fieldStrategies[field.id] ?? replayDefaults?.dataMode ?? 'same',
    })),
    replayDefaults: {
      repeatCount: replayDefaults?.repeatCount ?? 1,
      dataMode: replayDefaults?.dataMode ?? 'same',
      fieldStrategies,
    },
  };
  const key = storageKey(domain);
  const stored = await chrome.storage.local.get(key);
  const flows: Flow[] = stored[key] ?? [];
  flows.push(flow);
  await chrome.storage.local.set({ [key]: flows });
  return flow;
}

export async function listFlows(domain: string): Promise<Flow[]> {
  const key = storageKey(domain);
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? [];
}

export async function deleteFlow(domain: string, flowId: string): Promise<void> {
  const key = storageKey(domain);
  const stored = await chrome.storage.local.get(key);
  const flows: Flow[] = (stored[key] ?? []).filter((f: Flow) => f.id !== flowId);
  await chrome.storage.local.set({ [key]: flows });
}
