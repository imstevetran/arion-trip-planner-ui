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
// Exported for lib/openRouteService.ts, which hand-rolls its own fetch()
// (rather than going through request() below) so it can inspect a failed
// response's body before deciding whether to retry — apiPost/apiGet throw
// immediately on a non-ok response, which would lose that.
export const FRONTEND_API_SECRET =
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

export function apiGet<T>(path: string, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, undefined, options?.timeoutMs);
}

export function apiPost<T>(path: string, body: unknown, options?: { timeoutMs?: number }): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, options?.timeoutMs);
}

// POST /chat streams newline-delimited JSON instead of one JSON body (see
// trip-planner-api's routes/chat.ts) — each line is either
// {type:"progress",...} as the assistant's tool loop advances, or exactly
// one final {type:"result",...} (or {type:"error",...}) before the stream
// closes. onProgress fires for every progress line as it arrives, letting
// ChatPanel show what's actually happening (e.g. "Searching flights…")
// instead of a fixed spinner for the whole turn.
export async function apiPostStream<TProgress, TResult>(
  path: string,
  body: unknown,
  onProgress: (event: TProgress) => void,
  options?: { timeoutMs?: number },
): Promise<TResult> {
  const controller = options?.timeoutMs ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), options!.timeoutMs) : null;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller?.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${FRONTEND_API_SECRET}` },
    });
    if (!response.ok || !response.body) {
      const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorBody.error ?? `Request to ${path} failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: TResult | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const event = JSON.parse(line) as { type: "progress" | "result" | "error"; [key: string]: unknown };
        if (event.type === "progress") onProgress(event as TProgress);
        else if (event.type === "result") result = event as TResult;
        else if (event.type === "error") throw new Error(event.error as string);
      }
    }

    if (!result) throw new Error("The assistant's response ended unexpectedly. Please try again.");
    return result;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error("The assistant took too long to respond. Please try again.");
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}
