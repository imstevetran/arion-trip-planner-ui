// The only non-secret config this app needs — everything requiring an API
// key (Supabase, Anthropic, OpenRouteService, Brave, the mocks) lives in
// trip-planner-api, which this app only ever calls over plain HTTP.
export const API_BASE_URL = (import.meta.env.VITE_TRIP_PLANNER_API_URL as string | undefined) ?? "http://localhost:4300";

// Not a real secret — Vite inlines VITE_-prefixed vars into the public JS
// bundle at build time, so this is readable by anyone who opens devtools.
// It's one layer of a few trip-planner-api checks (see its app.ts): mainly
// a filter against scripted abuse that never loads this bundle at all, not
// protection against a targeted attacker. Falls back to the same default
// trip-planner-api itself defaults to, so local dev works without setting
// anything.
const FRONTEND_API_SECRET =
  (import.meta.env.VITE_TRIP_PLANNER_API_SECRET as string | undefined) ?? "local-dev-frontend-secret";

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller?.signal ?? init?.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FRONTEND_API_SECRET}`,
        ...init?.headers,
      },
    });
    const body = (await response.json()) as T | { error: string };
    if (!response.ok) {
      throw new Error((body as { error?: string }).error ?? `Request to ${path} failed (${response.status})`);
    }
    return body as T;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("The assistant took too long to respond. Please try again.");
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, options?.timeoutMs);
}
