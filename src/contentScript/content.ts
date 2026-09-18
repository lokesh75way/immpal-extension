// Content script injected into external sites and Immpal frontend

let isPaused = false;
chrome.storage.local.get(["isPaused"], (res) => {
  if (res.isPaused) isPaused = true;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.isPaused !== undefined) {
    isPaused = !!changes.isPaused.newValue;
  }
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedField {
  fieldKey: string;
  id: string;
  name: string;
  type: string;
  label: string;
  placeholder: string;
  currentValue: string;
  options?: string[];
}

export interface PageContext {
  url: string;
  title: string;
  headings: string[];
  mainText: string[];
  fields: ExtractedField[];
}

// ---------------------------------------------------------------------------
// Label resolution helpers (Kept for context gathering)
// ---------------------------------------------------------------------------

function resolveLabel(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (explicit) return explicit.textContent?.trim() ?? "";
  }

  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
    const text = clone.textContent?.trim() ?? "";
    if (text) return text;
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => document.getElementById(refId)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  const parent = el.parentElement;
  if (parent) {
    let sibling: Element | null = el.previousElementSibling;
    while (sibling) {
      const text = sibling.textContent?.trim() ?? "";
      if (text) return text;
      sibling = sibling.previousElementSibling;
    }
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() ?? "";
        if (text) return text;
      }
      if (node === el) break;
    }
  }

  // Check table cells (very common in forms like Roboform)
  const td = el.closest("td");
  if (td) {
    let prevTd = td.previousElementSibling as HTMLElement;
    while (prevTd) {
      const text = prevTd.textContent?.trim();
      if (text && text.length < 100) return text;
      prevTd = prevTd.previousElementSibling as HTMLElement;
    }
  }

  // Check sibling divs (e.g., <div class="label">Name</div> <div><input></div>)
  const wrapperDiv = el.closest("div");
  if (wrapperDiv && wrapperDiv.parentElement) {
    let prevDiv = wrapperDiv.previousElementSibling as HTMLElement;
    while (prevDiv) {
      const text = prevDiv.textContent?.trim();
      if (text && text.length < 100) return text;
      prevDiv = prevDiv.previousElementSibling as HTMLElement;
    }
  }

  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  return "";
}

// ---------------------------------------------------------------------------
// Per-type extractors
// ---------------------------------------------------------------------------

function extractInputField(el: HTMLInputElement, index: number): ExtractedField | null {
  const type = el.type.toLowerCase();
  if (["hidden", "submit", "button", "reset", "image"].includes(type)) return null;

  const id = el.id || "";
  const name = el.name || "";
  const label = resolveLabel(el);
  const placeholder = el.placeholder || "";
  
  const fieldKey = type === "radio" 
    ? (name || `radio_${index}`)
    : (id || name || `field_${type}_${index}`);
  
  el.setAttribute("data-immpal-key", fieldKey);

  if (type === "checkbox") {
    return {
      fieldKey, id, name, type: "checkbox", label, placeholder,
      currentValue: el.checked ? "true" : "false",
    };
  }

  if (type === "radio") {
    const group = document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(name)}"]`
    );
    const options = Array.from(group).map((r) => resolveLabel(r) || r.value);
    const checked = Array.from(group).find((r) => r.checked);
    return {
      fieldKey, id, name, type: "radio", label, placeholder,
      currentValue: checked ? resolveLabel(checked) || checked.value : "",
      options,
    };
  }

  return {
    fieldKey, id, name, type, label, placeholder,
    currentValue: el.value || "",
  };
}

function extractSelectField(el: HTMLSelectElement, index: number): ExtractedField {
  const id = el.id || "";
  const name = el.name || "";
  const fieldKey = id || name || `select_${index}`;
  el.setAttribute("data-immpal-key", fieldKey);
  
  const options = Array.from(el.options)
    .filter((o) => o.value !== "")
    .map((o) => o.text.trim());

  return {
    fieldKey, id, name, type: "select", label: resolveLabel(el), placeholder: "",
    currentValue: el.options[el.selectedIndex]?.text.trim() ?? "", options,
  };
}

function extractTextareaField(el: HTMLTextAreaElement, index: number): ExtractedField {
  const id = el.id || "";
  const name = el.name || "";
  const fieldKey = id || name || `textarea_${index}`;
  el.setAttribute("data-immpal-key", fieldKey);
  return {
    fieldKey, id, name, type: "textarea", label: resolveLabel(el),
    placeholder: el.placeholder || "", currentValue: el.value || "",
  };
}

// ---------------------------------------------------------------------------
// Field Extractor + automatic page-change detection
// ---------------------------------------------------------------------------

let timeoutId: number | null = null;
let lastSentFingerprint: string | null = null;

function extractField(target: HTMLElement): ExtractedField | null {
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input') return extractInputField(target as HTMLInputElement, 0);
  if (tagName === 'select') return extractSelectField(target as HTMLSelectElement, 0);
  if (tagName === 'textarea') return extractTextareaField(target as HTMLTextAreaElement, 0);
  return null;
}

/** First visible, empty, fillable field on the page -- used when no focus event has fired yet. */
function findFirstFillableField(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false; // hidden
    if ((el as HTMLInputElement).disabled) return false;
    const type = (el as HTMLInputElement).type?.toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;
    return true;
  });
  return candidates[0] ?? null;
}

let highlightedEl: HTMLElement | null = null;

/** Visually marks whichever field the Copilot just detected, so it's unambiguous
 *  which question is being read -- especially important for checkboxes/radios
 *  (a quick click) and file inputs (focus fires, then a native OS dialog opens). */
function highlightField(el: HTMLElement) {
  if (highlightedEl && highlightedEl !== el) {
    highlightedEl.style.outline = "";
    highlightedEl.style.outlineOffset = "";
  }
  el.style.outline = "2px solid #7c3aed";
  el.style.outlineOffset = "2px";
  highlightedEl = el;
}

function sendDetection(field: ExtractedField, fingerprint: string) {
  if (fingerprint === lastSentFingerprint) return; // avoid duplicate sends for the same question
  lastSentFingerprint = fingerprint;

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map(h => h.textContent?.trim() ?? "")
    .filter(text => text.length > 0);

  const mainText = Array.from(document.querySelectorAll("p, legend, .question-text"))
    .map(p => p.textContent?.trim() ?? "")
    .filter(text => text.length > 0 && text.length < 500);

  const context: PageContext = {
    url: window.location.href,
    title: document.title,
    headings: Array.from(new Set(headings)),
    mainText: Array.from(new Set(mainText)).slice(0, 10),
    fields: [field],
  };

  chrome.runtime.sendMessage({ type: "DETECT_QUESTION", payload: context });
  noteActivity();
}

function onFieldFocused(target: HTMLElement) {
  if (isPaused) return;
  const field = extractField(target);
  if (!field) return;
  highlightField(target);
  sendDetection(field, `focus:${field.fieldKey}`);
}

/** Automatic reaction to page changes (no focus event required) -- fires when the rendered page's fillable field changes, e.g. after an SPA route transition or dynamically rendered question. */
function onPageMayHaveChanged() {
  if (isPaused) return;
  const target = findFirstFillableField();
  if (!target) {
    checkForCompletionSignal();
    return;
  }
  const field = extractField(target);
  if (!field) return;
  highlightField(target);
  sendDetection(field, `page:${window.location.href}:${field.fieldKey}`);
}

// Listen for focus events on the document
document.body.addEventListener('focusin', (e) => {
  const target = e.target as HTMLElement;
  const tagName = target?.tagName?.toLowerCase();

  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
    if (timeoutId) clearTimeout(timeoutId);
    // Debounce slightly to handle rapid tabbing
    timeoutId = window.setTimeout(() => onFieldFocused(target), 300);
  }
}, true);

// Automatic page-change reaction: DOM mutations (dynamically rendered
// questions/sections) and SPA route changes, so detection does not depend
// solely on the user focusing a field.
let mutationTimeoutId: number | null = null;
const observer = new MutationObserver(() => {
  if (mutationTimeoutId) clearTimeout(mutationTimeoutId);
  mutationTimeoutId = window.setTimeout(onPageMayHaveChanged, 500);
});
observer.observe(document.body, { childList: true, subtree: true });

function patchHistoryForSpaDetection() {
  const fire = () => window.setTimeout(onPageMayHaveChanged, 300);
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = ((...args: Parameters<typeof origPush>) => {
    origPush(...args);
    fire();
  }) as typeof history.pushState;
  history.replaceState = ((...args: Parameters<typeof origReplace>) => {
    origReplace(...args);
    fire();
  }) as typeof history.replaceState;
  window.addEventListener('popstate', fire);
}
patchHistoryForSpaDetection();

// Initial detection on page load, in case a field is already visible before
// any focus or mutation event occurs.
window.setTimeout(onPageMayHaveChanged, 800);

// Re-run detection on demand -- fired by the background script right after a
// case becomes active, so a page opened before any case was selected doesn't
// require a manual refresh to start detecting fields.
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "RECHECK_PAGE") {
    lastSentFingerprint = null; // force a resend even if this exact field was "detected" before a case was active
    onPageMayHaveChanged();
  }
});

// ---------------------------------------------------------------------------
// Session pace: inactivity threshold + positive completion signal
// ---------------------------------------------------------------------------

const INACTIVITY_THRESHOLD_MS = 90_000;
let inactivityTimerId: number | null = null;

function noteActivity() {
  if (inactivityTimerId) clearTimeout(inactivityTimerId);
  inactivityTimerId = window.setTimeout(() => {
    if (isPaused) return;
    chrome.runtime.sendMessage({ type: "INACTIVITY_THRESHOLD" });
  }, INACTIVITY_THRESHOLD_MS);
}
noteActivity();

const COMPLETION_SIGNAL_PATTERNS = [
  /questionnaire\s+completed/i,
  /confirmation\s+page/i,
  /workflow\s+completed/i,
  /successful\s+submission/i,
  /application\s+(has\s+been\s+)?submitted/i,
  /thank\s+you\s+for\s+your\s+submission/i,
];

/** Non-authoritative heuristic only -- user confirmation remains the generic fallback. */
function checkForCompletionSignal() {
  const bodyText = document.body.innerText.slice(0, 5000);
  if (COMPLETION_SIGNAL_PATTERNS.some((re) => re.test(bodyText))) {
    chrome.runtime.sendMessage({ type: "POSITIVE_COMPLETION_SIGNAL" });
  }
}

// ---------------------------------------------------------------------------
// Auth token bridge
// ---------------------------------------------------------------------------

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "IMMPAL_AUTH_TOKEN" && event.data.token) {
    chrome.runtime.sendMessage({
      type: "SET_TOKEN",
      token: event.data.token,
      refreshToken: event.data.refreshToken,
    });
    window.postMessage({ type: "IMMPAL_AUTH_TOKEN_ACK" }, "*");
  }
});
