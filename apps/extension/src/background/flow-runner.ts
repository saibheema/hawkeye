/**
 * Flow Runner — replays recorded flows with test data substitution
 */

import { executeTool } from './tools.js';
import type { Flow, FlowStep } from './flow-recorder.js';

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

function inferKindFromValue(value: string): keyof TestData {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/\d{3}.*\d{3}.*\d{4}/.test(value)) return 'phone';
  if (/^\d{5}(-\d{4})?$/.test(value)) return 'zip';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{1,2}:\d{2}/.test(value)) return 'time';
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
  testData: TestData;
  durationMs: number;
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
  onProgress: ReplayProgressFn
): Promise<RunResult[]> {
  const results: RunResult[] = [];

  for (let run = 0; run < repeatCount; run++) {
    const testData = generateTestData(run);
    const t0 = Date.now();

    onProgress({ type: 'run_start', runIndex: run, total: repeatCount });

    let ok = true;
    let failedStep: number | undefined;
    let failedTool: string | undefined;
    let error: string | undefined;

    for (let si = 0; si < flow.steps.length; si++) {
      const step: FlowStep = flow.steps[si];
      const args = dataMode === 'random'
        ? randomizeArgs(step, testData)
        : { ...step.args };

      onProgress({ type: 'step', runIndex: run, total: repeatCount, stepIndex: si, stepTool: step.tool });

      const res = await executeTool(step.tool, args, tabId);
      if (!res.ok) {
        ok = false;
        failedStep = si;
        failedTool = step.tool;
        error = res.error;
        break;
      }

      // Short pause between steps to let the page react
      await new Promise((r) => setTimeout(r, 400));
    }

    const result: RunResult = {
      runIndex: run,
      ok,
      failedStep,
      failedTool,
      error,
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
