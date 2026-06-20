/**
 * Content script entry — bootstraps all content-side modules
 */
import { initPageObserver } from './page-observer.js';
import { initElementPicker } from './element-picker.js';
import { initInteractionRecorder } from './interaction-recorder.js';

initPageObserver();
initElementPicker();
initInteractionRecorder();

// Re-apply any persisted CSS rules for this domain
const domain = location.hostname;
if (domain) {
  const key = `hawkeye_css_${domain}`;
  try {
    chrome.storage.local.get(key, (res) => {
      if (chrome.runtime.lastError) return;
      const rules: string[] = res[key] ?? [];
      if (rules.length === 0) return;
      const inject = () => {
        const style = document.createElement('style');
        style.setAttribute('data-hawkeye', 'persisted');
        style.textContent = rules.join('\n');
        (document.head ?? document.documentElement)?.appendChild(style);
        console.log(`[Hawkeye] Re-applied ${rules.length} persisted CSS rule(s) on ${domain}`);
      };
      if (document.head || document.documentElement) {
        inject();
      } else {
        document.addEventListener('DOMContentLoaded', inject, { once: true });
      }
    });
  } catch {
    // Extension was reloaded while this content script was still alive.
  }
}

console.log('[Hawkeye] Content script loaded on', location.href);
