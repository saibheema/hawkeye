/**
 * Script Runner — executes agent-generated automation scripts
 * Uses blob URL injection for isolation from extension context
 */

const runningScripts = new Map<string, HTMLScriptElement>();

export function runScript(code: string, runId: string): void {
  // Remove any previous run with same ID
  stopScript(runId);

  try {
    const wrappedCode = `
(async () => {
  const __runId__ = ${JSON.stringify(runId)};
  try {
    ${code}
    window.postMessage({ type: 'HAWKEYE_RUN_COMPLETE', runId: __runId__, ok: true }, '*');
  } catch (err) {
    window.postMessage({ type: 'HAWKEYE_RUN_ERROR', runId: __runId__, error: err.message }, '*');
  }
})();
`;

    const blob = new Blob([wrappedCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);

    const script = document.createElement('script');
    script.src = url;
    script.dataset.hawkeyeRunId = runId;
    script.onload = () => {
      URL.revokeObjectURL(url);
      runningScripts.delete(runId);
    };
    script.onerror = (e) => {
      URL.revokeObjectURL(url);
      runningScripts.delete(runId);
      window.postMessage({
        type: 'HAWKEYE_RUN_ERROR',
        runId,
        error: `Script load error: ${e}`,
      }, '*');
    };

    runningScripts.set(runId, script);
    (document.head || document.documentElement).appendChild(script);
  } catch (err: any) {
    window.postMessage({
      type: 'HAWKEYE_RUN_ERROR',
      runId,
      error: err.message ?? String(err),
    }, '*');
  }
}

export function stopScript(runId: string): void {
  const script = runningScripts.get(runId);
  if (script) {
    script.remove();
    runningScripts.delete(runId);
  }
}

// Forward script completion events to the extension
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('HAWKEYE_RUN_')) return;
  chrome.runtime.sendMessage(event.data, () => { void chrome.runtime.lastError; });
});
