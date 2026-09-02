import { useCallback, useEffect, useRef, useState } from "react";

// Turnstile sitekeys are meant to be public (unlike the secret, which never
// leaves trip-planner-api) — safe to hardcode. Registered for localhost,
// 127.0.0.1, and arion-trip-planner-ui.pages.dev (+ its Pages preview
// subdomains); trip-planner-api's siteverify call checks the matching
// TURNSTILE_SECRET.
const SITEKEY = "0x4AAAAAAEk82PaI3493dUE-";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Turnstile"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Mounts one Turnstile widget (managed mode — invisible unless Cloudflare's
// risk engine wants an interactive check) bound to `action`, and returns a
// container ref to render plus a getToken() that resolves the next fresh
// token. Tokens are single-use, so getToken() resets the widget after each
// read to start solving the next one — the caller awaits it right before
// the request that needs it, not ahead of time.
export function useTurnstileToken(action: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // The widget solves continuously in the background (reset after every
  // consume) — this holds whatever token is currently sitting unconsumed,
  // if the solve finished before anyone asked for it.
  const availableTokenRef = useRef<string | null>(null);
  const pendingResolversRef = useRef<Array<(token: string) => void>>([]);
  const [tokenReady, setTokenReady] = useState(false);

  const consumeAndReset = useCallback((token: string) => {
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    return token;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITEKEY,
        action,
        callback: (token) => {
          const resolvers = pendingResolversRef.current;
          if (resolvers.length > 0) {
            pendingResolversRef.current = resolvers.slice(1);
            resolvers[0](consumeAndReset(token));
          } else {
            availableTokenRef.current = token;
            setTokenReady(true);
          }
        },
      });
    });
    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const getToken = useCallback((): Promise<string> => {
    const available = availableTokenRef.current;
    if (available) {
      availableTokenRef.current = null;
      setTokenReady(false);
      return Promise.resolve(consumeAndReset(available));
    }
    return new Promise((resolve) => {
      pendingResolversRef.current = [...pendingResolversRef.current, resolve];
    });
  }, [consumeAndReset]);

  return { containerRef, getToken, tokenReady };
}
