// client.ts
export const API_BASE_URL = "http://127.0.0.1:5000/api";

/** Quick liveness check — used to wait for Flask after connection refused during long fetch-all runs. */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE_URL}/health`, { credentials: "include" });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Wait until the backend responds or timeout (ms). Polls quietly (no console spam). */
export async function waitForBackend(maxWaitMs = 30_000, intervalMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await checkBackendHealth()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Request helper.
 * Uses `unknown` instead of `any` to satisfy ESLint rules.
 */
async function request<T>(
    endpoint: string,
    options: Omit<RequestInit, "body"> & { jsonBody?: unknown } = {}
): Promise<T> {
    try {
        const { jsonBody, ...fetchOptions } = options;

        const finalOptions: RequestInit = {
            method: fetchOptions.method || "GET",
            credentials: fetchOptions.credentials ?? "include",
            mode: fetchOptions.mode,
            headers: {
                ...(jsonBody ? { "Content-Type": "application/json" } : {}),
                ...(fetchOptions.headers ?? {}),
            },
            body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
        };

        const resp = await fetch(`${API_BASE_URL}${endpoint}`, finalOptions);
        const text = await resp.text();

        const parseBody = (): unknown => {
            const trimmed = text.trim();
            if (!trimmed) return {};
            if (trimmed.startsWith("<")) {
                if (resp.status === 404) {
                    throw new Error(
                        "API endpoint not found (404). Restart the backend (python main.py) and try again."
                    );
                }
                throw new Error(
                    `Server returned HTML instead of JSON (${resp.status}). Check that the backend is running.`
                );
            }
            try {
                return JSON.parse(trimmed);
            } catch {
                throw new Error(`Invalid JSON response (${resp.status}): ${trimmed.slice(0, 160)}`);
            }
        };

        if (!resp.ok) {
            try {
                const json = parseBody() as { error?: string; detail?: string };
                const msg = json.error || json.detail || text;
                throw new Error(msg);
            } catch (parseErr) {
                if (parseErr instanceof Error && !parseErr.message.includes("Invalid JSON")) {
                    throw parseErr;
                }
                throw new Error(`API error (${resp.status}): ${text.slice(0, 200)}`);
            }
        }

        return parseBody() as T;
    } catch (err) {
        console.error("API Request Error:", err);
        throw err;
    }
}

const api = {
    get: <T>(endpoint: string, options: RequestInit = {}) =>
        request<T>(endpoint, { ...options, method: "GET" }),

    post: <T>(endpoint: string, body?: unknown, options: RequestInit = {}) =>
        request<T>(endpoint, { ...options, method: "POST", jsonBody: body }),

    put: <T>(endpoint: string, body?: unknown, options: RequestInit = {}) =>
        request<T>(endpoint, { ...options, method: "PUT", jsonBody: body }),

    delete: <T>(endpoint: string, options: RequestInit = {}) =>
        request<T>(endpoint, { ...options, method: "DELETE" }),
};

export default api;
