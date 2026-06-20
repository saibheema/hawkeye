type PersistedDomMutation = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
};

let applying = false;
let applyTimer: ReturnType<typeof setTimeout> | null = null;

export function initPersistedDomMutations() {
  const domain = location.hostname;
  if (!domain) return;

  const scheduleApply = () => {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => void applyPersistedDomMutations(domain), 250);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
  } else {
    scheduleApply();
  }

  const attachObserver = () => {
    const root = document.body ?? document.documentElement;
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (!applying) scheduleApply();
    });
    observer.observe(root, { childList: true, subtree: true });
  };

  if (document.body) attachObserver();
  else document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
}

async function applyPersistedDomMutations(domain: string) {
  if (applying) return;
  applying = true;
  try {
    const key = `hawkeye_dom_mutations_${domain}`;
    chrome.storage.local.get(key, (res) => {
      try {
        const mutations: PersistedDomMutation[] = res[key] ?? [];
        for (const mutation of mutations) applyMutation(mutation);
      } finally {
        applying = false;
      }
    });
  } catch {
    applying = false;
  }
}

function applyMutation(mutation: PersistedDomMutation) {
  switch (mutation.tool) {
    case 'dom_op':
      applyDomOp(mutation.args);
      break;
    case 'replace_text':
      applyReplaceText(mutation.args);
      break;
    case 'style_by_text':
      applyStyleByText(mutation.args);
      break;
    case 'set_style':
      applySetStyle(mutation.args);
      break;
    case 'set_placeholder_by_label':
      applyPlaceholderByLabel(mutation.args);
      break;
    case 'set_css_var':
      applyCssVar(mutation.args);
      break;
  }
}

function applyDomOp(args: Record<string, unknown>) {
  const selector = String(args.selector ?? '');
  if (!selector) return;
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  for (const el of els) {
    const op = String(args.op ?? '');
    const value = String(args.value ?? '');
    const attr = String(args.attr ?? '');
    switch (op) {
      case 'set_text':     el.innerText = value; break;
      case 'set_html':     el.innerHTML = value; break;
      case 'set_attr':     if (attr) el.setAttribute(attr, value); break;
      case 'remove_attr':  if (attr) el.removeAttribute(attr); break;
      case 'remove':       el.remove(); break;
      case 'add_class':    if (value) el.classList.add(value); break;
      case 'remove_class': if (value) el.classList.remove(value); break;
    }
  }
}

function applySetStyle(args: Record<string, unknown>) {
  const selector = String(args.selector ?? '');
  const property = String(args.property ?? '');
  const value = String(args.value ?? '');
  if (!selector || !property) return;
  const prop = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const el of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
    (el.style as any)[prop] = value;
  }
}

function applyCssVar(args: Record<string, unknown>) {
  const variable = String(args.variable ?? '');
  const value = String(args.value ?? '');
  const selector = typeof args.selector === 'string' ? args.selector : '';
  if (!variable) return;
  const targets = selector
    ? Array.from(document.querySelectorAll(selector)) as HTMLElement[]
    : [document.documentElement];
  for (const target of targets) target.style.setProperty(variable, value);
}

function applyReplaceText(args: Record<string, unknown>) {
  const find = String(args.find ?? '');
  const replace = String(args.replace ?? '');
  if (!find) return;
  const root = document.body ?? document.documentElement;
  if (!root) return;
  const flags = args.case_sensitive ? 'g' : 'gi';
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement?.tagName === 'SCRIPT' || node.parentElement?.tagName === 'STYLE') continue;
    if (pattern.test(node.textContent ?? '')) {
      node.textContent = (node.textContent ?? '').replace(pattern, replace);
    }
  }
}

function applyStyleByText(args: Record<string, unknown>) {
  const text = String(args.text ?? '').trim().toLowerCase();
  const styles = args.styles && typeof args.styles === 'object' ? args.styles as Record<string, string> : {};
  const elementKind = args.elementKind === 'button' ? 'button' : 'any';
  if (!text || Object.keys(styles).length === 0) return;
  const selector = elementKind === 'button'
    ? 'button,a,[role="button"],input[type="button"],input[type="submit"]'
    : 'h1,h2,h3,h4,h5,h6,p,span,label,button,a,[role="button"],input[type="button"],input[type="submit"],div';
  const candidates = (Array.from(document.querySelectorAll(selector)) as HTMLElement[])
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .sort((a, b) => (a.textContent?.trim().length ?? 0) - (b.textContent?.trim().length ?? 0));
  for (const el of candidates) {
    const label = [
      el.innerText,
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      (el as HTMLInputElement).value,
    ].filter(Boolean).join(' ').trim().toLowerCase();
    if (!label.includes(text)) continue;
    if (elementKind !== 'button' && el.children.length > 0 && label !== text) continue;
    for (const [property, value] of Object.entries(styles)) {
      const prop = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      (el.style as any)[prop] = value;
    }
    if (elementKind !== 'button') break;
  }
}

function applyPlaceholderByLabel(args: Record<string, unknown>) {
  const needle = String(args.label ?? '').trim().toLowerCase()
    .replace(/\b(?:text\s*box|textbox|input|field|label|placeholder)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const placeholder = String(args.placeholder ?? '');
  if (!needle) return;

  const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea')) as Array<HTMLInputElement | HTMLTextAreaElement>;
  for (const field of fields) {
    const type = field instanceof HTMLInputElement ? field.type : 'textarea';
    if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type)) continue;
    if (!associatedLabel(field).includes(needle)) continue;
    field.setAttribute('placeholder', placeholder);
  }
}

function associatedLabel(el: HTMLInputElement | HTMLTextAreaElement): string {
  const textOf = (node: Element | null) => node?.textContent?.trim() ?? '';
  const parts: string[] = [];
  if (el.id) parts.push(textOf(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
  parts.push(textOf(el.closest('label')));
  parts.push(el.getAttribute('aria-label') ?? '');
  parts.push(el.getAttribute('placeholder') ?? '');
  parts.push(el.name ?? '');
  parts.push(el.id ?? '');
  parts.push(textOf(el.previousElementSibling));
  parts.push(textOf(el.parentElement));
  parts.push(textOf(el.closest('div, section, form, fieldset')));
  return parts.filter(Boolean).join(' ').toLowerCase();
}
