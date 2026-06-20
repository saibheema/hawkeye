import React, { useMemo, useState } from 'react';

type FieldStrategy = 'same' | 'random';

type FlowField = {
  id: string;
  stepIndex: number;
  selector: string;
  label: string;
  dataKind: string;
  originalValue: string;
  strategy?: FieldStrategy;
  frameId?: number;
  frameUrl?: string;
};

type Flow = {
  id: string;
  name: string;
  domain: string;
  startUrl?: string;
  startTitle?: string;
  createdAt: number;
  updatedAt?: number;
  version?: number;
  steps: Array<{ tool: string; args: Record<string, unknown>; meta?: Record<string, unknown> }>;
  stepCount: number;
  fields?: FlowField[];
  replayDefaults?: {
    repeatCount: number;
    dataMode: FieldStrategy;
    fieldStrategies: Record<string, FieldStrategy>;
  };
};

type ReplayEvent = {
  type: string;
  runIndex: number;
  total: number;
  stepIndex?: number;
  stepTool?: string;
  result?: any;
  results?: any[];
};

const C = {
  bg: '#f6f7f9',
  panel: '#ffffff',
  border: '#dfe3e8',
  borderSoft: '#edf0f3',
  text: '#17202a',
  second: '#667085',
  muted: '#98a2b3',
  accent: '#1769e0',
  accentSoft: '#e8f1ff',
  green: '#16833a',
  greenSoft: '#e8f7ee',
  red: '#cf2e25',
  redSoft: '#fdebea',
  amber: '#b7791f',
  amberSoft: '#fff6df',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  mono: '"Roboto Mono", "SFMono-Regular", Consolas, monospace',
};

function fallbackFields(flow: Flow): FlowField[] {
  if (Array.isArray(flow.fields) && flow.fields.length > 0) return flow.fields;
  return (flow.steps ?? []).flatMap((step, stepIndex) => {
    if (step.tool !== 'type_text') return [];
    const originalValue = String(step.args?.text ?? step.meta?.originalValue ?? '');
    return [{
      id: `field_${stepIndex}`,
      stepIndex,
      selector: String(step.args?.selector ?? ''),
      label: String(step.meta?.label ?? step.args?.selector ?? `Field ${stepIndex + 1}`),
      dataKind: String(step.meta?.dataKind ?? inferKind(originalValue)),
      originalValue,
      strategy: 'same' as FieldStrategy,
      frameId: typeof step.args?.frameId === 'number' ? step.args.frameId : undefined,
      frameUrl: typeof step.args?.frameUrl === 'string' ? step.args.frameUrl : undefined,
    }];
  });
}

function inferKind(value: string): string {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/\d{3}.*\d{3}.*\d{4}/.test(value)) return 'phone';
  if (/^\d{5}(-\d{4})?$/.test(value)) return 'zip';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (/^\d{1,2}:\d{2}/.test(value)) return 'time';
  if (/^\d+$/.test(value)) return 'number';
  if (/^[a-z]+ [a-z]+$/i.test(value)) return 'name';
  return 'text';
}

function storageKey(domain: string) {
  return `hawkeye_flows_${domain}`;
}

async function loadAllFlows(): Promise<Flow[]> {
  const stored = await chrome.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith('hawkeye_flows_'))
    .flatMap(([, value]) => Array.isArray(value) ? value as Flow[] : [])
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

async function saveFlowUpdate(flow: Flow) {
  const key = storageKey(flow.domain);
  const stored = await chrome.storage.local.get(key);
  const flows: Flow[] = Array.isArray(stored[key]) ? stored[key] : [];
  await chrome.storage.local.set({
    [key]: flows.map((item) => item.id === flow.id ? { ...flow, updatedAt: Date.now() } : item),
  });
}

async function deleteFlow(flow: Flow) {
  const key = storageKey(flow.domain);
  const stored = await chrome.storage.local.get(key);
  const flows: Flow[] = Array.isArray(stored[key]) ? stored[key] : [];
  await chrome.storage.local.set({ [key]: flows.filter((item) => item.id !== flow.id) });
}

function Badge({ tone, children }: { tone: 'blue' | 'green' | 'red' | 'amber' | 'gray'; children: React.ReactNode }) {
  const colors = {
    blue: [C.accent, C.accentSoft],
    green: [C.green, C.greenSoft],
    red: [C.red, C.redSoft],
    amber: [C.amber, C.amberSoft],
    gray: [C.second, '#f2f4f7'],
  } as const;
  const [color, bg] = colors[tone];
  return <span className="badge" style={{ color, background: bg }}>{children}</span>;
}

export function Dashboard() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [repeatCount, setRepeatCount] = useState(1);
  const [dataMode, setDataMode] = useState<FieldStrategy>('same');
  const [strategies, setStrategies] = useState<Record<string, Record<string, FieldStrategy>>>({});
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const loaded = await loadAllFlows();
    setFlows(loaded);
    setSelectedId((current) => current && loaded.some((flow) => flow.id === current) ? current : loaded[0]?.id ?? null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setActiveTab(tab ?? null);
  }, []);

  React.useEffect(() => {
    void refresh();
    const listener = (msg: any) => {
      if (msg.type !== 'FLOW_REPLAY_EVENT') return;
      const event: ReplayEvent = msg.payload;
      setEvents((prev) => [...prev, event]);
      if (event.type === 'all_done') setRunningFlowId(null);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return flows;
    return flows.filter((flow) =>
      flow.name.toLowerCase().includes(needle)
      || flow.domain.toLowerCase().includes(needle)
      || fallbackFields(flow).some((field) => field.label.toLowerCase().includes(needle) || field.dataKind.toLowerCase().includes(needle))
    );
  }, [flows, query]);

  const selected = flows.find((flow) => flow.id === selectedId) ?? filtered[0] ?? null;
  const fields = selected ? fallbackFields(selected) : [];
  const selectedStrategies = selected
    ? {
      ...Object.fromEntries(fields.map((field) => [field.id, field.strategy ?? selected.replayDefaults?.dataMode ?? 'same'])),
      ...(selected.replayDefaults?.fieldStrategies ?? {}),
      ...(strategies[selected.id] ?? {}),
    }
    : {};
  const latestDone = [...events].reverse().find((event) => event.type === 'all_done');

  const updateAllStrategies = (flow: Flow, strategy: FieldStrategy) => {
    setDataMode(strategy);
    setStrategies((prev) => ({
      ...prev,
      [flow.id]: Object.fromEntries(fallbackFields(flow).map((field) => [field.id, strategy])),
    }));
  };

  const updateFieldStrategy = (flow: Flow, fieldId: string, strategy: FieldStrategy) => {
    setStrategies((prev) => ({ ...prev, [flow.id]: { ...(prev[flow.id] ?? {}), [fieldId]: strategy } }));
  };

  const persistDefaults = async () => {
    if (!selected) return;
    const updated: Flow = {
      ...selected,
      replayDefaults: {
        repeatCount,
        dataMode,
        fieldStrategies: selectedStrategies,
      },
      fields: fields.map((field) => ({ ...field, strategy: selectedStrategies[field.id] ?? dataMode })),
    };
    await saveFlowUpdate(updated);
    await refresh();
  };

  const runSelected = async () => {
    if (!selected) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setActiveTab(tab ?? null);
    if (!tab?.id) return;
    setEvents([]);
    setRunningFlowId(selected.id);
    chrome.runtime.sendMessage({
      type: 'FLOW_REPLAY',
      tabId: tab.id,
      payload: {
        flow: selected,
        repeatCount,
        dataMode,
        fieldStrategies: selectedStrategies,
      },
    });
  };

  const removeSelected = async () => {
    if (!selected) return;
    await deleteFlow(selected);
    await refresh();
  };

  return (
    <div className="page">
      <style>{css}</style>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">H</div>
          <div>
            <div className="brandName">Hawkeye</div>
            <div className="brandSub">Flow Dashboard</div>
          </div>
        </div>
        <div className="searchBox">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search automations" />
        </div>
        <div className="flowList">
          {filtered.map((flow) => {
            const count = fallbackFields(flow).length;
            return (
              <button
                key={flow.id}
                className={`flowItem ${selected?.id === flow.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedId(flow.id);
                  setRepeatCount(flow.replayDefaults?.repeatCount ?? 1);
                  setDataMode(flow.replayDefaults?.dataMode ?? 'same');
                  setEvents([]);
                }}
              >
                <span className="flowTitle">{flow.name}</span>
                <span className="flowMeta">{flow.domain}</span>
                <span className="flowFoot">
                  <Badge tone="gray">{flow.stepCount} steps</Badge>
                  <Badge tone={count > 0 ? 'blue' : 'gray'}>{count} fields</Badge>
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="emptySmall">No recorded flows found.</div>}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Personal Automation Portal</h1>
            <p>Review recorded flows, choose loop count, and control randomized test data per field.</p>
          </div>
          <div className="topActions">
            <button className="secondary" onClick={() => void refresh()}>Refresh</button>
            <button className="secondary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') })}>Open Side Panel UI</button>
          </div>
        </header>

        <section className="stats">
          <div><span>{flows.length}</span><label>Recorded flows</label></div>
          <div><span>{new Set(flows.map((flow) => flow.domain)).size}</span><label>Domains</label></div>
          <div><span>{flows.reduce((sum, flow) => sum + fallbackFields(flow).length, 0)}</span><label>Captured fields</label></div>
          <div><span>{activeTab?.url ? new URL(activeTab.url).hostname : 'No tab'}</span><label>Replay target</label></div>
        </section>

        {!selected ? (
          <section className="emptyState">
            <h2>No flows recorded yet</h2>
            <p>Start recording from the side panel. Saved recordings will appear here automatically.</p>
          </section>
        ) : (
          <div className="contentGrid">
            <section className="panel details">
              <div className="panelHeader">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.domain} · saved {new Date(selected.createdAt).toLocaleString()}</p>
                </div>
                <div className="headerBadges">
                  <Badge tone="blue">v{selected.version ?? 0}</Badge>
                  {selected.steps.some((step) => step.args?.frameId) && <Badge tone="amber">iframe</Badge>}
                </div>
              </div>

              <div className="controls">
                <label className="field">
                  <span>Runs</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  />
                </label>
                <div className="segmented">
                  <button className={dataMode === 'same' ? 'active' : ''} onClick={() => updateAllStrategies(selected, 'same')}>Same data</button>
                  <button className={dataMode === 'random' ? 'active' : ''} onClick={() => updateAllStrategies(selected, 'random')}>Random data</button>
                </div>
                <button className="secondary" onClick={() => void persistDefaults()}>Save defaults</button>
                <button className="danger" onClick={() => void removeSelected()}>Delete</button>
              </div>

              <div className="fieldTable">
                <div className="tableHead">
                  <span>Field</span>
                  <span>Recorded value</span>
                  <span>Replay</span>
                </div>
                {fields.map((field) => {
                  const strategy = selectedStrategies[field.id] ?? dataMode;
                  return (
                    <div className="tableRow" key={field.id}>
                      <div>
                        <strong>{field.label}</strong>
                        <small>{field.dataKind}{field.frameId !== undefined ? ' · iframe' : ''}</small>
                      </div>
                      <code>{field.originalValue || field.selector || '-'}</code>
                      <div className="miniSegment">
                        <button className={strategy === 'same' ? 'active' : ''} onClick={() => updateFieldStrategy(selected, field.id, 'same')}>Same</button>
                        <button className={strategy === 'random' ? 'active' : ''} onClick={() => updateFieldStrategy(selected, field.id, 'random')}>Random</button>
                      </div>
                    </div>
                  );
                })}
                {fields.length === 0 && <div className="emptySmall padded">This flow has no captured typed fields.</div>}
              </div>

              <div className="runBar">
                <button className="primary" disabled={runningFlowId === selected.id} onClick={() => void runSelected()}>
                  {runningFlowId === selected.id ? 'Running' : `Run ${repeatCount}x on active tab`}
                </button>
                <span>{activeTab?.title ?? 'Select a browser tab before running.'}</span>
              </div>
            </section>

            <section className="panel runPanel">
              <div className="panelHeader compact">
                <div>
                  <h2>Run Results</h2>
                  <p>Latest replay execution and generated test data.</p>
                </div>
                {latestDone?.results && (
                  <Badge tone={(latestDone.results.every((r: any) => r.ok)) ? 'green' : 'red'}>
                    {latestDone.results.filter((r: any) => r.ok).length}/{latestDone.results.length} passed
                  </Badge>
                )}
              </div>
              <div className="log">
                {events.filter((event) => event.type === 'run_start' || event.type === 'run_done').map((event, index) => (
                  <div className="logItem" key={`${event.type}-${event.runIndex}-${index}`}>
                    <span className="runNo">#{event.runIndex + 1}</span>
                    {event.type === 'run_start' ? (
                      <span className="muted">Running</span>
                    ) : event.result?.ok ? (
                      <>
                        <Badge tone="green">PASS</Badge>
                        <span>{event.result.durationMs}ms</span>
                        <code>{event.result.testData?.email ?? event.result.testData?.text}</code>
                      </>
                    ) : (
                      <>
                        <Badge tone="red">FAIL</Badge>
                        <span className="error">{event.result?.error}</span>
                        {event.result?.debug?.screenshotKey && <Badge tone="amber">snapshot</Badge>}
                        {event.result?.debug?.url && <code>{event.result.debug.url}</code>}
                      </>
                    )}
                  </div>
                ))}
                {events.length === 0 && <div className="emptySmall padded">Run a flow to see execution history here.</div>}
              </div>

              <details className="jsonBox">
                <summary>Recorded JSON</summary>
                <pre>{JSON.stringify({
                  ...selected,
                  replayDefaults: { repeatCount, dataMode, fieldStrategies: selectedStrategies },
                  fields: fields.map((field) => ({ ...field, strategy: selectedStrategies[field.id] ?? dataMode })),
                }, null, 2)}</pre>
              </details>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

const css = `
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: ${C.bg}; color: ${C.text}; font-family: ${C.font}; }
button, input { font: inherit; }
.page { min-height: 100%; display: grid; grid-template-columns: 320px 1fr; }
.sidebar { background: ${C.panel}; border-right: 1px solid ${C.border}; padding: 20px; display: flex; flex-direction: column; gap: 18px; min-height: 100vh; }
.brand { display: flex; align-items: center; gap: 12px; }
.brandMark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; background: ${C.text}; color: white; font-weight: 800; }
.brandName { font-weight: 800; font-size: 18px; }
.brandSub { color: ${C.second}; font-size: 12px; margin-top: 2px; }
.searchBox input { width: 100%; border: 1px solid ${C.border}; border-radius: 8px; padding: 11px 12px; outline: none; }
.searchBox input:focus { border-color: ${C.accent}; box-shadow: 0 0 0 3px ${C.accentSoft}; }
.flowList { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.flowItem { border: 1px solid ${C.borderSoft}; background: white; border-radius: 8px; padding: 12px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 5px; }
.flowItem.selected { border-color: ${C.accent}; background: ${C.accentSoft}; }
.flowTitle { color: ${C.text}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flowMeta { color: ${C.second}; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flowFoot { display: flex; gap: 6px; margin-top: 4px; }
.main { min-width: 0; padding: 28px; }
.topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
h1, h2, p { margin: 0; }
h1 { font-size: 28px; line-height: 1.1; }
.topbar p, .panelHeader p { color: ${C.second}; margin-top: 6px; }
.topActions, .headerBadges, .controls, .runBar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
.stats div { background: ${C.panel}; border: 1px solid ${C.borderSoft}; border-radius: 8px; padding: 14px; min-width: 0; }
.stats span { display: block; font-size: 22px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats label { display: block; color: ${C.second}; font-size: 12px; margin-top: 5px; }
.contentGrid { display: grid; grid-template-columns: minmax(520px, 1.35fr) minmax(360px, .85fr); gap: 18px; align-items: start; }
.panel, .emptyState { background: ${C.panel}; border: 1px solid ${C.borderSoft}; border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, .04); }
.panel { overflow: hidden; }
.emptyState { padding: 40px; text-align: center; }
.panelHeader { padding: 18px; border-bottom: 1px solid ${C.borderSoft}; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.panelHeader.compact { align-items: center; }
.controls { padding: 16px 18px; border-bottom: 1px solid ${C.borderSoft}; }
.field { display: flex; align-items: center; gap: 8px; color: ${C.second}; font-size: 13px; }
.field input { width: 76px; border: 1px solid ${C.border}; border-radius: 6px; padding: 7px 8px; }
.segmented, .miniSegment { display: inline-flex; border: 1px solid ${C.border}; border-radius: 7px; overflow: hidden; background: white; }
.segmented button, .miniSegment button { border: 0; background: white; color: ${C.second}; padding: 8px 11px; cursor: pointer; }
.miniSegment button { padding: 6px 8px; font-size: 12px; }
.segmented button + button, .miniSegment button + button { border-left: 1px solid ${C.border}; }
.segmented button.active, .miniSegment button.active { background: ${C.accent}; color: white; }
.primary, .secondary, .danger { border-radius: 7px; padding: 9px 13px; font-weight: 700; cursor: pointer; }
.primary { border: 1px solid ${C.accent}; background: ${C.accent}; color: white; }
.primary:disabled { opacity: .6; cursor: wait; }
.secondary { border: 1px solid ${C.border}; background: white; color: ${C.text}; }
.danger { border: 1px solid ${C.redSoft}; background: ${C.redSoft}; color: ${C.red}; }
.fieldTable { padding: 0 18px 18px; }
.tableHead, .tableRow { display: grid; grid-template-columns: 1.15fr 1.2fr auto; gap: 14px; align-items: center; }
.tableHead { color: ${C.second}; font-size: 12px; font-weight: 800; padding: 14px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
.tableRow { border-top: 1px solid ${C.borderSoft}; padding: 12px 0; }
.tableRow strong { display: block; }
.tableRow small { display: block; color: ${C.second}; margin-top: 3px; }
code, pre { font-family: ${C.mono}; }
code { color: ${C.second}; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.runBar { border-top: 1px solid ${C.borderSoft}; padding: 16px 18px; }
.runBar span { color: ${C.second}; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 800; white-space: nowrap; }
.log { max-height: 360px; overflow: auto; }
.logItem { display: grid; grid-template-columns: 44px auto 70px 1fr; gap: 10px; align-items: center; padding: 11px 18px; border-bottom: 1px solid ${C.borderSoft}; font-size: 13px; }
.runNo { color: ${C.muted}; font-family: ${C.mono}; }
.muted { color: ${C.second}; }
.error { color: ${C.red}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jsonBox { border-top: 1px solid ${C.borderSoft}; padding: 14px 18px; }
.jsonBox summary { cursor: pointer; color: ${C.second}; font-weight: 700; }
.jsonBox pre { max-height: 320px; overflow: auto; background: #0f172a; color: #dbeafe; border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.5; }
.emptySmall { color: ${C.muted}; font-size: 13px; }
.padded { padding: 18px; }
@media (max-width: 980px) {
  .page { grid-template-columns: 1fr; }
  .sidebar { min-height: auto; border-right: 0; border-bottom: 1px solid ${C.border}; }
  .contentGrid, .stats { grid-template-columns: 1fr; }
}
`;
