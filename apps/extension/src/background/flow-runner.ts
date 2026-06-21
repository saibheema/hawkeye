/**
 * Flow Runner — replays recorded flows with test data substitution
 */

import { executeTool } from './tools.js';
import { MAX_FLOW_STEPS, type Flow, type FlowFieldStrategy, type FlowStep } from './flow-recorder.js';

type NetworkActivitySnapshot = {
  active: number;
  lastActivityAt: number;
};

type ReplaySettleOptions = {
  framesReadyTimeoutMs?: number;
  waitForNetwork?: boolean;
  networkQuietMs?: number;
  networkTimeoutMs?: number;
  domQuietMs?: number;
  domTimeoutMs?: number;
};

const REPLAY_STEP_TIMEOUT_MS = 45_000;
const REPLAY_VERIFY_TIMEOUT_MS = 20_000;

// ─── Test data generator ──────────────────────────────────────────────────────

const FIRST_NAMES = ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Drew', 'Quinn', 'Avery', 'Blake'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface TestData {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  zip: string;
  number: string;
  mileage: string;
  notes: string;
  text: string;
  [key: string]: string;
}

export function generateTestData(runIndex: number): TestData {
  const first = rand(FIRST_NAMES);
  const last  = rand(LAST_NAMES);
  const tag   = randomInt(1000, 9999);
  // Future date within 30 days
  const d = new Date();
  d.setDate(d.getDate() + randomInt(1, 30));
  const dateStr = d.toISOString().slice(0, 10);
  const hours   = randomInt(8, 16);
  const mins    = ['00', '15', '30', '45'][randomInt(0, 3)];
  const ampm    = hours < 12 ? 'a.m.' : 'p.m.';
  const h12     = hours > 12 ? hours - 12 : hours;

  return {
    name:       `${first} ${last}`,
    first_name: first,
    last_name:  last,
    email:      `${first.toLowerCase()}.${last.toLowerCase()}.${tag}@testmail.com`,
    phone:      `(555) ${randomInt(200, 999)}-${tag}`,
    date:       dateStr,
    time:       `${h12}:${mins} ${ampm}`,
    zip:        String(randomInt(10000, 99999)),
    number:     String(randomInt(1000, 99999)),
    mileage:    String(randomInt(5000, 85000)),
    notes:      `Test run #${runIndex + 1} — automated by Hawkeye`,
    text:       `Hawkeye test ${runIndex + 1}-${tag}`,
  };
}

/** Replace {{variable}} tokens in a string value */
function substitute(value: string, data: TestData): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

/** Deep-substitute all string values inside an args object */
function substituteArgs(args: Record<string, unknown>, data: TestData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === 'string' ? substitute(v, data) : v;
  }
  return out;
}

function randomizeArgs(step: FlowStep, data: TestData): Record<string, unknown> {
  const args = substituteArgs(step.args, data);
  if (step.tool !== 'type_text' || typeof args.text !== 'string') return args;

  const dataKind = step.meta?.dataKind;
  if (dataKind && data[dataKind]) {
    return { ...args, text: data[dataKind] };
  }

  const inferred = inferKindFromValue(args.text);
  return { ...args, text: data[inferred] ?? data.text };
}

function argsForStep(
  flow: Flow,
  step: FlowStep,
  stepIndex: number,
  data: TestData,
  dataMode: FlowFieldStrategy,
  fieldStrategies?: Record<string, FlowFieldStrategy>
): Record<string, unknown> {
  const fieldId = `field_${stepIndex}`;
  let strategy = fieldStrategies?.[fieldId] ?? dataMode;
  const field = flow.fields?.find((candidate) => candidate.stepIndex === stepIndex);
  if (field && strategy !== 'random') {
    const sibling = flow.fields?.find((candidate) => {
      if (candidate.id === field.id) return false;
      const sameSelector = candidate.selector && candidate.selector === field.selector;
      const sameKindAndValue = candidate.dataKind === field.dataKind && candidate.originalValue === field.originalValue;
      return (sameSelector || sameKindAndValue) && fieldStrategies?.[candidate.id] === 'random';
    });
    if (sibling) strategy = 'random';
  }
  if (strategy === 'random') return randomizeArgs(step, data);
  return substituteArgs(step.args, data);
}

function inferKindFromValue(value: string): keyof TestData {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/\d{3}.*\d{3}.*\d{4}/.test(value)) return 'phone';
  if (/^\d{5}(-\d{4})?$/.test(value)) return 'zip';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{1,2}:\d{2}/.test(value)) return 'time';
  if (/^\d+$/.test(value)) return 'number';
  if (/^[a-z]+ [a-z]+$/i.test(value)) return 'name';
  return 'text';
}

// ─── Replay engine ────────────────────────────────────────────────────────────

export interface RunResult {
  runIndex: number;
  ok: boolean;
  failedStep?: number;
  failedTool?: string;
  error?: string;
  debug?: ReplayDebug;
  testData: TestData;
  durationMs: number;
}

export interface ReplayDebug {
  url?: string;
  title?: string;
  pageTextSnippet?: string;
  screenshotKey?: string;
  screenshotCaptured?: boolean;
}

export type ReplayProgressFn = (event: {
  type: 'run_start' | 'step' | 'run_done' | 'all_done';
  runIndex: number;
  total: number;
  stepIndex?: number;
  stepTool?: string;
  result?: RunResult;
  results?: RunResult[];
}) => void;

export async function replayFlow(
  flow: Flow,
  tabId: number,
  repeatCount: number,
  dataMode: 'same' | 'random',
  onProgress: ReplayProgressFn,
  fieldStrategies?: Record<string, FlowFieldStrategy>,
  getNetworkActivity?: () => NetworkActivitySnapshot | undefined
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const effectiveStrategies = fieldStrategies ?? flow.replayDefaults?.fieldStrategies;
  const startUrl = startUrlForFlow(flow);
  const stepsToRun = flow.steps.slice(0, MAX_FLOW_STEPS);

  for (let run = 0; run < repeatCount; run++) {
    const testData = generateTestData(run);
    const t0 = Date.now();

    onProgress({ type: 'run_start', runIndex: run, total: repeatCount });

    let ok = true;
    let failedStep: number | undefined;
    let failedTool: string | undefined;
    let error: string | undefined;
    let debug: ReplayDebug | undefined;
    const pendingScreenState: Array<{ step: FlowStep; args: Record<string, unknown>; stepIndex: number }> = [];

    if (startUrl) {
      const nav = await executeTool('navigate', { url: startUrl }, tabId);
      if (!nav.ok) {
        ok = false;
        failedStep = -1;
        failedTool = 'navigate';
        error = `Could not navigate to recorded start URL: ${nav.error}`;
        debug = await captureReplayDebug(tabId);
      } else {
        await waitForReplaySettle(tabId, 500, getNetworkActivity, {
          framesReadyTimeoutMs: 1_500,
          domQuietMs: 300,
          domTimeoutMs: 1_000,
        });
      }
    }

    for (let si = 0; ok && si < stepsToRun.length; si++) {
      const step: FlowStep = stepsToRun[si];
      const args = argsForStep(flow, step, si, testData, dataMode, effectiveStrategies);

      onProgress({ type: 'step', runIndex: run, total: repeatCount, stepIndex: si, stepTool: step.tool });

      if (isProceedStep(step, args) && pendingScreenState.length > 0) {
        const ensured = await ensureScreenState(tabId, pendingScreenState, getNetworkActivity);
        if (!ensured.ok) {
          ok = false;
          failedStep = ensured.failedStep ?? si;
          failedTool = ensured.failedTool ?? 'verify_replay_step';
          error = ensured.error;
          debug = await captureReplayDebug(tabId);
          break;
        }
      }

      await waitBeforeReplayStep(tabId, step, args, getNetworkActivity);
      const res = await executeToolWithTimeout(step.tool, args, tabId, REPLAY_STEP_TIMEOUT_MS);
      if (!res.ok) {
        ok = false;
        failedStep = si;
        failedTool = step.tool;
        error = res.error;
        debug = await captureReplayDebug(tabId);
        break;
      }

      await waitAfterReplayStep(tabId, step, args, getNetworkActivity);
      if (isStatefulStep(step, args)) upsertPendingState(pendingScreenState, { step, args, stepIndex: si });
      if (isProceedStep(step, args)) pendingScreenState.length = 0;
    }

    const result: RunResult = {
      runIndex: run,
      ok,
      failedStep,
      failedTool,
      error,
      debug,
      testData,
      durationMs: Date.now() - t0,
    };
    results.push(result);
    onProgress({ type: 'run_done', runIndex: run, total: repeatCount, result });

    // Pause between runs — let page settle
    if (run < repeatCount - 1) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  onProgress({ type: 'all_done', runIndex: repeatCount - 1, total: repeatCount, results });
  return results;
}

async function ensureScreenState(
  tabId: number,
  pending: Array<{ step: FlowStep; args: Record<string, unknown>; stepIndex: number }>,
  getNetworkActivity?: () => NetworkActivitySnapshot | undefined
): Promise<{ ok: true } | { ok: false; failedStep?: number; failedTool?: string; error: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const missing: Array<{ step: FlowStep; args: Record<string, unknown>; stepIndex: number; reason?: string }> = [];
    for (const item of pending) {
      const verified = await executeToolWithTimeout('verify_replay_step', {
        stepTool: item.step.tool,
        stepArgs: item.args,
      }, tabId, REPLAY_VERIFY_TIMEOUT_MS);
      if (!verified.ok) {
        missing.push({ ...item, reason: verified.error });
        continue;
      }
      const data = verified.data as { verified?: boolean; found?: boolean; reason?: string } | undefined;
      if (data?.verified === false) missing.push({ ...item, reason: data.reason });
    }
    if (missing.length === 0) return { ok: true };

    for (const item of missing) {
      await waitBeforeReplayStep(tabId, item.step, item.args, getNetworkActivity);
      const res = await executeToolWithTimeout(item.step.tool, item.args, tabId, REPLAY_STEP_TIMEOUT_MS);
      if (!res.ok) {
        return {
          ok: false,
          failedStep: item.stepIndex,
          failedTool: item.step.tool,
          error: `Could not reselect before proceeding: ${res.error ?? item.reason ?? item.step.tool}`,
        };
      }
      await waitAfterReplayStep(tabId, item.step, item.args, getNetworkActivity);
    }
  }

  const stillMissing: string[] = [];
  for (const item of pending) {
    const verified = await executeToolWithTimeout('verify_replay_step', {
      stepTool: item.step.tool,
      stepArgs: item.args,
    }, tabId, REPLAY_VERIFY_TIMEOUT_MS);
    const data = verified.data as { verified?: boolean; reason?: string } | undefined;
    if (!verified.ok || data?.verified === false) {
      stillMissing.push(describeReplayState(item.step, item.args, data?.reason ?? verified.error));
    }
  }
  if (stillMissing.length === 0) return { ok: true };
  return {
    ok: false,
    failedStep: pending[0]?.stepIndex,
    failedTool: 'verify_replay_step',
    error: `Could not confirm screen selections after 3 attempts: ${stillMissing.join('; ')}`,
  };
}

async function executeToolWithTimeout(
  tool: string,
  args: Record<string, unknown>,
  tabId: number,
  timeoutMs: number
) {
  let timeoutId: number | undefined;
  const timeout = new Promise<Awaited<ReturnType<typeof executeTool>>>((resolve) => {
    timeoutId = self.setTimeout(() => {
      resolve({ ok: false, error: `Timed out after ${timeoutMs}ms while running ${tool}` });
    }, timeoutMs);
  });
  const result = await Promise.race([executeTool(tool, args, tabId), timeout]);
  if (timeoutId !== undefined) self.clearTimeout(timeoutId);
  return result;
}

function upsertPendingState(
  pending: Array<{ step: FlowStep; args: Record<string, unknown>; stepIndex: number }>,
  item: { step: FlowStep; args: Record<string, unknown>; stepIndex: number }
) {
  const key = stateKey(item.step, item.args);
  const index = pending.findIndex((candidate) => stateKey(candidate.step, candidate.args) === key);
  if (index >= 0) pending[index] = item;
  else pending.push(item);
}

function isStatefulStep(step: FlowStep, args: Record<string, unknown>): boolean {
  if (step.tool === 'type_text' || step.tool === 'select_option') return true;
  if (step.tool !== 'click') return false;
  return isSelectableClick(args);
}

function isProceedStep(step: FlowStep, args: Record<string, unknown>): boolean {
  if (step.tool !== 'click' && step.tool !== 'trigger_event') return false;
  const text = searchableText(args, step);
  if (step.tool === 'trigger_event') {
    const event = String(args.event ?? '').toLowerCase();
    if (event === 'submit') return true;
    if (event === 'keydown' && String(args.key ?? '').toLowerCase() === 'enter') return true;
  }
  return /\b(continue|next|save|submit|done|finish|book|reserve|schedule|confirm|search|go|new customer|get started|start)\b/i.test(text);
}

function isSelectableClick(args: Record<string, unknown>): boolean {
  const inputType = String(args.inputType ?? '').toLowerCase();
  if (inputType === 'radio' || inputType === 'checkbox') return true;
  if (args.clickKind === 'selectable') return true;

  const selector = String(args.selector ?? '').toLowerCase();
  if (/input\[type=["']?(?:radio|checkbox)/.test(selector)) return true;
  if (/\b(tile|slot|service|card|option|choice)\b/.test(selector)) return true;
  if (/\[aria-(?:selected|checked|pressed)\]/.test(selector)) return true;

  const candidates = Array.isArray(args.locatorCandidates) ? args.locatorCandidates as Array<Record<string, unknown>> : [];
  return candidates.some((candidate) => {
    const candidateInputType = String(candidate.inputType ?? '').toLowerCase();
    if (candidateInputType === 'radio' || candidateInputType === 'checkbox') return true;
    if (candidate.type === 'role' && /^(option|radio|checkbox|tab|switch)$/i.test(String(candidate.value ?? ''))) return true;
    const candidateSelector = String(candidate.selector ?? candidate.value ?? '').toLowerCase();
    return /input\[type=["']?(?:radio|checkbox)/.test(candidateSelector)
      || /\b(tile|slot|service|card|option|choice)\b/.test(candidateSelector)
      || /\[aria-(?:selected|checked|pressed)\]/.test(candidateSelector);
  });
}

function searchableText(args: Record<string, unknown>, step: FlowStep): string {
  const candidates = Array.isArray(args.locatorCandidates) ? args.locatorCandidates as Array<Record<string, unknown>> : [];
  return [
    args.label,
    args.text,
    args.value,
    step.meta?.label,
    step.meta?.originalValue,
    ...candidates.map((candidate) => candidate.value),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function stateKey(step: FlowStep, args: Record<string, unknown>): string {
  if (step.tool === 'type_text' || step.tool === 'select_option') {
    return `${step.tool}:${String(args.selector ?? '')}:${String(args.frameId ?? '')}`;
  }
  const label = searchableText(args, step).toLowerCase();
  return `${step.tool}:${String(args.selector ?? '')}:${String(args.frameId ?? '')}:${String(args.inputType ?? '')}:${String(args.value ?? '')}:${label}`;
}

function describeReplayState(step: FlowStep, args: Record<string, unknown>, reason?: string): string {
  const label = searchableText(args, step) || String(args.selector ?? step.tool);
  return reason ? `${label} (${reason})` : label;
}

function startUrlForFlow(flow: Flow): string | null {
  const startUrl = typeof flow.startUrl === 'string' ? flow.startUrl.trim() : '';
  if (/^https?:\/\//i.test(startUrl)) return startUrl;

  // Backward compatibility for existing Google recordings saved before startUrl existed.
  // For other domains we avoid guessing because app start paths are often not domain root.
  const domain = flow.domain.toLowerCase();
  if (domain === 'google.com' || domain === 'www.google.com') return 'https://www.google.com/';
  return null;
}

async function waitBeforeReplayStep(
  tabId: number,
  step: FlowStep,
  args: Record<string, unknown>,
  getNetworkActivity?: () => NetworkActivitySnapshot | undefined
): Promise<void> {
  if (isProceedStep(step, args)) {
    await waitForReplaySettle(tabId, 120, getNetworkActivity, {
      framesReadyTimeoutMs: 500,
      domQuietMs: 100,
      domTimeoutMs: 250,
    });
    return;
  }

  if (step.tool === 'select_option') {
    await waitForDomQuiet(tabId, 80, 250);
    return;
  }

  if (step.tool === 'click' || step.tool === 'type_text') return;

  await waitForTabAndFramesReady(tabId, 300);
}

async function waitAfterReplayStep(
  tabId: number,
  step: FlowStep,
  args: Record<string, unknown>,
  getNetworkActivity?: () => NetworkActivitySnapshot | undefined
): Promise<void> {
  if (isProceedStep(step, args)) {
    await waitForReplaySettle(tabId, 250, getNetworkActivity, {
      framesReadyTimeoutMs: 1_500,
      domQuietMs: 180,
      domTimeoutMs: 700,
    });
    return;
  }

  if (step.tool === 'select_option') {
    await waitForDomQuiet(tabId, 180, 700);
    return;
  }

  if (step.tool === 'click') {
    await waitForDomQuiet(tabId, isStatefulStep(step, args) ? 150 : 80, isStatefulStep(step, args) ? 450 : 200);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, step.tool === 'type_text' ? 40 : 120));
}

async function waitForReplaySettle(
  tabId: number,
  minimumMs: number,
  getNetworkActivity?: () => NetworkActivitySnapshot | undefined,
  options: ReplaySettleOptions = {}
): Promise<void> {
  const started = Date.now();
  await waitForTabAndFramesReady(tabId, options.framesReadyTimeoutMs ?? Math.max(600, minimumMs));
  const remaining = minimumMs - (Date.now() - started);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  if (options.waitForNetwork) {
    await waitForNetworkIdle(getNetworkActivity, options.networkQuietMs ?? 600, options.networkTimeoutMs ?? 2_000);
  }
  await waitForDomQuiet(tabId, options.domQuietMs ?? 180, options.domTimeoutMs ?? 700);
}

async function waitForTabAndFramesReady(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const frameStates = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.readyState,
      });
      const framesReady = frameStates.length === 0 || frameStates.every((result) => result.result === 'interactive' || result.result === 'complete');
      if (tab.status === 'complete' && framesReady) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForNetworkIdle(
  getNetworkActivity: (() => NetworkActivitySnapshot | undefined) | undefined,
  quietMs: number,
  timeoutMs: number
): Promise<void> {
  if (!getNetworkActivity) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = getNetworkActivity();
    const active = activity?.active ?? 0;
    const lastActivityAt = activity?.lastActivityAt ?? 0;
    if (active === 0 && Date.now() - lastActivityAt >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function waitForDomQuiet(tabId: number, quietMs: number, timeoutMs: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (quietWindowMs: number, maxWaitMs: number) => new Promise<boolean>((resolve) => {
        const root = document.documentElement;
        if (!root) {
          resolve(true);
          return;
        }
        let lastMutationAt = Date.now();
        const startedAt = Date.now();
        const observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        const timer = window.setInterval(() => {
          const now = Date.now();
          if (now - lastMutationAt >= quietWindowMs || now - startedAt >= maxWaitMs) {
            window.clearInterval(timer);
            observer.disconnect();
            resolve(true);
          }
        }, 100);
      }),
      args: [quietMs, timeoutMs],
    });
  } catch {
    // Restricted pages or detached frames should not block replay.
  }
}

async function captureReplayDebug(tabId: number): Promise<ReplayDebug> {
  const debug: ReplayDebug = {};
  try {
    const tab = await chrome.tabs.get(tabId);
    debug.url = tab.url;
    debug.title = tab.title;
    const textResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 2000) ?? '',
    });
    debug.pageTextSnippet = textResult?.[0]?.result ?? '';
    if (typeof tab.windowId === 'number') {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const screenshotKey = `hawkeye_replay_snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await chrome.storage.local.set({
        [screenshotKey]: {
          dataUrl,
          url: debug.url,
          title: debug.title,
          createdAt: Date.now(),
        },
      });
      debug.screenshotKey = screenshotKey;
      debug.screenshotCaptured = true;
    }
  } catch (err) {
    debug.screenshotCaptured = false;
    debug.pageTextSnippet = debug.pageTextSnippet || String(err instanceof Error ? err.message : err).slice(0, 500);
  }
  return debug;
}
