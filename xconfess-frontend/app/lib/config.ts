/**
 * Canonical Backend URL Resolution
 * Server-side: Uses BACKEND_API_URL (private)
 * Client-side: Uses NEXT_PUBLIC_API_URL (public)
 */

export const getApiBaseUrl = (): string => {
  // 1. Server-side check
  if (typeof window === 'undefined') {
    const serverUrl = process.env.BACKEND_API_URL;
    if (!serverUrl) {
      const clientUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      return clientUrl.includes('/api/v1') ? clientUrl : clientUrl.replace(/\/api\/?$/, '') + '/api/v1';
    }
    return serverUrl.includes('/api/v1') ? serverUrl : serverUrl.replace(/\/api\/?$/, '') + '/api/v1';
  }

  // 2. Client-side check
  const clientUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!clientUrl) {
    return 'http://localhost:5000/api/v1';
  }
  return clientUrl.includes('/api/v1') ? clientUrl : clientUrl.replace(/\/api\/?$/, '') + '/api/v1';
};

/**
 * Canonical WebSocket URL Resolution
 * Client-side: Uses NEXT_PUBLIC_WS_URL (public)
 */
export const getWsUrl = (): string => {
  if (typeof window === 'undefined') {
    // Return empty or fallback for server-side evaluation during build
    return 'ws://localhost:5000';
  }

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) {
    return 'ws://localhost:5000';
  }
  return wsUrl;
};