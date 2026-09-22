// Extension API Client with Refresh Interceptor

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Refresh lock ────────────────────────────────────────────────────────────
// Prevents concurrent 401 responses from each kicking off their own refresh,
// which causes them to overwrite each other's newly-written tokens and produce
// an infinite 401 → refresh → 401 loop seen in the backend logs.
let refreshPromise: Promise<boolean> | null = null;

// Helper to get tokens from storage
const getTokens = (): Promise<{ immpalAuthToken?: string; immpalRefreshToken?: string }> => {
  return new Promise((resolve) => {
    chrome.storage.local.get(["immpalAuthToken", "immpalRefreshToken"], (result) => {
      resolve(result as { immpalAuthToken?: string; immpalRefreshToken?: string });
    });
  });
};

// Helper to set tokens in storage
const setTokens = (accessToken: string, refreshToken: string): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.set({ 
      immpalAuthToken: accessToken, 
      immpalRefreshToken: refreshToken 
    }, () => {
      resolve();
    });
  });
};

// Helper to clear tokens from storage
const clearTokens = (): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.local.remove(["immpalAuthToken", "immpalRefreshToken"], () => {
      chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" }).catch(() => {});
      chrome.runtime.sendMessage({ type: "AUTH_STATE_CHANGED" }).catch(() => {});
      resolve();
    });
  });
};

/**
 * Fetch wrapper that automatically injects the Bearer token
 * and attempts a refresh if a 401 Unauthorized is encountered.
 *
 * Uses a module-level lock (refreshPromise) so that when multiple concurrent
 * requests all receive a 401 they share a single refresh attempt instead of
 * each spinning up their own — which would cause the tokens they write to
 * storage to immediately overwrite each other, producing an infinite loop.
 */
export const fetchWithAuth = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
  let { immpalAuthToken, immpalRefreshToken } = await getTokens();

  const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
  
  const headers = new Headers(options.headers || {});
  if (immpalAuthToken) {
    headers.set('Authorization', `Bearer ${immpalAuthToken}`);
  }
  
  // Set default content type if not provided and body exists
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(url, { ...options, headers });

  // If unauthorized, attempt to refresh the token (at most once concurrently)
  if (response.status === 401 && immpalRefreshToken) {
    // If a refresh is already in flight, wait for it instead of launching another
    if (!refreshPromise) {
      refreshPromise = (async (): Promise<boolean> => {
        try {
          const refreshResponse = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/users/refresh-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: immpalRefreshToken })
          });

          if (refreshResponse.ok) {
            const data = await refreshResponse.json();
            // Backend wraps in ApiResponse: { success, data: { accessToken, refreshToken } }
            const newAccessToken = data?.data?.accessToken || data?.accessToken;
            const newRefreshToken = data?.data?.refreshToken || data?.refreshToken;

            if (newAccessToken && newRefreshToken) {
              await setTokens(newAccessToken, newRefreshToken);
              chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" }).catch(() => {});
              return true;
            } else {
              console.error("[fetchWithAuth] Refresh response missing tokens:", data);
              await clearTokens();
              return false;
            }
          } else {
            console.error("[fetchWithAuth] Refresh token request failed:", refreshResponse.status);
            await clearTokens();
            return false;
          }
        } catch (error) {
          console.error("[fetchWithAuth] Error during token refresh:", error);
          await clearTokens();
          return false;
        } finally {
          // Always release the lock so subsequent calls can try again
          refreshPromise = null;
        }
      })();
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      const fresh = await getTokens();
      if (fresh.immpalAuthToken) {
        headers.set('Authorization', `Bearer ${fresh.immpalAuthToken}`);
        response = await fetch(url, { ...options, headers });
        if (response.status === 401) {
          await clearTokens();
        }
      } else {
        await clearTokens();
      }
    } else {
      await clearTokens();
    }
  } else if (response.status === 401) {
    await clearTokens();
  }

  return response;
};
