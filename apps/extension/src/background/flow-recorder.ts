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

export interface Flow {
  id: string;
  name: string;
  domain: string;
  createdAt: number;
  steps: FlowStep[];
  stepCount: number;
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
  if (steps) steps.push({ tool, args, meta });
}

export function getRecordingSteps(tabId: number): FlowStep[] {
  return recording.get(tabId) ?? [];
}

// ─── Persistent storage ───────────────────────────────────────────────────────

function storageKey(domain: string): string {
  return `hawkeye_flows_${domain}`;
}

export async function saveFlow(name: string, domain: string, steps: FlowStep[]): Promise<Flow> {
  const flow: Flow = {
    id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    domain,
    createdAt: Date.now(),
    steps,
    stepCount: steps.length,
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
