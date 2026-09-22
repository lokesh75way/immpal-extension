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
// Whether the user has explicitly activated Copilot on the CURRENT page in
// this tab. Defaults to inactive on every navigation -- the content script
// injects into every page (so it can work on any government portal) but must
// never scan fields or call the resolution API until the user opts in here,
// one page view at a time.
const pageActiveKey = (tabId: number) => `pageActive_${tabId}`;

// ---------------------------------------------------------------------------
// EXTENSION ACTIVITY LOGGING: session + page-visit trail
//
// Ties every Copilot audit event back to who used the extension, on what
// case, and what portal pages they visited -- distinct from sessionKey()
// above, which only tracks the unrelated "has the user finished this step"
// completion-prompt state.
// ---------------------------------------------------------------------------
const extSessionKey = (tabId: number) => `extSession_${tabId}`;

function startExtensionSession(tabId: number, caseId: string) {
  fetchWithAuth(`/cases/${caseId}/extension/sessions`, {
    method: 'POST',
    body: JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
    .then((data) => {
      const sessionId = data?.data?.id;
      if (!sessionId) return;
      chrome.storage.local.set({ [extSessionKey(tabId)]: sessionId }, () => {
        // Log the page the tab is already on, in case the case was activated
        // after the page had already loaded.
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.url) recordPageVisit(tabId, tab.url);
        });
      });
    })
    .catch((err) => console.warn("[Immpal] Failed to start extension session:", err));
}

function recordPageVisit(tabId: number, url: string) {
  if (!url || !/^https?:/i.test(url)) return;
  chrome.storage.local.get([extSessionKey(tabId)], (res) => {
    const sessionId = res[extSessionKey(tabId)];
    if (!sessionId) return;
    fetchWithAuth(`/cases/extension/sessions/${sessionId}/page-visits`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }).catch((err) => console.warn("[Immpal] Failed to record page visit:", err));
  });
}

function endExtensionSession(tabId: number) {
  chrome.storage.local.get([extSessionKey(tabId)], (res) => {
    const sessionId = res[extSessionKey(tabId)];
    if (!sessionId) return;
    fetchWithAuth(`/cases/extension/sessions/${sessionId}/end`, {
      method: 'POST',
    }).catch(() => { /* best-effort -- the server-side reaper covers a killed tab */ });
    chrome.storage.local.remove([extSessionKey(tabId)]);
  });
}

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
    pageActiveKey(tabId),
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

// A tab closing is the reliable end-of-session signal for a clean close;
// a killed tab (browser crash, force-quit) is instead caught by the
// server-side reaper in ExtensionActivityService.
chrome.tabs.onRemoved.addListener((tabId) => {
  endExtensionSession(tabId);
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
    const tabId = sender.tab?.id;
    chrome.storage.local.get(
      tabId !== undefined ? [extSessionKey(tabId), fieldCacheKey(tabId)] : [],
      (sessionRes) => {
        const existingCache: Record<string, any> =
          tabId !== undefined ? sessionRes[fieldCacheKey(tabId)] || {} : {};
        const requestedFields = request.payload.fields || [];

        // If all requested fields are already in cache, build autofill response from cache (0 redundant LLM calls)
        const allCached =
          requestedFields.length > 0 &&
          requestedFields.every((f: any) => existingCache[f.fieldKey]?.resolution);

        if (allCached) {
          const fills: Record<string, any> = {};
          const resolutions: Record<string, any> = {};
          for (const field of requestedFields) {
            const item = existingCache[field.fieldKey];
            if (item) {
              resolutions[field.fieldKey] = item.resolution;
              if (
                (item.resolution.status === "ANSWER_AVAILABLE" ||
                  item.resolution.status === "SUGGESTED_NARRATIVE") &&
                item.resolution.answer
              ) {
                fills[field.fieldKey] = {
                  value: item.resolution.answer,
                  status: item.resolution.status,
                };
              }
            }
          }
          const total = requestedFields.length;
          const filled = Object.keys(fills).length;
          sendResponse({
            success: true,
            data: {
              fills,
              summary: { filled, totalFields: total, skipped: total - filled },
              resolutions,
            },
          });
          return;
        }

        fetchWithAuth(`/cases/${request.payload.caseId}/copilot/autofill`, {
          method: 'POST',
          body: JSON.stringify({
            url: request.payload.url,
            title: request.payload.title,
            headings: request.payload.headings,
            mainText: request.payload.mainText,
            fields: request.payload.fields,
            sessionId: tabId !== undefined ? sessionRes[extSessionKey(tabId)] : undefined,
          }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("Failed to fetch autofill mapping");
            return res.json();
          })
          .then((data) => {
            // Cache resolutions returned by autofill into fieldCache so Focus Assist has them immediately
            if (tabId !== undefined && data.data?.resolutions) {
              const resMap = data.data.resolutions;
              const fieldCache: Record<string, any> = { ...existingCache };
              for (const field of requestedFields) {
                const resEntry = resMap[field.fieldKey];
                if (resEntry) {
                  fieldCache[field.fieldKey] = { field, resolution: resEntry };
                }
              }
              chrome.storage.local.set({
                [fieldCacheKey(tabId)]: fieldCache,
                [pageContextKey(tabId)]: request.payload,
              });
            }
            sendResponse(data);
          })
          .catch((err) => {
            console.error("Error fetching autofill mapping:", err);
            sendResponse({ success: false, message: err.message });
          });
      },
    );
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
            extSessionKey(tabId),
          ]);
        }
        sendResponse({ success: true, changed: isChanged });
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "RECHECK_PAGE" }).catch(() => {});
          // Opens (or resumes) the ExtensionSession that every audit event and
          // page visit for this tab/case will be stamped with.
          startExtensionSession(tabId, newCaseId);
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

  // ---------------------------------------------------------------------------
  // PER-PAGE ACTIVATION GATE: nothing scans or resolves fields on a page
  // until the user explicitly turns Copilot on for that page, from the popup.
  // ---------------------------------------------------------------------------

  if (request.type === "SET_PAGE_ACTIVE") {
    const tabId = request.tabId;
    const active = Boolean(request.active);
    if (!tabId) {
      sendResponse({ success: false });
      return false;
    }
    chrome.storage.local.set({ [pageActiveKey(tabId)]: active }, () => {
      chrome.tabs
        .sendMessage(tabId, { type: active ? "PAGE_ACTIVATED" : "PAGE_DEACTIVATED" })
        .catch(() => { /* content script may not be ready yet */ })
        .finally(() => sendResponse({ success: true }));

      if (active) {
        // Session/page-visit tracking starts from this explicit click and only
        // this click -- never from merely selecting a case or switching tabs.
        chrome.storage.local.get([caseKey(tabId), "lastActiveCaseId"], (caseRes) => {
          const caseId = caseRes[caseKey(tabId)] || caseRes.lastActiveCaseId;
          if (caseId) startExtensionSession(tabId, caseId as string);
        });
      } else {
        // Turn Off: wipe all tab-scoped resolution cache so the next activation
        // starts completely fresh. We deliberately keep activeCase (the user
        // didn't change their case) and assistMode (user preference) and auth.
        chrome.storage.local.remove([
          fieldCacheKey(tabId),
          pageContextKey(tabId),
          focusedFieldKey(tabId),
          resolutionKey(tabId),
          sessionKey(tabId),
          `autofillResult_${tabId}`,
        ]);
      }
    });
    return true;
  }

  if (request.type === "GET_PAGE_ACTIVE") {
    const tabId = request.tabId;
    chrome.storage.local.get([pageActiveKey(tabId)], (res) => {
      sendResponse({ active: Boolean(res[pageActiveKey(tabId)]) });
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

    chrome.storage.local.get(
      [caseKey(tabId), "lastActiveCaseId", extSessionKey(tabId)],
      (res) => {
      const caseId = res[caseKey(tabId)] || res.lastActiveCaseId;
      if (!caseId) {
        console.warn("[Immpal] No active case selected for this tab. Ignoring field batch.");
        return;
      }

      chrome.storage.local.set({ [pageContextKey(tabId)]: context });

      fetchWithAuth(`/cases/${caseId}/muscle/resolve-question`, {
        method: 'POST',
        body: JSON.stringify({ ...context, sessionId: res[extSessionKey(tabId)] })
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
      [
        caseKey(tabId),
        "lastActiveCaseId",
        fieldCacheKey(tabId),
        pageContextKey(tabId),
        extSessionKey(tabId),
      ],
      (res) => {
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
          sessionId: res[extSessionKey(tabId)],
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
    chrome.storage.local.get(
      [caseKey(tabId), "lastActiveCaseId", extSessionKey(tabId)],
      (res) => {
      const caseId = res[caseKey(tabId)] || res.lastActiveCaseId;
      if (!caseId) {
        sendResponse({ success: false, error: "No active case selected for this tab." });
        return;
      }
      fetchWithAuth(`/cases/${caseId}/muscle/consistency-check`, {
        method: 'POST',
        body: JSON.stringify({ ...request.payload, session_id: res[extSessionKey(tabId)] })
      })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data: data.data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (request.type === "SAVE_OVERRIDE") {
    const tabId = request.tabId;
    chrome.storage.local.get(
      [caseKey(tabId), "lastActiveCaseId", extSessionKey(tabId)],
      (res) => {
      const caseId = res[caseKey(tabId)] || res.lastActiveCaseId;
      if (!caseId) {
        sendResponse({ success: false, error: "No active case selected for this tab." });
        return;
      }
      fetchWithAuth(`/cases/${caseId}/muscle/save-override`, {
        method: 'POST',
        body: JSON.stringify({ ...request.payload, session_id: res[extSessionKey(tabId)] })
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
    chrome.storage.local.get([caseKey(tabId)], (res) => {
      if (!res[caseKey(tabId)]) return;
      chrome.storage.local.set({ [sessionKey(tabId)]: "COMPLETION_CONFIRMATION" }, () => {
        chrome.runtime.sendMessage({ type: "SESSION_COMPLETION_PROMPT", tabId }).catch(() => {});
      });
    });
  }

  if (request.type === "POSITIVE_COMPLETION_SIGNAL") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    chrome.storage.local.get([caseKey(tabId)], (res) => {
      if (!res[caseKey(tabId)]) return;
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
