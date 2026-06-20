import React, { useState } from 'react';

// ─── Chrome-native design tokens ─────────────────────────────────────────────
const C = {
  bg:          '#ffffff',
  bgSubtle:    '#f8f9fa',
  bgHover:     '#f1f3f4',
  border:      '#dadce0',
  borderLight: '#e8eaed',
  text:        '#202124',
  textSecond:  '#5f6368',
  textMuted:   '#9aa0a6',
  accent:      '#1a73e8',
  accentHover: '#1558b0',
  accentBg:    '#e8f0fe',
  green:       '#1e8e3e',
  red:         '#d93025',
  yellow:      '#f29900',
  userBubble:  '#1a73e8',
  stepBg:      '#f8f9fa',
  font:        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Google Sans", Arial, sans-serif',
  fontMono:    '"Google Sans Mono", "Roboto Mono", Consolas, monospace',
  radius:      8,
  radiusSm:    4,
};

type Panel = 'settings' | 'flows' | null;

// ─── Reset Button ─────────────────────────────────────────────────────────────
function ResetButton() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async () => {
    if (!confirming) { setConfirming(true); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const domain = new URL(tab.url).hostname;
      await chrome.storage.local.remove(`hawkeye_css_${domain}`);
    }
    setConfirming(false);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  return (
    <button
      onClick={handleClick}
      title="Reset all Hawkeye changes on this page"
      style={{
        background: done ? C.green : confirming ? C.red : C.bgHover,
        border: `1px solid ${confirming ? C.red : C.border}`,
        borderRadius: C.radiusSm,
        padding: '3px 8px',
        fontSize: 11,
        color: done || confirming ? '#fff' : C.textSecond,
        cursor: 'pointer',
        fontFamily: C.font,
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      {done ? '✓ Reset' : confirming ? 'Confirm?' : '↺ Reset'}
    </button>
  );
}

export function App() {
  const [panel, setPanel] = useState<Panel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, color: C.text, fontFamily: C.font, fontSize: 13 }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, background: C.bg, flexShrink: 0 }}>
        {/* Actions dropdown */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{ background: menuOpen ? C.bgHover : 'none', border: `1px solid ${menuOpen ? C.border : 'transparent'}`, borderRadius: C.radiusSm, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: C.textSecond, cursor: 'pointer', fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            Actions <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: C.bg, border: `1px solid ${C.border}`, borderRadius: C.radius, boxShadow: '0 4px 16px rgba(0,0,0,0.13)', zIndex: 999, minWidth: 150, overflow: 'hidden' }}>
              {([['flows', '🔄', 'Record Flows'], ['settings', '⚙️', 'Settings']] as [NonNullable<Panel>, string, string][]).map(([p, icon, label]) => (
                <button key={p} onClick={() => { setPanel(panel === p ? null : p); setMenuOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: panel === p ? C.accentBg : 'none', border: 'none', textAlign: 'left', fontSize: 13, color: panel === p ? C.accent : C.text, cursor: 'pointer', fontFamily: C.font, fontWeight: panel === p ? 600 : 400 }}
                >
                  <span>{icon}</span>{label}
                  {panel === p && <span style={{ marginLeft: 'auto', fontSize: 10, color: C.accent }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <span style={{ fontSize: 16, lineHeight: 1 }}>🦅</span>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.text, letterSpacing: '-0.2px' }}>Hawkeye</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>v0.1</span>
        <ResetButton />
      </div>

      {/* Slide-in panel (Settings / Flows) */}
      {panel && (
        <div style={{ borderBottom: `1px solid ${C.border}`, background: C.bgSubtle, overflowY: 'auto', maxHeight: '55vh', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 0', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textSecond, flex: 1 }}>
              {panel === 'flows' ? '🔄 Record Flows' : '⚙️ Settings'}
            </span>
            <button onClick={() => setPanel(null)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          {panel === 'flows' ? <FlowsPanel /> : <SettingsPanel />}
        </div>
      )}

      {/* Chat fills remaining space */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ChatPanel />
      </div>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

type ChatMsg = { role: 'user' | 'agent'; text: string; isError?: boolean };

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'agent', text: 'Hi! I\'m Hawkeye. Tell me what to do on this page and I\'ll handle it.' },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [statusLine, setStatusLine] = useState(''); // current tool being called
  const [apiKey, setApiKey] = useState('');
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    chrome.storage.local.get('gemini_api_key', (res) => {
      if (res.gemini_api_key) setApiKey(res.gemini_api_key);
    });
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, running]);

  React.useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === 'AGENT_STEP') {
        const step = msg.payload;
        // Only show error steps in chat — everything else goes to console
        if (step.type === 'error') {
          setMessages(m => [...m, { role: 'agent', text: `❌ ${step.content}`, isError: true }]);
        } else if (step.type === 'tool_call') {
          // Update subtle status line while working
          setStatusLine(step.tool ? `Using ${step.tool}…` : 'Working…');
          console.debug('[Hawkeye]', step.type, step.tool, step.content);
        } else {
          console.debug('[Hawkeye]', step.type, step.content);
        }
      } else if (msg.type === 'AGENT_DONE') {
        setRunning(false);
        setStatusLine('');
        setMessages(m => [...m, { role: 'agent', text: msg.payload.answer }]);
      } else if (msg.type === 'AGENT_ERROR') {
        setRunning(false);
        setStatusLine('');
        setMessages(m => [...m, { role: 'agent', text: `❌ ${msg.payload.error}`, isError: true }]);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const send = async () => {
    if (!input.trim() || running) return;
    if (!apiKey) {
      setMessages(m => [...m, { role: 'agent', text: '⚠️ Add your Gemini API key in Actions → Settings first.', isError: true }]);
      return;
    }
    const task = input.trim();
    setInput('');
    setRunning(true);
    setStatusLine('Reading page…');
    setMessages(m => [...m, { role: 'user', text: task }]);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setRunning(false);
      setStatusLine('');
      setMessages(m => [...m, { role: 'agent', text: '❌ No active tab found.', isError: true }]);
      return;
    }
    chrome.runtime.sendMessage({ type: 'AGENT_RUN', tabId: tab.id, payload: { task, apiKey, provider: 'gemini' } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: C.font }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user' ? C.userBubble : C.bgSubtle,
            border: m.role === 'agent' ? `1px solid ${m.isError ? '#fad2cf' : C.border}` : 'none',
            borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
            padding: '8px 12px',
            maxWidth: '92%',
            fontSize: 13,
            lineHeight: 1.6,
            color: m.role === 'user' ? '#fff' : m.isError ? C.red : C.text,
          }}>
            {m.text}
          </div>
        ))}

        {/* Loading indicator with subtle tool status */}
        {running && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
            <span style={{ display: 'flex', gap: 3 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ display: 'inline-block', width: 6, height: 6, background: C.accent, borderRadius: '50%', opacity: 0.3, animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
              ))}
            </span>
            <span style={{ fontSize: 11, color: C.textMuted }}>{statusLine}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', background: C.bg }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={running ? '' : 'Tell Hawkeye what to do…'}
          disabled={running}
          style={{ flex: 1, background: running ? C.bgSubtle : C.bgSubtle, border: `1px solid ${C.border}`, borderRadius: 20, padding: '8px 14px', color: C.text, fontSize: 13, outline: 'none', fontFamily: C.font, opacity: running ? 0.5 : 1 }}
        />
        <button
          onClick={send}
          disabled={running || !input.trim()}
          style={{ background: (running || !input.trim()) ? C.bgHover : C.accent, border: 'none', borderRadius: '50%', width: 34, height: 34, flexShrink: 0, color: (running || !input.trim()) ? C.textMuted : '#fff', cursor: (running || !input.trim()) ? 'not-allowed' : 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// ─── Flows Panel ─────────────────────────────────────────────────────────────

type ReplayEvent = { type: string; runIndex: number; total: number; stepIndex?: number; stepTool?: string; result?: any; results?: any[] };

function FlowsPanel() {
  const [recording, setRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<any[]>([]);
  const [recordedStepCount, setRecordedStepCount] = useState(0);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [flows, setFlows] = useState<any[]>([]);
  const [domain, setDomain] = useState('');
  const [replayCount, setReplayCount] = useState(1);
  const [dataMode, setDataMode] = useState<'same' | 'random'>('same');
  const [replaying, setReplaying] = useState<string | null>(null); // flowId
  const [replayLog, setReplayLog] = useState<ReplayEvent[]>([]);
  const logRef = React.useRef<HTMLDivElement>(null);

  // Load domain + flows on mount
  React.useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url) {
        const d = new URL(tab.url).hostname;
        setDomain(d);
        chrome.runtime.sendMessage({ type: 'FLOW_LIST', payload: { domain: d } }, (res) => {
          if (res?.flows) setFlows(res.flows);
        });
      }
    });
  }, []);

  // Listen for recording step count updates + replay events
  React.useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === 'FLOW_RECORDING_STEP') {
        setRecordedStepCount(msg.payload?.count ?? 0);
      } else if (msg.type === 'FLOW_REPLAY_EVENT') {
        const evt: ReplayEvent = msg.payload;
        setReplayLog((prev) => [...prev, evt]);
        if (evt.type === 'all_done') setReplaying(null);
        logRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const toggleRecord = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!recording) {
      chrome.runtime.sendMessage({ type: 'FLOW_RECORD_START', tabId: tab?.id }, () => {
        setRecording(true);
        setRecordedSteps([]);
        setRecordedStepCount(0);
        setSaveName('');
      });
    } else {
      chrome.runtime.sendMessage({ type: 'FLOW_RECORD_STOP', tabId: tab?.id }, (res) => {
        setRecording(false);
        if (res?.steps) {
          setRecordedSteps(res.steps);
          setRecordedStepCount(res.steps.length);
        }
      });
    }
  };

  const saveFlow = async () => {
    if (!saveName.trim() || recordedSteps.length === 0) return;
    setSaving(true);
    chrome.runtime.sendMessage(
      { type: 'FLOW_SAVE', payload: { name: saveName.trim(), domain, steps: recordedSteps } },
      (res) => {
        setSaving(false);
        if (res?.flow) {
          setFlows((f) => [...f, res.flow]);
          setRecordedSteps([]);
          setRecordedStepCount(0);
          setSaveName('');
        }
      }
    );
  };

  const deleteFlow = (flowId: string) => {
    chrome.runtime.sendMessage({ type: 'FLOW_DELETE', payload: { domain, flowId } }, () => {
      setFlows((f) => f.filter((fl) => fl.id !== flowId));
    });
  };

  const startReplay = async (flow: any) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    setReplaying(flow.id);
    setReplayLog([]);
    chrome.runtime.sendMessage({
      type: 'FLOW_REPLAY',
      tabId: tab.id,
      payload: { flow, repeatCount: replayCount, dataMode },
    });
  };

  const pill = (text: string, color: string, bg: string) => (
    <span style={{ background: bg, color, borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
  );

  return (
    <div style={{ padding: 14, fontFamily: C.font, display: 'flex', flexDirection: 'column', gap: 14, width: '100%', boxSizing: 'border-box' }}>

      {/* ── Record Section ── */}
      <div style={{ border: `1px solid ${recording ? C.red : C.border}`, borderRadius: C.radius, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: recording ? '#fff5f5' : C.bgSubtle, display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${recording ? '#ffd6d6' : C.borderLight}` }}>
            {recording && <span style={{ width: 8, height: 8, background: C.red, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1 }}>
            {recording ? `Recording… ${recordedStepCount} step${recordedStepCount !== 1 ? 's' : ''}` : 'Record a Flow'}
          </span>
          <button
            onClick={toggleRecord}
            style={{ background: recording ? C.red : C.accent, border: 'none', borderRadius: C.radiusSm, padding: '4px 10px', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: C.font }}
          >
            {recording ? '⏹ Stop' : '⏺ Record'}
          </button>
        </div>
        {!recording && recordedSteps.length > 0 && (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: C.textSecond }}>
              {recordedSteps.map((s, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: i < recordedSteps.length - 1 ? `1px solid ${C.borderLight}` : 'none', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: C.textMuted, fontFamily: C.fontMono, minWidth: 16 }}>{i + 1}.</span>
                  {pill(s.tool, C.accent, C.accentBg)}
                  <span style={{ color: C.textSecond, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: C.fontMono, fontSize: 10 }}>
                    {s.args?.selector ?? s.args?.url ?? s.args?.text ?? ''}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Flow name (e.g. Book Oil Change)"
                style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: C.radiusSm, padding: '6px 8px', fontSize: 12, color: C.text, outline: 'none', fontFamily: C.font }}
              />
              <button
                onClick={saveFlow}
                disabled={!saveName.trim() || saving}
                style={{ background: C.accent, border: 'none', borderRadius: C.radiusSm, padding: '6px 10px', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: C.font, opacity: !saveName.trim() ? 0.5 : 1 }}
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => { setRecordedSteps([]); setRecordedStepCount(0); }}
                style={{ background: C.bgHover, border: `1px solid ${C.border}`, borderRadius: C.radiusSm, padding: '6px 8px', color: C.textSecond, fontSize: 11, cursor: 'pointer', fontFamily: C.font }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
        {recording && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: C.textSecond }}>
            Perform the task on the page or ask Hawkeye in Chat. Clicks, field values, and agent tool calls will be recorded.
          </div>
        )}
      </div>

      {/* ── Saved Flows ── */}
      {flows.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecond, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Saved Flows — {domain}
          </div>

          {/* Replay controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: C.textSecond }}>Runs:</span>
            {[1, 3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => setReplayCount(n)}
                style={{ background: replayCount === n ? C.accent : C.bgHover, border: `1px solid ${replayCount === n ? C.accent : C.border}`, borderRadius: C.radiusSm, padding: '3px 10px', color: replayCount === n ? '#fff' : C.textSecond, fontSize: 12, fontWeight: replayCount === n ? 600 : 400, cursor: 'pointer', fontFamily: C.font }}
              >
                {n}×
              </button>
            ))}
            <span style={{ width: 1, alignSelf: 'stretch', background: C.borderLight, margin: '0 2px' }} />
            {(['same', 'random'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setDataMode(mode)}
                style={{ background: dataMode === mode ? C.accent : C.bgHover, border: `1px solid ${dataMode === mode ? C.accent : C.border}`, borderRadius: C.radiusSm, padding: '3px 10px', color: dataMode === mode ? '#fff' : C.textSecond, fontSize: 12, fontWeight: dataMode === mode ? 600 : 400, cursor: 'pointer', fontFamily: C.font }}
              >
                {mode === 'same' ? 'Same data' : 'Random data'}
              </button>
            ))}
          </div>

          {flows.map((flow) => (
            <div key={flow.id} style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: C.bgSubtle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>{flow.name}</span>
                {pill(`${flow.stepCount} steps`, C.textSecond, C.bgHover)}
                <button
                  onClick={() => startReplay(flow)}
                  disabled={replaying === flow.id}
                  style={{ background: replaying === flow.id ? C.bgHover : C.green, border: 'none', borderRadius: C.radiusSm, padding: '4px 10px', color: replaying === flow.id ? C.textSecond : '#fff', fontSize: 11, fontWeight: 600, cursor: replaying === flow.id ? 'not-allowed' : 'pointer', fontFamily: C.font }}
                >
                  {replaying === flow.id ? '⏳' : `▶ Run ${replayCount}×`}
                </button>
                <button
                  onClick={() => deleteFlow(flow.id)}
                  style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
                  title="Delete flow"
                >
                  ×
                </button>
              </div>
              <div style={{ padding: '4px 12px 6px', fontSize: 11, color: C.textSecond }}>
                {new Date(flow.createdAt).toLocaleDateString()} · {flow.domain}
              </div>
            </div>
          ))}
        </div>
      )}

      {flows.length === 0 && !recording && recordedSteps.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 12, paddingTop: 12 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔄</div>
          No flows saved yet.<br />Hit Record, run a task in Chat, then save it.
        </div>
      )}

      {/* ── Replay Log ── */}
      {replayLog.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: 'hidden' }}>
          <div style={{ padding: '6px 12px', background: C.bgSubtle, fontSize: 11, fontWeight: 600, color: C.textSecond, borderBottom: `1px solid ${C.borderLight}` }}>
            Replay Log
          </div>
          <div style={{ padding: '6px 0', maxHeight: 200, overflowY: 'auto' }}>
            {replayLog.filter((e) => e.type === 'run_start' || e.type === 'run_done').map((e, i) => (
              <div key={i} style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.borderLight}`, fontSize: 11 }}>
                <span style={{ color: C.textMuted, fontFamily: C.fontMono, minWidth: 24 }}>#{(e.runIndex ?? 0) + 1}</span>
                {e.type === 'run_start' ? (
                  <span style={{ color: C.textSecond }}>⏳ Running…</span>
                ) : e.result?.ok ? (
                  <>
                    {pill('PASS', C.green, '#e6f4ea')}
                    <span style={{ color: C.textSecond }}>{e.result.durationMs}ms</span>
                    <span style={{ color: C.textMuted, fontFamily: C.fontMono, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.result.testData?.email}</span>
                  </>
                ) : (
                  <>
                    {pill('FAIL', C.red, '#fce8e6')}
                    <span style={{ color: C.red, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.result?.error}</span>
                  </>
                )}
              </div>
            ))}
            {replayLog.find((e) => e.type === 'all_done') && (
              <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, color: C.text }}>
                {(() => {
                  const done = replayLog.find((e) => e.type === 'all_done');
                  const passed = (done?.results ?? []).filter((r: any) => r.ok).length;
                  const total  = (done?.results ?? []).length;
                  return `✅ ${passed}/${total} passed`;
                })()}
              </div>
            )}
            <div ref={logRef} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UI Mods Panel ────────────────────────────────────────────────────────────

function UIModsPanel() {
  const [domain, setDomain] = useState('');
  const [scripts, setScripts] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState('');

  React.useEffect(() => {
    chrome.storage.local.get('gemini_api_key', (r) => { if (r.gemini_api_key) setApiKey(r.gemini_api_key); });
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url) {
        const d = new URL(tab.url).hostname;
        setDomain(d);
        chrome.storage.local.get(`hawkeye_css_${d}`, (r) => {
          setScripts(r[`hawkeye_css_${d}`] ?? []);
        });
      }
    });
  }, []);

  const applyChange = async () => {
    if (!input.trim() || applying) return;
    setApplying(true);
    setStatus('');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setApplying(false); return; }

    // Ask agent to apply the UI change via run_js
    chrome.runtime.sendMessage({
      type: 'AGENT_RUN',
      tabId: tab.id,
      payload: {
        task: `Apply this UI change to the current page using insert_css: ${input}. Use a single insert_css call with valid CSS rules. Keep it simple.`,
        apiKey,
        provider: 'gemini',
      },
    });

    const listener = (msg: any) => {
      if (msg.type === 'AGENT_DONE' || msg.type === 'AGENT_ERROR') {
        setApplying(false);
        setInput('');
        setStatus(msg.type === 'AGENT_DONE' ? '✓ Applied' : `❌ ${msg.payload.error}`);
        setTimeout(() => setStatus(''), 3000);
        // Refresh script list
        chrome.storage.local.get(`hawkeye_css_${domain}`, (r) => {
          setScripts(r[`hawkeye_css_${domain}`] ?? []);
        });
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  };

  const removeScript = async (index: number) => {
    const updated = scripts.filter((_, i) => i !== index);
    await chrome.storage.local.set({ [`hawkeye_css_${domain}`]: updated });
    setScripts(updated);
    // Reload tab to re-apply remaining
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  const clearAll = async () => {
    await chrome.storage.local.remove(`hawkeye_css_${domain}`);
    setScripts([]);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  return (
    <div style={{ padding: 14, fontFamily: C.font, display: 'flex', flexDirection: 'column', gap: 12, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecond, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        UI Modifications — {domain || 'current page'}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'Describe a change, e.g.:\n"Make the background light blue"\n"Hide the cookie banner"\n"Make headings red and bold"'}
          rows={3}
          style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, padding: '8px 10px', fontSize: 12, color: C.text, outline: 'none', fontFamily: C.font, resize: 'vertical', background: C.bg }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={applyChange}
            disabled={!input.trim() || applying || !apiKey}
            style={{ background: C.accent, border: 'none', borderRadius: C.radiusSm, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: C.font, opacity: (!input.trim() || applying || !apiKey) ? 0.5 : 1 }}
          >
            {applying ? '⏳ Applying…' : '✨ Apply'}
          </button>
          {status && <span style={{ fontSize: 11, color: status.startsWith('✓') ? C.green : C.red }}>{status}</span>}
          {!apiKey && <span style={{ fontSize: 11, color: C.red }}>Set API key in Settings</span>}
        </div>
      </div>

      {/* Active modifications */}
      {scripts.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: 'hidden' }}>
          <div style={{ padding: '6px 12px', background: C.bgSubtle, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.borderLight}` }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.textSecond, flex: 1 }}>Active Modifications ({scripts.length})</span>
            <button onClick={clearAll} style={{ background: 'none', border: 'none', fontSize: 11, color: C.red, cursor: 'pointer', fontFamily: C.font }}>Clear all</button>
          </div>
          {scripts.map((s, i) => (
            <div key={i} style={{ padding: '6px 12px', borderBottom: i < scripts.length - 1 ? `1px solid ${C.borderLight}` : 'none', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ flex: 1, fontSize: 10, color: C.textSecond, fontFamily: C.fontMono, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
                {s.slice(0, 120)}{s.length > 120 ? '…' : ''}
              </span>
              <button onClick={() => removeScript(i)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      {scripts.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 12, paddingTop: 8 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🎨</div>
          No active modifications.<br />Changes persist across page reloads.
        </div>
      )}
    </div>
  );
}

// ─── Network Panel ────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = { GET: C.green, POST: C.accent, PUT: C.yellow, PATCH: C.yellow, DELETE: C.red };

function NetworkPanel() {
  const [requests, setRequests] = useState<any[]>([]);

  React.useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_NETWORK_DATA' }, (res) => {
      if (res?.data) setRequests(res.data.slice(-50));
    });
  }, []);

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: C.font }}>
      {/* Toolbar */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', background: C.bgSubtle }}>
        <span style={{ fontSize: 12, color: C.textSecond, fontWeight: 500 }}>Captured Requests</span>
        <span style={{ marginLeft: 8, background: C.accentBg, color: C.accent, borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>{requests.length}</span>
      </div>

      {requests.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12, marginTop: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🌐</div>
          No requests captured yet.<br />Browse the page to see activity.
        </div>
      ) : (
        <div style={{ padding: '8px 0' }}>
          {requests.map((r, i) => {
            let path = r.url;
            try { path = new URL(r.url).pathname; } catch {}
            return (
              <div key={i} style={{ padding: '5px 12px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 10, color: METHOD_COLORS[r.method] ?? C.textSecond, minWidth: 36, fontFamily: C.fontMono }}>{r.method}</span>
                <span style={{ flex: 1, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: C.fontMono }}>{path}</span>
                {r.status && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: r.status < 400 ? C.green : C.red, fontFamily: C.fontMono }}>{r.status}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function InputField({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, color: C.textSecond, fontWeight: 500 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: C.radiusSm, padding: '7px 10px', color: C.text, fontSize: 13, outline: 'none', fontFamily: C.font, width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  );
}

function SettingsPanel() {
  const [token, setToken] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [saved, setSaved] = useState(false);

  React.useEffect(() => {
    chrome.storage.local.get(['token', 'gemini_api_key'], (res) => {
      if (res.token) setToken(res.token);
      if (res.gemini_api_key) setGeminiKey(res.gemini_api_key);
    });
  }, []);

  const save = () => {
    chrome.storage.local.set({ token, gemini_api_key: geminiKey }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.font }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0 }}>Settings</p>

      <InputField label="Gemini API Key" value={geminiKey} onChange={setGeminiKey} placeholder="AIza…" type="password" />
      <InputField label="Hawkeye API Token (JWT)" value={token} onChange={setToken} placeholder="eyJ…" type="password" />

      <button
        onClick={save}
        style={{ background: saved ? C.green : C.accent, border: 'none', borderRadius: C.radiusSm, padding: '8px 16px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: C.font, transition: 'background 0.2s' }}
      >
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: C.textSecond }}>Hawkeye API</span>
          <span style={{ color: C.text, fontFamily: C.fontMono }}>localhost:3001</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: C.textSecond }}>Model</span>
          <span style={{ color: C.text, fontFamily: C.fontMono }}>gemini-2.5-flash</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted }}>
          Get a Gemini key at <span style={{ color: C.accent }}>aistudio.google.com</span>
        </div>
      </div>
    </div>
  );
}
