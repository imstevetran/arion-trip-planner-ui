// The only non-secret config this app needs — everything requiring an API
// key (Supabase, Anthropic, OpenRouteService, Brave, the mocks) lives in
// trip-planner-api, which this app only ever calls over plain HTTP.
export const API_BASE_URL = (import.meta.env.VITE_TRIP_PLANNER_API_URL as string | undefined) ?? "http://localhost:4300";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `Request to ${path} failed (${response.status})`);
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}
