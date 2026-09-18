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

// let activeCopilotCaseId: string | null = null;

// Listen for messages from the popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
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
    // Save both tokens securely in local storage
    chrome.storage.local.set({ 
      immpalAuthToken: request.token,
      immpalRefreshToken: request.refreshToken
    }, () => {
      // Send message to popup to update its state if open
      chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" }).catch(() => {
        // Ignore error if popup is closed
      });
    });
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
  // COPILOT SEMANTIC RESOLUTION API
  // ---------------------------------------------------------------------------

  // Per-tab session state: every tab has its own active case, last resolution,
  // and session pace state, so opening the panel on one tab never leaks into
  // or gets overwritten by another tab.
  const caseKey = (tabId: number) => `activeCase_${tabId}`;
  const resolutionKey = (tabId: number) => `lastResolution_${tabId}`;
  const sessionKey = (tabId: number) => `sessionState_${tabId}`;

  if (request.type === "SET_ACTIVE_CASE") {
    const tabId = request.tabId;
    chrome.storage.local.set({ [caseKey(tabId)]: request.caseId }, () => {
      sendResponse({ success: true });
      // Re-run detection on the page immediately -- otherwise a page opened
      // before a case was selected never gets a second detection pass and
      // requires a manual refresh.
      chrome.tabs.sendMessage(tabId, { type: "RECHECK_PAGE" }).catch(() => {
        /* content script not present on this tab (e.g. chrome:// page) */
      });
    });
    return true;
  }

  if (request.type === "GET_ACTIVE_CASE") {
    const tabId = request.tabId;
    chrome.storage.local.get([caseKey(tabId)], (res) => {
      sendResponse({ caseId: res[caseKey(tabId)] || null });
    });
    return true;
  }

  if (request.type === "DETECT_QUESTION") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;

    chrome.storage.local.get([caseKey(tabId), "isPaused"], (res) => {
      if (res.isPaused) {
        return;
      }

      const caseId = res[caseKey(tabId)];
      if (!caseId) {
        console.warn("[Immpal] No active case selected for this tab. Ignoring question detection.");
        return;
      }

      // 1. Immediately broadcast that the question was detected so the UI can show a loading state
      const detectedPayload = { question: request.payload, resolution: null };
      chrome.storage.local.set({ [resolutionKey(tabId)]: detectedPayload }, () => {
        chrome.runtime.sendMessage({
          type: "QUESTION_DETECTED",
          tabId,
          payload: detectedPayload
        }).catch(() => { /* Ignore if popup is closed */ });
      });

      // 2. Now call the backend to resolve it
      fetchWithAuth(`/cases/${caseId}/muscle/resolve-question`, {
        method: 'POST',
        body: JSON.stringify(request.payload)
      })
        .then(res => {
          if (!res.ok) throw new Error(`Failed to resolve question: ${res.status} ${res.statusText}`);
          return res.json();
        })
        .then(data => {
          const resolutionPayload = {
            question: request.payload,
            resolution: data.data?.resolution || data.resolution || data
          };

          chrome.storage.local.set({ [resolutionKey(tabId)]: resolutionPayload }, () => {
            chrome.runtime.sendMessage({
              type: "QUESTION_RESOLVED",
              tabId,
              payload: resolutionPayload
            }).catch(() => { /* Ignore if popup is closed */ });
          });
        })
        .catch(err => {
          console.error("[Immpal] Error resolving question:", err);

          // Send an error payload to the UI so it doesn't hang
          const errorPayload = {
            question: request.payload,
            resolution: {
              status: "ERROR",
              answer: null,
              message: `Backend Error: ${err.message}. Ensure the backend is running and the route exists.`
            }
          };

          chrome.storage.local.set({ [resolutionKey(tabId)]: errorPayload }, () => {
            chrome.runtime.sendMessage({
              type: "QUESTION_RESOLVED",
              tabId,
              payload: errorPayload
            }).catch(() => { /* Ignore if popup is closed */ });
          });
        });
    });

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
