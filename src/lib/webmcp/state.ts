// The tool/resource execute()/read() closures are registered once, but the
// trip they operate on (and the active language) changes over the session —
// this is the single mutable source of truth they read from at call time,
// kept in sync by App.tsx.
let currentTripId: string | null = null;
let currentLocale: "en" | "vi" = "en";

export function setCurrentTripId(id: string | null): void {
  currentTripId = id;
}

export function getCurrentTripId(): string | null {
  return currentTripId;
}

export function setCurrentLocale(locale: "en" | "vi"): void {
  currentLocale = locale;
}

export function getCurrentLocale(): "en" | "vi" {
  return currentLocale;
}
