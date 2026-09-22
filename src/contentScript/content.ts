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
// Auth token bridge (Initialized immediately at top level)
// ---------------------------------------------------------------------------

function initAuthBridge() {
  console.log("[Immpal Copilot] Initializing Auth Token Bridge...");

  const syncTokens = (token: string, refreshToken?: string) => {
    console.log("[Immpal Copilot] Syncing tokens to background service worker...");
    const payload: { type: string; token: string; refreshToken?: string } = {
      type: "SET_TOKEN",
      token,
    };
    if (refreshToken) {
      payload.refreshToken = refreshToken;
    }

    chrome.runtime.sendMessage(payload, (res) => {
      console.log("[Immpal Copilot] Background SET_TOKEN response:", res);
    });

    // Send acknowledgement back to web app immediately
    window.postMessage({ type: "IMMPAL_AUTH_TOKEN_ACK" }, "*");
  };

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "IMMPAL_AUTH_TOKEN" && event.data.token) {
      console.log("[Immpal Copilot] Intercepted IMMPAL_AUTH_TOKEN from web app!");
      syncTokens(event.data.token, event.data.refreshToken);
    }
  });

  // Proactive sync if running on an Immpal extension-auth page
  try {
    const localToken = window.localStorage?.getItem("access_token");
    const localRefresh = window.localStorage?.getItem("refresh_token") || undefined;
    if (localToken && window.location.hash.includes("extension-auth")) {
      console.log("[Immpal Copilot] Proactively syncing access_token from localStorage on auth page...");
      syncTokens(localToken, localRefresh);
    }
  } catch (err) {
    console.warn("[Immpal Copilot] Could not check localStorage:", err);
  }

  try {
    window.postMessage({ type: "IMMPAL_EXTENSION_READY" }, "*");
  } catch {}
}

initAuthBridge();

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

export function cleanFieldLabel(label?: string | null): string {
  if (!label) return "";
  return label
    .replace(/^[\s*•\-–—:]+/, "")
    .replace(/\s*\((required|optional|obligatoire|facultatif)\)/gi, "")
    .replace(/\s*-\s*Select\s*(year|month|day)/i, " ($1)")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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

function resolveRadioGroupLabel(el: HTMLInputElement): string {
  const name = el.name;
  const radiogroupContainer = el.closest('[role="radiogroup"]');
  const group: HTMLInputElement[] = name
    ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`))
    : radiogroupContainer
    ? Array.from(radiogroupContainer.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    : [el];

  // Collect all elements that serve as labels for individual options in this group
  const optionLabels = new Set<Element>();
  group.forEach((r) => {
    const wrapping = r.closest("label");
    if (wrapping) optionLabels.add(wrapping);
    if (r.id) {
      document.querySelectorAll(`label[for="${CSS.escape(r.id)}"]`).forEach((l) => optionLabels.add(l));
    }
  });

  // 1. Check fieldset > legend
  const fieldset = el.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend && legend.textContent?.trim()) {
    const cleaned = cleanFieldLabel(legend.textContent);
    if (cleaned) return cleaned;
  }

  // 2. Check aria-labelledby on radiogroup container
  if (radiogroupContainer) {
    const labelledby = radiogroupContainer.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      const cleaned = cleanFieldLabel(text);
      if (cleaned) return cleaned;
    }
    const ariaLabel = radiogroupContainer.getAttribute("aria-label");
    if (ariaLabel?.trim()) return cleanFieldLabel(ariaLabel);
  }

  // 3. Search upward in form-group or question container for the question title
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body) {
    const candidates = current.querySelectorAll(
      "legend, [class*='label'], [class*='title'], [class*='question'], [class*='header'], h1, h2, h3, h4, h5, h6, p, label, strong"
    );
    for (const cand of Array.from(candidates)) {
      // Must not be an option label
      if (optionLabels.has(cand)) continue;
      // Must not contain any of the radio inputs (e.g. an option wrapper div)
      if (group.some((r) => cand.contains(r))) continue;
      // Must not be nested inside an option label
      if (Array.from(optionLabels).some((opt) => opt.contains(cand))) continue;

      const raw = cand.textContent?.trim() || "";
      const cleaned = cleanFieldLabel(raw);
      if (cleaned.length >= 2) {
        return cleaned;
      }
    }

    if (current.matches(".form-group, .form-item, fieldset, [class*='question'], [class*='field'], [class*='row']")) {
      break;
    }
    current = current.parentElement;
  }

  return "";
}

function extractInputField(el: HTMLInputElement, index: number): ExtractedField | null {
  const type = el.type.toLowerCase();
  if (["hidden", "submit", "button", "reset", "image"].includes(type)) return null;

  const id = el.id || "";
  const name = el.name || "";
  const label = cleanFieldLabel(resolveLabel(el));
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
    // Find the overarching question label for this radio group
    const groupLabel = resolveRadioGroupLabel(el);
    const finalLabel = groupLabel || label;
    const options = Array.from(group).map((r) => cleanFieldLabel(resolveLabel(r)) || r.value);
    const checked = Array.from(group).find((r) => r.checked);
    return {
      fieldKey, id, name, type: "radio", label: finalLabel, placeholder,
      currentValue: checked ? cleanFieldLabel(resolveLabel(checked)) || checked.value : "",
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
  
  let label = resolveLabel(el);
  const fieldset = el.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend && legend.textContent?.trim() && !label.toLowerCase().includes(legend.textContent.trim().toLowerCase())) {
    label = `${legend.textContent.trim()} - ${label}`;
  } else {
    const container = el.closest(".form-group, .question, [class*='question'], [class*='date'], [class*='field']");
    const heading = container?.querySelector("legend, h2, h3, h4, p, [class*='label'], [class*='title']");
    if (heading && heading !== el.closest("label") && heading.textContent?.trim() && !label.toLowerCase().includes(heading.textContent.trim().toLowerCase())) {
      label = `${heading.textContent.trim()} - ${label}`;
    }
  }

  const options = Array.from(el.options)
    .filter((o) => o.value !== "")
    .map((o) => o.text.trim());

  return {
    fieldKey, id, name, type: "select", label, placeholder: "",
    currentValue: el.options[el.selectedIndex]?.text.trim() ?? "", options,
  };
}

function extractTextareaField(el: HTMLTextAreaElement, index: number): ExtractedField {
  const id = el.id || "";
  const name = el.name || "";
  const fieldKey = id || name || `textarea_${index}`;
  el.setAttribute("data-immpal-key", fieldKey);

  let label = resolveLabel(el);
  if (!label) {
    const container = el.closest(".form-group, .question, [class*='question'], [class*='field']");
    const heading = container?.querySelector("legend, label, h2, h3, h4, p, [class*='label'], [class*='title']");
    if (heading && heading.textContent?.trim()) {
      label = heading.textContent.trim();
    }
  }

  return {
    fieldKey, id, name, type: "textarea", label,
    placeholder: el.placeholder || "", currentValue: el.value || "",
  };
}

// ---------------------------------------------------------------------------
// Field Extractor + automatic page-change detection
// ---------------------------------------------------------------------------

let timeoutId: number | null = null;

function extractField(target: HTMLElement): ExtractedField | null {
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input') return extractInputField(target as HTMLInputElement, 0);
  if (tagName === 'select') return extractSelectField(target as HTMLSelectElement, 0);
  if (tagName === 'textarea') return extractTextareaField(target as HTMLTextAreaElement, 0);
  return null;
}

/** Every fillable field currently on the page, deduplicated by fieldKey (a radio
 *  group collapses to one entry). Used so a page/mutation event resolves every
 *  new field in one backend call instead of one field at a time. */
function extractAllFields(): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const seenKeys = new Set<string>();
  let index = 0;

  // Query all three tag types together so results come back in document order --
  // grouping by tag (all inputs, then all selects, then all textareas) would let
  // a later-in-the-array tag type (e.g. an <input>) end up positioned before an
  // earlier-on-page <select>/<textarea>, breaking position-based "next field"
  // logic like advanceToNextField().
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea'
  ).forEach((el) => {
    const tagName = el.tagName.toLowerCase();
    const field =
      tagName === 'input'
        ? extractInputField(el as HTMLInputElement, index++)
        : tagName === 'select'
        ? extractSelectField(el as HTMLSelectElement, index++)
        : extractTextareaField(el as HTMLTextAreaElement, index++);
    if (!field || seenKeys.has(field.fieldKey)) return;
    seenKeys.add(field.fieldKey);
    fields.push(field);
  });

  return fields;
}

/** First visible, empty, fillable field on the page -- used when no focus event has fired yet. */
function findFirstFillableField(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('input, select, textarea')
  ).filter((el) => {
    if ((el as HTMLInputElement).disabled) return false;
    const type = (el as HTMLInputElement).type?.toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // Check if this input has a visible label or container (common for custom radios/checkboxes)
      const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (label && label.getBoundingClientRect().width > 0) return true;
      const container = el.closest('fieldset, .radio, .checkbox, [role="radiogroup"]');
      if (container && container.getBoundingClientRect().width > 0) return true;
      return false;
    }
    return true;
  });
  return candidates[0] ?? null;
}

/** Finds the corresponding input/select/textarea when the user clicks anywhere in/near a question.
 *
 * Two earlier versions of this tried to infer scope from DOM ancestry (the
 * closest label, then the closest fieldset/form-group/container) and both
 * turned out to be unreliable on this portal: whatever wraps a bare trailing
 * field (like an optional one with no fieldset of its own) apparently spans
 * much more than that one question, so "first/nearest input found inside the
 * matched ancestor" kept resolving to a completely different field (always
 * the first question on the page). Rather than keep guessing at which
 * selector is too broad, this is now structure-agnostic: it trusts an
 * unambiguous `label[for]` link, and otherwise picks whichever visible field
 * is physically closest to the click ON SCREEN, regardless of how the DOM is
 * nested. */
function findNearestInputField(target: HTMLElement): HTMLElement | null {
  const tagName = target.tagName.toLowerCase();
  if (['input', 'select', 'textarea'].includes(tagName)) {
    const type = (target as HTMLInputElement).type?.toLowerCase();
    if (!['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
      return target;
    }
  }

  // An explicit label[for=...] link is unambiguous -- trust it before anything else.
  const label = target.closest('label');
  if (label?.htmlFor) {
    const el = document.getElementById(label.htmlFor);
    if (el) return el;
  }

  const targetRect = target.getBoundingClientRect();
  const targetY = targetRect.top + targetRect.height / 2;
  const targetX = targetRect.left + targetRect.width / 2;

  let closest: HTMLElement | null = null;
  let closestDistance = Infinity;
  document
    .querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea'
    )
    .forEach((el) => {
      let rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Visually-hidden native control behind a custom-styled indicator
        // (a common accessible pattern for radios/checkboxes) -- measure by
        // its label/container instead of skipping it outright.
        const proxy =
          el.closest('label') ||
          (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ||
          el.closest('fieldset, .radio, .checkbox, [role="radiogroup"]');
        if (!proxy) return;
        rect = proxy.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
      }
      const dx = rect.left + rect.width / 2 - targetX;
      const dy = rect.top + rect.height / 2 - targetY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = el;
      }
    });

  // A generous cutoff (roughly one form row) so a click nowhere near any
  // field (e.g. a page heading, a footer link) doesn't grab whatever field
  // happens to be nearest even though it isn't actually related.
  return closest && closestDistance < 300 ? closest : null;
}

let highlightedEl: HTMLElement | null = null;

/** Visually marks whichever field the Copilot just detected, so it's unambiguous
 *  which question is being read -- especially important for checkboxes/radios
 *  (a quick click) and file inputs (focus fires, then a native OS dialog opens). */
function highlightField(el: HTMLElement) {
  if (highlightedEl && highlightedEl !== el) {
    highlightedEl.style.outline = "";
    highlightedEl.style.outlineOffset = "";
    highlightedEl.style.boxShadow = "";
  }
  let targetToHighlight: HTMLElement = el;
  if (el.tagName.toLowerCase() === "input" && (el as HTMLInputElement).type === "radio") {
    const container = el.closest("fieldset, [role='radiogroup'], .form-group") as HTMLElement | null;
    if (container) {
      targetToHighlight = container;
    }
  }
  targetToHighlight.style.outline = "2px solid #2563EB";
  targetToHighlight.style.outlineOffset = "2px";
  targetToHighlight.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.2)";
  targetToHighlight.style.transition = "outline 0.2s ease, box-shadow 0.2s ease";
  highlightedEl = targetToHighlight;
}

/** Visual feedback animation when an element is automatically filled by Immpal */
function flashFilledFeedback(el: HTMLElement) {
  const originalOutline = el.style.outline;
  const originalBoxShadow = el.style.boxShadow;
  const originalTransition = el.style.transition;

  el.style.transition = "outline 0.3s ease, box-shadow 0.3s ease";
  el.style.outline = "2px solid #10B981";
  el.style.outlineOffset = "2px";
  el.style.boxShadow = "0 0 0 5px rgba(16, 185, 129, 0.3)";

  window.setTimeout(() => {
    el.style.outline = originalOutline;
    el.style.boxShadow = originalBoxShadow;
    el.style.transition = originalTransition;
  }, 1400);
}

/** Builds the page-level context (url/title/headings/mainText) shared by every
 *  request that resolves fields, whether triggered by Focus Assist's detection
 *  loop or an explicit Autofill run. */
function buildPageContext(fields: ExtractedField[]): PageContext {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map(h => h.textContent?.trim() ?? "")
    .filter(text => text.length > 0);

  const mainText = Array.from(document.querySelectorAll("p, legend, .question-text"))
    .map(p => p.textContent?.trim() ?? "")
    .filter(text => text.length > 0 && text.length < 500);

  return {
    url: window.location.href,
    title: document.title,
    headings: Array.from(new Set(headings)),
    mainText: Array.from(new Set(mainText)).slice(0, 10),
    fields,
  };
}

// Keys already sent for resolution (or currently in flight) -- so re-running
// extraction on every mutation only ever resolves genuinely new fields instead
// of re-sending the whole form (and a fresh backend/LLM call) every time.
const knownFieldKeys = new Set<string>();

function safeSendMessage(payload: any, responseCallback?: (res: any) => void) {
  try {
    if (!chrome?.runtime?.id) return;
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) return;
      responseCallback?.(res);
    });
  } catch {
    // Context invalidated, ignore safely
  }
}

/** Sends every not-yet-seen field to the background in a single batch for resolution. */
function resolveNewFields(fields: ExtractedField[]) {
  const newFields = fields.filter((f) => !knownFieldKeys.has(f.fieldKey));
  if (newFields.length === 0) return;
  newFields.forEach((f) => knownFieldKeys.add(f.fieldKey));

  safeSendMessage({ type: "RESOLVE_FIELDS_BATCH", payload: buildPageContext(newFields) });
  noteActivity();
}

function onFieldFocused(target: HTMLElement) {
  if (isPaused) return;
  const field = extractField(target);
  if (!field) return;
  highlightField(target);
  // Covers a field that appeared after the last batch was sent (e.g. focused
  // immediately after being dynamically rendered, before the mutation observer fired).
  resolveNewFields(extractAllFields());
  safeSendMessage({ type: "FIELD_FOCUSED", payload: field });
  noteActivity();
}

// Only re-announce the auto-selected "first fillable field" once per distinct
// field, so repeated mutation events on the same page don't keep re-pushing it.
let lastAutoFieldKey: string | null = null;

/** Automatic reaction to page changes (no focus event required) -- fires when the rendered page's fields change. */
function onPageMayHaveChanged() {
  if (isPaused) return;
  const allFields = extractAllFields();
  if (allFields.length === 0) {
    checkForCompletionSignal();
    return;
  }
  resolveNewFields(allFields);

  // Surface the first fillable field automatically so the panel isn't empty
  // before the user has focused anything.
  const target = findFirstFillableField();
  if (!target) return;
  const field = extractField(target);
  if (!field || field.fieldKey === lastAutoFieldKey) return;
  lastAutoFieldKey = field.fieldKey;
  highlightField(target);
  safeSendMessage({ type: "FIELD_FOCUSED", payload: field });
}

let autoAdvanceTimer: number | null = null;
let autoAdvanceEl: HTMLElement | null = null;

function cancelAutoAdvance() {
  if (autoAdvanceTimer !== null) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
    autoAdvanceEl = null;
  }
}

function scheduleAutoAdvance(currentEl: HTMLElement, delayMs = 750) {
  cancelAutoAdvance();
  autoAdvanceEl = currentEl;
  autoAdvanceTimer = window.setTimeout(() => {
    autoAdvanceTimer = null;
    autoAdvanceEl = null;
    advanceToNextField(currentEl);
  }, delayMs);
}

// 1. Listen for focus events on inputs
document.body.addEventListener('focusin', (e) => {
  const target = e.target as HTMLElement;
  const tagName = target?.tagName?.toLowerCase();

  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
    // If the user manually focused a different field, cancel any pending auto-advance
    if (autoAdvanceTimer && target !== autoAdvanceEl) {
      cancelAutoAdvance();
    }
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => onFieldFocused(target), 200);
  }
}, true);

// 2. Listen for clicks anywhere on/near question headings, legends, labels, or options
document.body.addEventListener('click', (e) => {
  if (isPaused) return;
  const target = e.target as HTMLElement;
  if (!target) return;

  const input = findNearestInputField(target);
  if (input) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => onFieldFocused(input), 150);

    // If clicked on or near a radio button, schedule smooth auto-advance
    if (input.tagName.toLowerCase() === 'input' && (input as HTMLInputElement).type === 'radio') {
      window.setTimeout(() => {
        if ((input as HTMLInputElement).checked) {
          scheduleAutoAdvance(input, 750);
        }
      }, 50);
    } else {
      cancelAutoAdvance();
    }
  } else {
    cancelAutoAdvance();
  }
}, true);

// 3. Listen for change events on inputs (e.g. toggling a radio button or dropdown)
document.body.addEventListener('change', (e) => {
  if (isPaused) return;
  const target = e.target as HTMLElement;
  const tagName = target?.tagName?.toLowerCase();
  if (['input', 'select', 'textarea'].includes(tagName)) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => onFieldFocused(target), 150);

    // When a radio is selected via keyboard or native change, auto-advance
    if (tagName === 'input' && (target as HTMLInputElement).type === 'radio' && (target as HTMLInputElement).checked) {
      scheduleAutoAdvance(target, 750);
    }
  }
}, true);

// 4. Cancel auto-advance if user presses Escape
document.body.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cancelAutoAdvance();
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
  const fire = () => {
    knownFieldKeys.clear();
    lastAutoFieldKey = null;
    safeSendMessage({ type: "PAGE_NAVIGATED" });
    window.setTimeout(onPageMayHaveChanged, 300);
  };
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
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({ status: "pong" });
    return true;
  }
  if (request.type === "RECHECK_PAGE") {
    // Force a resend of every field currently on the page -- fields extracted
    // before a case was active were never actually sent to the backend.
    knownFieldKeys.clear();
    lastAutoFieldKey = null;
    onPageMayHaveChanged();
    sendResponse({ status: "rechecking" });
    return true;
  }
});

// ---------------------------------------------------------------------------
// Autofill mode: DOM-filling helpers
// ---------------------------------------------------------------------------

/**
 * React uses a synthetic event system and overrides native setters.
 * This helper bypasses React to set the value directly on the DOM node,
 * ensuring that when we dispatch 'change', React actually notices it.
 */
function setNativeValue(element: HTMLElement, value: string) {
  try {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (valueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter?.call(element, value);
    } else if (prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else {
      (element as any).value = value;
    }
  } catch (e) {
    console.warn("[Immpal] Failed native setter, falling back to basic assignment", e);
    (element as any).value = value;
  }
}

/**
 * Applies a value to a specific DOM element based on its type.
 * Dispatches necessary events to mimic a real user interaction.
 * Returns true if the value was applied (useful for filtering out unmatched radio options).
 */
function applyValueToElement(inputEl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): boolean {
  if (inputEl.tagName === 'INPUT' && (inputEl as HTMLInputElement).type === 'radio') {
    const radio = inputEl as HTMLInputElement;
    const group = Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radio.name)}"]`)
    );

    const targetVal = (value || "").trim().toLowerCase();
    const targetWords = Array.from(new Set(targetVal.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2)));

    let bestRadio: HTMLInputElement | null = null;
    let bestScore = -1;

    for (const r of (group.length > 0 ? group : [radio])) {
      const rawLabel = resolveLabel(r) || r.value || "";
      const radioLabel = rawLabel.trim().toLowerCase();
      let score = 0;

      if (radioLabel === targetVal || r.value.trim().toLowerCase() === targetVal) {
        score = 1000;
      } else if (targetVal.length >= 4 && (radioLabel.includes(targetVal) || targetVal.includes(radioLabel))) {
        score = 500 + Math.min(radioLabel.length, targetVal.length);
      } else if (targetWords.length > 0) {
        const radioWords = new Set(radioLabel.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2));
        const matched = targetWords.filter(w => radioWords.has(w));
        if (matched.length >= Math.min(2, targetWords.length)) {
          score = matched.length * 50;
        }
      }

      if (score > bestScore && score > 0) {
        bestScore = score;
        bestRadio = r;
      }
    }

    if (bestRadio) {
      bestRadio.checked = true;
      bestRadio.click(); // Dispatch click so single-page apps (like IRCC) show dependent questions!
      bestRadio.dispatchEvent(new Event('input', { bubbles: true }));
      bestRadio.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  if (inputEl.tagName === 'INPUT' && (inputEl as HTMLInputElement).type === 'checkbox') {
    const checkbox = inputEl as HTMLInputElement;
    checkbox.checked = (value === "true" || value === "yes" || value === "1");
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (inputEl.tagName === 'SELECT') {
    const select = inputEl as HTMLSelectElement;
    const targetVal = (value || "").trim().toLowerCase();
    const targetWords = targetVal.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2);

    const optionIndex = Array.from(select.options).findIndex(o => {
      const optText = o.text.trim().toLowerCase();
      const optVal = o.value.trim().toLowerCase();
      if (!optText && !optVal) return false;

      if (optText === targetVal || optVal === targetVal) return true;
      if (targetVal.length >= 4 && (optText.includes(targetVal) || targetVal.includes(optText))) return true;

      const optWords = new Set(optText.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2));
      return targetWords.length > 0 && targetWords.filter(w => optWords.has(w)).length >= Math.min(2, targetWords.length);
    });

    if (optionIndex !== -1) {
      select.selectedIndex = optionIndex;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  // Default: text inputs and textareas
  inputEl.focus();
  setNativeValue(inputEl, value);
  inputEl.setAttribute('value', value); // Ensure HTML attribute updates too

  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  // Real blur (not a dispatched synthetic event) so the host page's own
  // blur-triggered validation/reflow happens now, synchronously -- rather
  // than staying deferred until something else steals focus later (e.g.
  // advanceToNextField focusing the next field), which would make that
  // page reflow land in the middle of the next field's scroll-into-view.
  inputEl.blur();

  return true;
}

// ---------------------------------------------------------------------------
// Autofill summary interfaces
// ---------------------------------------------------------------------------

export interface AutofillSummaryItem {
  key: string;
  label: string;
  value?: string;
  reason?: string;
}

export interface AutofillResultPayload {
  status: "success" | "error";
  message: string;
  summary?: {
    filledCount: number;
    skippedCount: number;
    totalCount: number;
    filledItems: AutofillSummaryItem[];
    skippedItems: AutofillSummaryItem[];
  };
}

async function runMultiPassAutofill(
  caseId: string,
  options?: { onlyEmpty?: boolean }
): Promise<AutofillResultPayload> {
  let totalFilledCount = 0;
  const alreadyFilledKeys = new Set<string>();
  const filledItemsMap = new Map<string, AutofillSummaryItem>();
  const maxPasses = 3;

  for (let pass = 0; pass < maxPasses; pass++) {
    const allFields = extractAllFields();
    // Exclude fields that were already filled in earlier passes of this run
    const pendingFields = allFields.filter((f) => {
      if (alreadyFilledKeys.has(f.fieldKey)) return false;
      if (options?.onlyEmpty) {
        const el = document.querySelector(`[data-immpal-key="${CSS.escape(f.fieldKey)}"]`) as any;
        if (el) {
          if (el.type === "radio") {
            const radios = document.querySelectorAll(`[data-immpal-key="${CSS.escape(f.fieldKey)}"]`);
            const anyChecked = Array.from(radios).some((r: any) => r.checked);
            if (anyChecked) return false;
          } else if (el.tagName === "SELECT") {
            if (el.selectedIndex > 0 && el.value) return false;
          } else if (el.value && String(el.value).trim().length > 0) {
            return false;
          }
        }
      }
      return true;
    });

    if (pendingFields.length === 0) break;

    const context = buildPageContext(pendingFields);
    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "FETCH_AUTOFILL_MAPPING",
          payload: { caseId, ...context },
        },
        (res) => resolve(res)
      );
    });

    if (!response || !response.success || !response.data) {
      if (pass === 0) {
        return {
          status: "error",
          message: response?.message || response?.error || "Failed to get mapping from backend",
        };
      }
      break;
    }

    const data = response.data;
    const fills = data.fills || {};
    let passFilled = 0;

    for (const [fieldKey, fillData] of Object.entries(fills)) {
      const value = (fillData as any).value;
      if (value === undefined || value === null) continue;

      const elements = document.querySelectorAll(`[data-immpal-key="${CSS.escape(fieldKey)}"]`);
      if (elements.length === 0) continue;

      let wasFilled = false;
      elements.forEach((el) => {
        const applied = applyValueToElement(el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value as string);
        if (applied) {
          wasFilled = true;
          flashFilledFeedback(el as HTMLElement);
        }
      });

      if (wasFilled) {
        passFilled++;
        alreadyFilledKeys.add(fieldKey);
        const matching = allFields.find((f) => f.fieldKey === fieldKey);
        filledItemsMap.set(fieldKey, {
          key: fieldKey,
          label: cleanFieldLabel(matching?.label || matching?.name || fieldKey),
          value: String(value),
        });
      }
    }

    totalFilledCount += passFilled;

    // If nothing was filled in this pass, stopping early avoids redundant requests
    if (passFilled === 0) break;

    // Wait 500ms for dynamic portals (like IRCC) to unhide dependent child inputs
    await new Promise((r) => setTimeout(r, 500));

    // Check if new DOM fields appeared
    const updatedFields = extractAllFields();
    const hasNewFields = updatedFields.some((f) => !alreadyFilledKeys.has(f.fieldKey));
    if (!hasNewFields) break;
  }

  const finalAllFields = extractAllFields();
  const skippedItems: AutofillSummaryItem[] = [];

  finalAllFields.forEach((field) => {
    if (!alreadyFilledKeys.has(field.fieldKey)) {
      const el = document.querySelector(`[data-immpal-key="${CSS.escape(field.fieldKey)}"]`) as any;
      let hasManualVal = false;
      if (el?.type === "radio") {
        const radios = document.querySelectorAll(`[data-immpal-key="${CSS.escape(field.fieldKey)}"]`);
        hasManualVal = Array.from(radios).some((r: any) => r.checked);
      } else if (el?.tagName === "SELECT") {
        hasManualVal = el.selectedIndex > 0 && Boolean(el.value);
      } else if (el) {
        hasManualVal = Boolean(el.value && String(el.value).trim().length > 0);
      }

      skippedItems.push({
        key: field.fieldKey,
        label: cleanFieldLabel(field.label || field.name || field.fieldKey),
        reason: hasManualVal ? "Manual entry kept" : "Not specified in your profile",
      });
    }
  });

  const filledItems = Array.from(filledItemsMap.values());
  const skipped = skippedItems.length;

  return {
    status: "success",
    message: `Filled ${totalFilledCount} fields (${skipped} need attention)`,
    summary: {
      filledCount: totalFilledCount,
      skippedCount: skipped,
      totalCount: finalAllFields.length,
      filledItems,
      skippedItems,
    },
  };
}

function findSubmitOrNextButton(): HTMLElement | null {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[name*="continue" i]',
    'button[id*="continue" i]',
    'button[name*="next" i]',
    'button[id*="next" i]',
    'a[class*="continue" i]',
    'button[class*="btn-primary"]',
    'button.primary',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

function focusAndActivateField(el: HTMLElement) {
  let targetInput = el;
  if (el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'radio') {
    const radios = document.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape((el as HTMLInputElement).name)}"]`
    );
    const checked = Array.from(radios).find((r) => r.checked);
    targetInput = checked || radios[0] || el;
  }

  const container = targetInput.closest(
    'fieldset, [role="radiogroup"], .form-group, [class*="question"], [class*="field"]'
  ) as HTMLElement | null;
  const scrollTarget = container || targetInput;
  scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    targetInput.focus({ preventScroll: true });
  } catch {
    // Ignore if not directly focusable
  }

  highlightField(targetInput);
  flashFilledFeedback(scrollTarget);
  onFieldFocused(targetInput);
}

function isFieldAnswered(fieldKey: string): { isAnswered: boolean; el: HTMLElement | null } {
  const el = document.querySelector(`[data-immpal-key="${CSS.escape(fieldKey)}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!el) return { isAnswered: false, el: null };

  const tagName = el.tagName.toLowerCase();
  if (tagName === 'input') {
    const inputType = (el as HTMLInputElement).type?.toLowerCase();
    if (inputType === 'radio') {
      const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      const isChecked = Array.from(radios).some((r) => r.checked);
      return { isAnswered: isChecked, el };
    }
    if (inputType === 'checkbox') {
      return { isAnswered: (el as HTMLInputElement).checked, el };
    }
    return { isAnswered: Boolean(el.value && String(el.value).trim().length > 0), el };
  }
  if (tagName === 'select') {
    const sel = el as HTMLSelectElement;
    return { isAnswered: sel.selectedIndex > 0 && Boolean(sel.value), el };
  }
  if (tagName === 'textarea') {
    return { isAnswered: Boolean(el.value && String(el.value).trim().length > 0), el };
  }
  return { isAnswered: false, el };
}

function advanceToNextField(currentElOrKey?: HTMLElement | string) {
  cancelAutoAdvance();
  const allFields = extractAllFields();
  if (!allFields || allFields.length === 0) {
    const submitBtn = findSubmitOrNextButton();
    if (submitBtn) {
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashFilledFeedback(submitBtn);
    }
    return;
  }

  let currentKey: string | null = null;
  if (typeof currentElOrKey === 'string' && currentElOrKey) {
    currentKey = currentElOrKey;
  } else if (currentElOrKey instanceof HTMLElement) {
    currentKey =
      currentElOrKey.getAttribute("data-immpal-key") ||
      currentElOrKey.closest("[data-immpal-key]")?.getAttribute("data-immpal-key") ||
      null;
  }

  if (!currentKey) {
    const active = (document.activeElement as HTMLElement) || highlightedEl;
    if (active) {
      currentKey =
        active.getAttribute("data-immpal-key") ||
        active.closest("[data-immpal-key]")?.getAttribute("data-immpal-key") ||
        null;
    }
  }

  const currentIndex = currentKey ? allFields.findIndex((f) => f.fieldKey === currentKey) : -1;

  // 1. Search forward from currentIndex + 1
  for (let i = currentIndex + 1; i < allFields.length; i++) {
    const { isAnswered, el } = isFieldAnswered(allFields[i].fieldKey);
    if (el && !isAnswered) {
      focusAndActivateField(el);
      return;
    }
  }

  // 2. Wrap-around: search from 0 to currentIndex
  for (let i = 0; i <= currentIndex && i < allFields.length; i++) {
    const { isAnswered, el } = isFieldAnswered(allFields[i].fieldKey);
    if (el && !isAnswered) {
      focusAndActivateField(el);
      return;
    }
  }

  // 3. If all fields are answered, try immediate next field if available (for review)
  if (currentIndex >= 0 && currentIndex + 1 < allFields.length) {
    const nextEl = document.querySelector(
      `[data-immpal-key="${CSS.escape(allFields[currentIndex + 1].fieldKey)}"]`
    ) as HTMLElement | null;
    if (nextEl) {
      focusAndActivateField(nextEl);
      return;
    }
  }

  // 4. All answered / last field: scroll to Continue / Next / Submit button
  const submitBtn = findSubmitOrNextButton();
  if (submitBtn) {
    submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashFilledFeedback(submitBtn);
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "AUTOFILL_FORM") {
    runMultiPassAutofill(request.payload.caseId, request.payload.options).then(sendResponse);
    return true; // async response
  }

  if (request.type === "ADVANCE_NEXT_FIELD") {
    advanceToNextField(request.fieldKey);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === "FOCUS_FIELD" && request.fieldKey) {
    const el = document.querySelector(`[data-immpal-key="${CSS.escape(request.fieldKey)}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
      flashFilledFeedback(el);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (request.type === "WRITE_FIELD_VALUE" && request.fieldKey && request.value) {
    const elements = document.querySelectorAll(`[data-immpal-key="${CSS.escape(request.fieldKey)}"]`);
    let applied = false;
    let appliedEl: HTMLElement | null = null;

    elements.forEach((el) => {
      if (!applied) {
        if (applyValueToElement(el as any, request.value)) {
          applied = true;
          appliedEl = el as HTMLElement;
          flashFilledFeedback(el as HTMLElement);
        }
      }
    });

    if (applied && appliedEl) {
      setTimeout(() => {
        advanceToNextField(appliedEl!);
      }, 600);
      sendResponse({ success: true, advanced: true });
    } else {
      sendResponse({ success: applied });
    }
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Session pace: positive completion signal
// ---------------------------------------------------------------------------

function noteActivity() {
  // No-op activity hook: avoids interrupting users with aggressive nag dialogs
  // while they are actively reading or filling out immigration forms.
}

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
