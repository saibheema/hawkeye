/**
 * Flow Recorder — captures agent tool calls into replayable flows
 */

export const MAX_FLOW_STEPS = 256;

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
  startUrl?: string;
  startTitle?: string;
  createdAt: number;
  updatedAt?: number;
  version?: number;
  steps: FlowStep[];
  stepCount: number;
  fields?: FlowField[];
  replayDefaults?: FlowReplayDefaults;
}

export interface RecordingState {
  steps: FlowStep[];
  startUrl?: string;
  startTitle?: string;
}

// In-memory recording state (per tab)
const recording = new Map<number, RecordingState>();
const RECORDING_STORAGE_KEY = 'hawkeye_active_recordings';

export function startRecording(tabId: number, meta: { startUrl?: string; startTitle?: string } = {}): void {
  recording.set(tabId, { steps: [], ...meta });
  void persistRecording(tabId);
}

export function stopRecording(tabId: number): RecordingState {
  const state = recording.get(tabId) ?? { steps: [] };
  recording.delete(tabId);
  void clearPersistedRecording(tabId);
  return state;
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
  const state = recording.get(tabId);
  if (!state) return;
  const steps = state.steps;
  const last = steps[steps.length - 1];
  if (last && shouldCoalesceRecordedStep(last, tool, args)) {
    steps[steps.length - 1] = { tool, args, meta };
    void persistRecording(tabId);
    return;
  }
  if (steps.length >= MAX_FLOW_STEPS) return;
  steps.push({ tool, args, meta });
  void persistRecording(tabId);
}

function shouldCoalesceRecordedStep(
  last: FlowStep,
  tool: string,
  args: Record<string, unknown>
): boolean {
  if (tool === 'type_text') {
    return last.tool === 'type_text'
      && last.args.selector === args.selector
      && last.args.frameId === args.frameId;
  }

  if (tool === 'click' && last.tool === 'click' && isChoiceArgs(last.args) && isChoiceArgs(args)) {
    return last.args.selector === args.selector
      && last.args.frameId === args.frameId
      && String(last.args.value ?? '') === String(args.value ?? '');
  }

  return false;
}

function isChoiceArgs(args: Record<string, unknown>): boolean {
  const inputType = String(args.inputType ?? '').toLowerCase();
  return inputType === 'radio' || inputType === 'checkbox';
}

export function getRecordingSteps(tabId: number): FlowStep[] {
  return recording.get(tabId)?.steps ?? [];
}

export function getRecordingState(tabId: number): RecordingState | null {
  return recording.get(tabId) ?? null;
}

export async function ensureRecordingState(tabId: number): Promise<RecordingState | null> {
  const current = recording.get(tabId);
  if (current) return current;
  try {
    const stored = await chrome.storage.local.get(RECORDING_STORAGE_KEY);
    const all = (stored[RECORDING_STORAGE_KEY] ?? {}) as Record<string, RecordingState>;
    const restored = all[String(tabId)] ?? null;
    if (restored) recording.set(tabId, restored);
    return restored;
  } catch {
    return null;
  }
}

async function persistRecording(tabId: number): Promise<void> {
  const state = recording.get(tabId);
  if (!state) return;
  try {
    const stored = await chrome.storage.local.get(RECORDING_STORAGE_KEY);
    const all = (stored[RECORDING_STORAGE_KEY] ?? {}) as Record<string, RecordingState>;
    await chrome.storage.local.set({
      [RECORDING_STORAGE_KEY]: {
        ...all,
        [String(tabId)]: state,
      },
    });
  } catch {
    // Recording should continue in memory even if persistence is unavailable.
  }
}

async function clearPersistedRecording(tabId: number): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(RECORDING_STORAGE_KEY);
    const all = (stored[RECORDING_STORAGE_KEY] ?? {}) as Record<string, RecordingState>;
    delete all[String(tabId)];
    await chrome.storage.local.set({ [RECORDING_STORAGE_KEY]: all });
  } catch {
    // Ignore cleanup failures.
  }
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
  if (/^\d+$/.test(value)) return 'number';
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
  replayDefaults?: Partial<FlowReplayDefaults>,
  startUrl?: string,
  startTitle?: string
): Promise<Flow> {
  const cappedSteps = steps.slice(0, MAX_FLOW_STEPS);
  const fields = extractFlowFields(cappedSteps);
  const fieldStrategies = {
    ...Object.fromEntries(fields.map((field) => [field.id, field.strategy])),
    ...(replayDefaults?.fieldStrategies ?? {}),
  };
  const flow: Flow = {
    id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    domain,
    startUrl,
    startTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    steps: cappedSteps,
    stepCount: cappedSteps.length,
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
