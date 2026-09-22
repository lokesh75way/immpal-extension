import { fetchWithAuth } from '../utils/api';

// Background Service Worker
// Polyfill for Vite HMR client which expects 'window'
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

// Background service worker for Immpal Extension

// Enable the side panel to open when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Re-inject content scripts into all open web tabs upon extension reload / install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[Immpal Background] Extension installed/updated, reason:", details.reason);
  try {
    const manifest = chrome.runtime.getManifest();
    const scripts = manifest.content_scripts?.[0]?.js || [];
    if (scripts.length === 0) return;

    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: scripts,
          });
          setTimeout(() => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: "RECHECK_PAGE" }).catch(() => {});
            }
          }, 400);
        } catch {
          // Tab may not allow scripting
        }
      }
    }
  } catch (err) {
    console.warn("[Immpal Background] Content script re-injection error:", err);
  }
});

// let activeCopilotCaseId: string | null = null;

// Per-tab session state: every tab has its own active case, last resolution,
// field cache, and session pace state, so opening the panel on one tab never
// leaks into or gets overwritten by another tab.
const caseKey = (tabId: number) => `activeCase_${tabId}`;
const resolutionKey = (tabId: number) => `lastResolution_${tabId}`;
const sessionKey = (tabId: number) => `sessionState_${tabId}`;
// Resolutions already fetched for this tab's current page, keyed by fieldKey --
// lets a focus event show an answer instantly instead of re-resolving it.
const fieldCacheKey = (tabId: number) => `fieldCache_${tabId}`;
// The page-level context (url/title/headings/mainText) the current field cache was resolved against.
const pageContextKey = (tabId: number) => `pageContext_${tabId}`;
// The field the user most recently focused, so a resolution that lands after
// the user has already moved on doesn't get pushed to the panel out of order.
const focusedFieldKey = (tabId: number) => `focusedField_${tabId}`;

/** Builds the popup-facing {question, resolution} shape for one field and pushes it as QUESTION_RESOLVED. */
function pushFieldResolution(
  tabId: number,
  context: { url: string; title: string; headings: string[]; mainText: string[] },
  fieldCache: Record<string, { field: any; resolution: any }>,
  fieldKey: string
) {
  const entry = fieldCache[fieldKey];
  if (!entry) return;

  const payload = {
    question: {
      url: context.url,
      title: context.title,
      headings: context.headings,
      mainText: context.mainText,
      fields: [entry.field],
    },
    resolution: entry.resolution,
  };

  chrome.storage.local.set({ [resolutionKey(tabId)]: payload }, () => {
    chrome.runtime.sendMessage({
      type: "QUESTION_RESOLVED",
      tabId,
      payload,
    }).catch(() => { /* Ignore if popup is closed */ });
  });
}

/** Clears the previous page's resolution/autofill state for a tab and tells
 * the popup to reset, so stale results never linger across a page change. */
function resetPageState(tabId: number) {
  chrome.storage.local.remove([
    `autofillResult_${tabId}`,
    resolutionKey(tabId),
    fieldCacheKey(tabId),
    pageContextKey(tabId),
    focusedFieldKey(tabId),
  ]);
  chrome.runtime.sendMessage({ type: "PAGE_NAVIGATED", tabId }).catch(() => {});
}

// Content script's history.pushState/replaceState/popstate patch (see
// content.ts) only fires PAGE_NAVIGATED for same-document SPA route changes
// -- a real full-page navigation destroys that JS context before it can
// fire, leaving the previous page's autofill results stuck in storage and
// on screen. chrome.tabs.onUpdated with changeInfo.url covers both cases
// (Chrome reports it for full navigations and for pushState-based ones
// alike), so it's the reliable place to reset per-tab state on any URL
// change, independent of whether the content script survives the transition.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    resetPageState(tabId);
  }
});

// Listen for messages from the popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.type === "ENSURE_CONTENT_SCRIPT") {
    const tabId = request.tabId;
    if (!tabId) {
      sendResponse({ status: "no_tab" });
      return false;
    }

    // Ping the tab first
    chrome.tabs.sendMessage(tabId, { type: "PING" }, async (pong: any) => {
      if (pong?.status === "pong") {
        sendResponse({ status: "already_injected" });
        return;
      }
      // Not responding, inject content script now
      try {
        const manifest = chrome.runtime.getManifest();
        const scripts = manifest.content_scripts?.[0]?.js || [];
        if (scripts.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: scripts,
          });
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { type: "RECHECK_PAGE" }).catch(() => {});
          }, 300);
          sendResponse({ status: "injected" });
          return;
        }
      } catch (err) {
        sendResponse({ status: "error", error: String(err) });
        return;
      }
      sendResponse({ status: "no_scripts" });
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION FLOW
  // ---------------------------------------------------------------------------

  if (request.type === "INITIATE_LOGIN") {
    // Open a new tab to the Immpal frontend to handle login
    const authUrl = `${(import.meta.env.VITE_FRONTEND_URL || "http://localhost:5173").replace(/\/$/, '')}/#/extension-auth`;

    chrome.tabs.create({ url: authUrl }, () => {
      sendResponse({ status: "Auth tab opened" });
    });
    
    // Returning true indicates we will respond asynchronously if needed
    return true;
  }
  
  if (request.type === "SET_TOKEN" && request.token) {
    const dataToStore: Record<string, string> = {
      immpalAuthToken: request.token,
    };
    if (request.refreshToken) {
      dataToStore.immpalRefreshToken = request.refreshToken;
    }

    chrome.storage.local.set(dataToStore, () => {
      console.log("[Immpal Background] Tokens saved to extension storage:", Object.keys(dataToStore));
      chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" }).catch(() => {});
      chrome.runtime.sendMessage({ type: "AUTH_STATE_CHANGED" }).catch(() => {});
      sendResponse({ success: true });
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // DATA FETCHING
  // ---------------------------------------------------------------------------

  if (request.type === "FETCH_CASE_DETAILS") {
    fetchWithAuth(`/cases/${request.payload.caseId}`)
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch case details");
        return res.json();
      })
      .then(data => {
        sendResponse({ success: true, data: data.data });
      })
      .catch(err => {
        console.error("Error fetching case details:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  // ---------------------------------------------------------------------------
  // AUTOFILL MODE
  // ---------------------------------------------------------------------------

  if (request.type === "FETCH_AUTOFILL_MAPPING") {
    fetchWithAuth(`/cases/${request.payload.caseId}/copilot/autofill`, {
      method: 'POST',
      body: JSON.stringify({
        url: request.payload.url,
        title: request.payload.title,
        headings: request.payload.headings,
        mainText: request.payload.mainText,
        fields: request.payload.fields,
      })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch autofill mapping");
        return res.json();
      })
      .then(data => {
        sendResponse(data);
      })
      .catch(err => {
        console.error("Error fetching autofill mapping:", err);
        sendResponse({ success: false, message: err.message });
      });
    return true; // async response
  }

  // ---------------------------------------------------------------------------
  // COPILOT SEMANTIC RESOLUTION API
  // ---------------------------------------------------------------------------

  if (request.type === "SET_ACTIVE_CASE") {
    const tabId = request.tabId;
    const newCaseId = request.caseId;
    chrome.storage.local.get([caseKey(tabId), "lastActiveCaseId"], (res) => {
      const currentCase = (tabId ? res[caseKey(tabId)] : null) || res.lastActiveCaseId;
      const isChanged = currentCase !== newCaseId;

      const toStore: Record<string, any> = {
        lastActiveCaseId: newCaseId,
      };
      if (tabId) {
        toStore[caseKey(tabId)] = newCaseId;
      }

      chrome.storage.local.set(toStore, () => {
        if (isChanged && tabId) {
          chrome.storage.local.remove([
            fieldCacheKey(tabId),
            pageContextKey(tabId),
            focusedFieldKey(tabId),
            resolutionKey(tabId),
          ]);
        }
        sendResponse({ success: true, changed: isChanged });
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "RECHECK_PAGE" }).catch(() => {});
        }
      });
    });
    return true;
  }

  if (request.type === "GET_ACTIVE_CASE") {
    const tabId = request.tabId;
    chrome.storage.local.get([caseKey(tabId), "lastActiveCaseId"], (res) => {
      const caseId = (tabId ? res[caseKey(tabId)] : null) || res.lastActiveCaseId || null;
      sendResponse({ caseId });
    });
    return true;
  }

  // Resolves every newly-seen field on the page in a single backend call.
  // The content script only sends fields it hasn't already sent, so this fires
  // once per page/SPA-navigation/mutation batch rather than once per field.
  if (request.type === "RESOLVE_FIELDS_BATCH") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;

    const context = request.payload as {
      url: string; title: string; headings: string[]; mainText: string[]; fields: any[];
    };

    chrome.storage.local.get([caseKey(tabId), "lastActiveCaseId", "isPaused"], (res) => {
      if (res.isPaused) return;

      const caseId = res[caseKey(tabId)] || res.lastActiveCaseId;
      if (!caseId) {
        console.warn("[Immpal] No active case selected for this tab. Ignoring field batch.");
        return;
      }

      chrome.storage.local.set({ [pageContextKey(tabId)]: context });

      fetchWithAuth(`/cases/${caseId}/muscle/resolve-question`, {
        method: 'POST',
        body: JSON.stringify(context)
      })
        .then(res => {
          if (!res.ok) throw new Error(`Failed to resolve fields: ${res.status} ${res.statusText}`);
          return res.json();
        })
        .then(data => {
          const resolutions = data.data?.resolutions || {};

          chrome.storage.local.get([fieldCacheKey(tabId), focusedFieldKey(tabId)], (cacheRes) => {
            const fieldCache: Record<string, { field: any; resolution: any }> = {
              ...(cacheRes[fieldCacheKey(tabId)] || {}),
            };
            for (const field of context.fields) {
              const resolution = resolutions[field.fieldKey];
              if (resolution) fieldCache[field.fieldKey] = { field, resolution };
            }

            chrome.storage.local.set({ [fieldCacheKey(tabId)]: fieldCache }, () => {
              // If the field the user is currently on just got resolved, push it now.
              const focused = cacheRes[focusedFieldKey(tabId)] as any;
              if (focused && fieldCache[focused.fieldKey]) {
                pushFieldResolution(tabId, context, fieldCache, focused.fieldKey);
              }
            });
          });
        })
        .catch(err => {
          console.error("[Immpal] Error resolving fields batch:", err);
        });
    });

    return false;
  }

  // Fired when the user focuses or clicks a field.
  if (request.type === "FIELD_FOCUSED") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;

    const field = request.payload as any;

    chrome.storage.local.get(
      [caseKey(tabId), "lastActiveCaseId", "isPaused", fieldCacheKey(tabId), pageContextKey(tabId)],
      (res) => {
        if (res.isPaused) return;
        const caseId = res[caseKey(tabId)] || res.lastActiveCaseId;
        if (!caseId) return;

        chrome.storage.local.set({ [focusedFieldKey(tabId)]: field });

        const context: { url: string; title: string; headings: string[]; mainText: string[] } =
          (res[pageContextKey(tabId)] as any) || {
            url: field.pageUrl || "",
            title: "",
            headings: [],
            mainText: [],
          };
        const fieldCache: Record<string, { field: any; resolution: any }> =
          (res[fieldCacheKey(tabId)] as any) || {};

        if (fieldCache[field.fieldKey]) {
          pushFieldResolution(tabId, context, fieldCache, field.fieldKey);
          return;
        }

        // Show loading state immediately to the popup with the detected question
        const detectedPayload = {
          question: {
            url: context.url,
            title: context.title,
            headings: context.headings,
            mainText: context.mainText,
            fields: [field],
          },
          resolution: null,
        };
        chrome.storage.local.set({ [resolutionKey(tabId)]: detectedPayload }, () => {
          chrome.runtime.sendMessage({
            type: "QUESTION_DETECTED",
            tabId,
            payload: detectedPayload
          }).catch(() => { /* Ignore if popup is closed */ });
        });

        // Resolve this field on-demand immediately
        const resolveContext = {
          url: context.url || field.pageUrl || "",
          title: context.title || "",
          headings: context.headings || [],
          mainText: context.mainText || [],
          fields: [field],
        };

        fetchWithAuth(`/cases/${caseId}/muscle/resolve-question`, {
          method: 'POST',
          body: JSON.stringify(resolveContext)
        })
          .then(res => {
            if (!res.ok) throw new Error(`Failed to resolve field: ${res.status}`);
            return res.json();
          })
          .then(data => {
            const resolutions = data.data?.resolutions || {};
            const resolution = resolutions[field.fieldKey] || data.data?.resolution;
            if (resolution) {
              chrome.storage.local.get([fieldCacheKey(tabId)], (latestCacheRes) => {
                const updatedCache = {
                  ...(latestCacheRes[fieldCacheKey(tabId)] || {}),
                  [field.fieldKey]: { field, resolution }
                };
                chrome.storage.local.set({ [fieldCacheKey(tabId)]: updatedCache }, () => {
                  pushFieldResolution(tabId, resolveContext, updatedCache, field.fieldKey);
                });
              });
            }
          })
          .catch(err => {
            console.error("[Immpal] Error resolving focused field on demand:", err);
          });
      }
    );

    return false;
  }

  if (request.type === "GET_LAST_RESOLUTION") {
    const tabId = request.tabId;
    chrome.storage.local.get([resolutionKey(tabId)], (res) => {
      sendResponse({ data: res[resolutionKey(tabId)] || null });
    });
    return true;
  }
  if (request.type === "CHECK_CONSISTENCY") {
    const tabId = request.tabId;
    chrome.storage.local.get([caseKey(tabId)], (res) => {
      const caseId = res[caseKey(tabId)];
      fetchWithAuth(`/cases/${caseId}/muscle/consistency-check`, {
        method: 'POST',
        body: JSON.stringify(request.payload)
      })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data: data.data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (request.type === "SAVE_OVERRIDE") {
    const tabId = request.tabId;
    chrome.storage.local.get([caseKey(tabId)], (res) => {
      const caseId = res[caseKey(tabId)];
      fetchWithAuth(`/cases/${caseId}/muscle/save-override`, {
        method: 'POST',
        body: JSON.stringify(request.payload)
      })
      .then(res => res.json())
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (request.type === "PAGE_NAVIGATED") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      resetPageState(tabId);
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // SESSION PACE MODEL: inactivity threshold + positive completion signal
  // ---------------------------------------------------------------------------

  if (request.type === "INACTIVITY_THRESHOLD") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    chrome.storage.local.get([caseKey(tabId), "isPaused"], (res) => {
      if (res.isPaused || !res[caseKey(tabId)]) return;
      chrome.storage.local.set({ [sessionKey(tabId)]: "COMPLETION_CONFIRMATION" }, () => {
        chrome.runtime.sendMessage({ type: "SESSION_COMPLETION_PROMPT", tabId }).catch(() => {});
      });
    });
  }

  if (request.type === "POSITIVE_COMPLETION_SIGNAL") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    chrome.storage.local.get([caseKey(tabId), "isPaused"], (res) => {
      if (res.isPaused || !res[caseKey(tabId)]) return;
      chrome.storage.local.set({ [sessionKey(tabId)]: "COMPLETION_CONFIRMATION" }, () => {
        chrome.runtime.sendMessage({ type: "SESSION_COMPLETION_PROMPT", tabId }).catch(() => {});
      });
    });
  }

  if (request.type === "GET_SESSION_STATE") {
    const tabId = request.tabId;
    chrome.storage.local.get([sessionKey(tabId)], (res) => {
      sendResponse({ sessionState: res[sessionKey(tabId)] || null });
    });
    return true;
  }

  if (request.type === "SESSION_COMPLETION_RESPONSE") {
    // payload: { finished: boolean }
    const tabId = request.tabId;
    const nextState = request.payload?.finished ? "SESSION_COMPLETED" : "ACTIVE";
    chrome.storage.local.set({ [sessionKey(tabId)]: nextState }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
