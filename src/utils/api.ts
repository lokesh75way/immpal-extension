// Extension API Client with Refresh Interceptor

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
      resolve();
    });
  });
};

/**
 * Fetch wrapper that automatically injects the Bearer token
 * and attempts a refresh if a 401 Unauthorized is encountered.
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

  // If unauthorized, attempt to refresh the token
  if (response.status === 401 && immpalRefreshToken) {
    try {
      const refreshResponse = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/users/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: immpalRefreshToken })
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        
        // Extract new tokens based on expected backend response structure
        const newAccessToken = data?.data?.accessToken || data?.accessToken;
        const newRefreshToken = data?.data?.refreshToken || data?.refreshToken;

        if (newAccessToken && newRefreshToken) {
          await setTokens(newAccessToken, newRefreshToken);
          
          // Notify popup of update if it's open
          chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" }).catch(() => {});

          // Retry the original request with the new access token
          headers.set('Authorization', `Bearer ${newAccessToken}`);
          response = await fetch(url, { ...options, headers });
        } else {
          console.error("Refresh response missing tokens.");
          await clearTokens();
        }
      } else {
        console.error("Refresh token request failed.");
        await clearTokens();
      }
    } catch (error) {
      console.error("Error during token refresh:", error);
      await clearTokens();
    }
  } else if (response.status === 401) {
    // 401 but no refresh token available
    await clearTokens();
  }

  return response;
};
