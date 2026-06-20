/**
 * Hawkeye Service Worker — central message router + tab tracker
 * Handles all inter-component communication and tab lifecycle events
 */

import type { ExtensionMessage, AgentState } from '@hawkeye/types';
import { startNetworkWatcher } from './network-watcher.js';
import { runAgent } from './agent.js';
import {
  startRecording, stopRecording, isRecording, recordStep, getRecordingSteps, getRecordingState, ensureRecordingState,
  saveFlow, listFlows, deleteFlow,
} from './flow-recorder.js';
import { replayFlow } from './flow-runner.js';

const API_BASE = 'http://localhost:3001';

// Track active agent state per tab
const agentStates = new Map<number, AgentState>();

// Track network captured data per tab
const networkData = new Map<number, any[]>();

// ---------- Lifecycle ----------

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Hawkeye] Extension installed');
  // Enable side panel on click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  agentStates.delete(tabId);
  networkData.delete(tabId);
});

// ---------- Network Watcher ----------

startNetworkWatcher(networkData);

// ---------- Message Router ----------

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // keep channel open for async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: any) => void
) {
  const tabId = message.tabId ?? sender.tab?.id;

  try {
    switch (message.type) {
      // ---------- Auth ----------
      case 'AUTH_GET_TOKEN': {
        const { token } = await chrome.storage.local.get('token');
        sendResponse({ token: token ?? null });
        break;
      }
      case 'AUTH_SET_TOKEN': {
        await chrome.storage.local.set({ token: (message.payload as { token: string }).token });
        sendResponse({ ok: true });
        break;
      }
      case 'AUTH_CLEAR_TOKEN': {
        await chrome.storage.local.remove('token');
        sendResponse({ ok: true });
        break;
      }

      // ---------- Page Snapshot ----------
      case 'PAGE_SNAPSHOT': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const snapshot = await captureSnapshot(tabId);
        sendResponse({ snapshot });
        break;
      }

      // ---------- Script Execution ----------
      case 'RUN_SCRIPT': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const { scriptCode, runId } = message.payload as { scriptCode: string; runId: string };
        await injectAndRun(tabId, scriptCode, runId);
        sendResponse({ ok: true });
        break;
      }

      // ---------- Network Catalog ----------
      case 'GET_NETWORK_DATA': {
        const data = networkData.get(tabId!) ?? [];
        sendResponse({ data });
        break;
      }
      case 'CLEAR_NETWORK_DATA': {
        if (tabId) networkData.delete(tabId);
        sendResponse({ ok: true });
        break;
      }

      // ---------- Agent State ----------
      case 'AGENT_STATE_GET': {
        const state = agentStates.get(tabId!) ?? null;
        sendResponse({ state });
        break;
      }
      case 'AGENT_STATE_SET': {
        if (tabId) agentStates.set(tabId, message.payload as AgentState);
        sendResponse({ ok: true });
        break;
      }
      case 'AGENT_STOP': {
        if (tabId) {
          const state = agentStates.get(tabId);
          if (state) {
            agentStates.set(tabId, { ...state, status: 'stopped' } as AgentState);
          }
        }
        sendResponse({ ok: true });
        break;
      }

      // ---------- Agent Run ----------
      case 'AGENT_RUN': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const { task, history, apiKey, provider } = message.payload as {
          task: string;
          history?: Array<{ role: 'user' | 'agent'; text: string }>;
          apiKey: string;
          provider: string;
        };
        const { token } = await chrome.storage.local.get('token');

        // Mark agent as running
        agentStates.set(tabId, { status: 'running', task, steps: [], tabId } as any);
        sendResponse({ ok: true, started: true });

        // Run agent async — sends step updates via runtime messages
        runAgent(
          task,
          tabId,
          { apiKey, provider },
          history ?? [],
          (step) => {
            // Broadcast step to side panel
            chrome.runtime.sendMessage({ type: 'AGENT_STEP', payload: step }).catch(() => {});
            // Append to state
            const state = agentStates.get(tabId!);
            if (state) {
              (state as any).steps = [...((state as any).steps ?? []), step];
              agentStates.set(tabId!, state);
            }            // If recording, capture tool calls
            if (step.type === 'tool_call' && step.tool && isRecording(tabId!)) {
              recordStep(tabId!, step.tool, (step as any).args ?? {}, { source: 'agent' });
              chrome.runtime.sendMessage({ type: 'FLOW_RECORDING_STEP', payload: { count: getRecordingSteps(tabId!).length } }).catch(() => {});
            }          },
          async (action, args) => {
            // Simple auto-allow for now — UI confirmation in Stage 5
            return true;
          }
        ).then((answer) => {
          const state = agentStates.get(tabId!);
          if (state) agentStates.set(tabId!, { ...state, status: 'done', answer } as any);
          chrome.runtime.sendMessage({ type: 'AGENT_DONE', payload: { answer } }).catch(() => {});
        }).catch((err) => {
          chrome.runtime.sendMessage({ type: 'AGENT_ERROR', payload: { error: err.message } }).catch(() => {});
        });
        break;
      }

      // ---------- Flow Recording ----------
      case 'FLOW_RECORD_START': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        startRecording(tabId, { startUrl: tab?.url, startTitle: tab?.title });
        await injectConfiguredContentScripts(tabId);
        const startAck = await sendToTab(tabId, { type: 'FLOW_RECORD_START', payload: {} });
        if (!startAck?.ok) {
          const state = stopRecording(tabId);
          sendResponse({
            ok: false,
            error: startAck?.error ?? 'Could not attach recorder to this tab. Refresh the page or use a normal http/https page.',
            steps: state.steps,
            startUrl: state.startUrl,
            startTitle: state.startTitle,
          });
          break;
        }
        sendResponse({ ok: true, startUrl: tab?.url, startTitle: tab?.title });
        break;
      }

      case 'FLOW_RECORD_STOP': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        chrome.tabs.sendMessage(tabId, { type: 'FLOW_RECORD_STOP', payload: {} }, () => { void chrome.runtime.lastError; });
        const state = stopRecording(tabId);
        sendResponse({ ok: true, steps: state.steps, startUrl: state.startUrl, startTitle: state.startTitle });
        break;
      }

      case 'FLOW_RECORD_STATUS': {
        if (!tabId) { sendResponse({ ok: false, recording: false }); break; }
        const state = await ensureRecordingState(tabId);
        sendResponse({ ok: true, recording: !!state, startUrl: state?.startUrl, startTitle: state?.startTitle });
        break;
      }

      case 'FLOW_RECORD_STEP': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const { tool, args, meta } = message.payload as {
          tool: string;
          args: Record<string, unknown>;
          meta?: Record<string, unknown>;
        };
        await ensureRecordingState(tabId);
        if (isRecording(tabId)) {
          const frameId = sender.frameId;
          const framedArgs = frameId && frameId !== 0
            ? { ...args, frameId, frameUrl: sender.url }
            : args;
          recordStep(tabId, tool, framedArgs, meta as any);
          chrome.runtime.sendMessage({
            type: 'FLOW_RECORDING_STEP',
            payload: { count: getRecordingSteps(tabId).length },
          }).catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }

      case 'FLOW_RECORD_STEPS': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const { steps } = message.payload as {
          steps: Array<{ tool: string; args: Record<string, unknown>; meta?: Record<string, unknown> }>;
        };
        await ensureRecordingState(tabId);
        const frameId = sender.frameId;
        for (const step of steps) {
          const framedArgs = frameId && frameId !== 0
            ? { ...step.args, frameId, frameUrl: sender.url }
            : step.args;
          if (isRecording(tabId)) {
            recordStep(tabId, step.tool, framedArgs, step.meta as any);
          }
        }
        if (isRecording(tabId)) {
          chrome.runtime.sendMessage({
            type: 'FLOW_RECORDING_STEP',
            payload: { count: getRecordingSteps(tabId).length },
          }).catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }

      case 'FLOW_SAVE': {
        const { name, domain, steps, replayDefaults, startUrl, startTitle } = message.payload as {
          name: string;
          domain: string;
          steps: any[];
          replayDefaults?: any;
          startUrl?: string;
          startTitle?: string;
        };
        const flow = await saveFlow(name, domain, steps, replayDefaults, startUrl, startTitle);
        sendResponse({ ok: true, flow });
        break;
      }

      case 'FLOW_LIST': {
        const { domain } = message.payload as { domain: string };
        const flows = await listFlows(domain);
        sendResponse({ ok: true, flows });
        break;
      }

      case 'FLOW_DELETE': {
        const { domain, flowId } = message.payload as { domain: string; flowId: string };
        await deleteFlow(domain, flowId);
        sendResponse({ ok: true });
        break;
      }

      case 'FLOW_REPLAY': {
        if (!tabId) { sendResponse({ error: 'no tab' }); break; }
        const { flow, repeatCount, dataMode, fieldStrategies } = message.payload as {
          flow: any;
          repeatCount: number;
          dataMode?: 'same' | 'random';
          fieldStrategies?: Record<string, 'same' | 'random'>;
        };
        sendResponse({ ok: true, started: true });
        replayFlow(flow, tabId, repeatCount, dataMode ?? 'same', (event) => {
          chrome.runtime.sendMessage({ type: 'FLOW_REPLAY_EVENT', payload: event }).catch(() => {});
        }, fieldStrategies).catch((err) => {
          chrome.runtime.sendMessage({ type: 'FLOW_REPLAY_EVENT', payload: { type: 'all_done', error: err.message } }).catch(() => {});
        });
        break;
      }

      // ---------- API Proxy ----------
      case 'API_REQUEST': {
        const { token } = await chrome.storage.local.get('token');
        const { method, path, body } = message.payload as { method?: string; path: string; body?: unknown };
        const res = await fetch(`${API_BASE}${path}`, {
          method: method ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        sendResponse({ status: res.status, data });
        break;
      }

      default:
        sendResponse({ error: `Unknown message type: ${(message as any).type}` });
    }
  } catch (err: any) {
    console.error('[Hawkeye SW] Error handling message', message.type, err);
    sendResponse({ error: err.message ?? String(err) });
  }
}

// ---------- Helpers ----------

async function captureSnapshot(tabId: number) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          url: location.href,
          title: document.title,
          html: document.documentElement.outerHTML.slice(0, 50_000),
        };
      },
    });
    return results[0]?.result ?? null;
  } catch (e: any) {
    return { error: e.message };
  }
}

function sendToTab(tabId: number, message: unknown): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(res ?? { ok: false, error: 'No response from content script' });
    });
  });
}

async function injectConfiguredContentScripts(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const scripts = manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? [];
  if (scripts.length === 0) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: scripts });
  } catch {
    // Restricted pages and mid-navigation tabs cannot be injected.
  }
}

async function injectAndRun(tabId: number, code: string, runId: string) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (scriptCode: string, rid: string) => {
      const blob = new Blob([scriptCode], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const script = document.createElement('script');
      script.src = url;
      script.dataset.hawkeyeRunId = rid;
      script.onload = () => URL.revokeObjectURL(url);
      (document.head || document.documentElement).appendChild(script);
    },
    args: [code, runId],
  });
}
