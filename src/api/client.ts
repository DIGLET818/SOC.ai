// client.ts
export const API_BASE_URL = "http://127.0.0.1:5000/api";

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
            credentials: fetchOptions.credentials,
            mode: fetchOptions.mode,
            headers: {
                ...(jsonBody ? { "Content-Type": "application/json" } : {}),
                ...(fetchOptions.headers ?? {}),
            },
            body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
        };

        const resp = await fetch(`${API_BASE_URL}${endpoint}`, finalOptions);

        if (!resp.ok) {
            const text = await resp.text();
            try {
                const json = JSON.parse(text) as { error?: string; detail?: string };
                const msg = json.error || json.detail || text;
                throw new Error(msg);
            } catch (parseErr) {
                if (parseErr instanceof Error && parseErr.message !== text) throw parseErr;
                throw new Error(`API error (${resp.status}): ${text}`);
            }
        }

        const text = await resp.text();
        return text ? (JSON.parse(text) as T) : ({} as T);
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
