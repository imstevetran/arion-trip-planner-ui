import { useState } from "react";
import { t, type Locale } from "../lib/i18n";
import { suggestionLabel, suggestionToChatMessage, TRIP_SUGGESTIONS, type TripSuggestion } from "../lib/tripSuggestions";
import { useTurnstileToken } from "../lib/turnstile";
import { CreateTripForm } from "./CreateTripForm";
import { ChatPanel } from "./ChatPanel";

type CreationMode = "form" | "chat";

// Two ways to start a trip: fill in the fields directly, or describe it to
// the assistant (the exact same createTrip tool either way — chat mode just
// reuses ChatPanel with tripId=null, which already knows how to pick up the
// tripId the LLM's createTrip call returns). Defaults to form, per explicit
// product direction — chat is the opt-in alternative, not the default.
//
// One shared suggestion list (see lib/tripSuggestions.ts) feeds both: in
// form mode a chip prefills the fields, in chat mode it sends a ready-made
// message — same trip idea, delivered the way the active mode expects.
export function CreateTripEntry({
  locale,
  onLocaleChange,
  onCreated,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onCreated: (tripId: string, initialMessage?: string) => void;
}) {
  const [mode, setMode] = useState<CreationMode>("form");
  const [formPrefill, setFormPrefill] = useState<TripSuggestion | null>(null);
  const [chatMessage, setChatMessage] = useState<string | null>(null);
  // One shared widget for this whole screen (not one per mode) — createTrip
  // is the single action being gated here, regardless of which mode the
  // customer used to trigger it. See lib/turnstile.ts.
  const { containerRef: turnstileRef, getToken: getTurnstileToken } = useTurnstileToken("create-trip");

  function applySuggestion(suggestion: TripSuggestion) {
    if (mode === "form") {
      setFormPrefill(suggestion);
    } else {
      setChatMessage(suggestionToChatMessage(suggestion, locale));
    }
  }

  return (
    <div className={`create-trip ${mode === "chat" ? "chat-mode" : ""}`}>
      <div className="create-trip-head">
        <div className="mode-switch" role="group" aria-label="Trip creation mode">
          <button type="button" className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>
            {t(locale, "modeForm")}
          </button>
          <button type="button" className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>
            {t(locale, "modeChat")}
          </button>
        </div>
        <div className="lang-switch" role="group" aria-label="Language">
          <button type="button" className={locale === "en" ? "active" : ""} onClick={() => onLocaleChange("en")}>
            EN
          </button>
          <button type="button" className={locale === "vi" ? "active" : ""} onClick={() => onLocaleChange("vi")}>
            VI
          </button>
        </div>
      </div>

      <div className="suggestion-chips">
        <span className="suggestion-chips-label">{t(locale, "trending")}</span>
        {TRIP_SUGGESTIONS.map((suggestion) => (
          <button type="button" key={suggestion.id} className="chip" onClick={() => applySuggestion(suggestion)}>
            {suggestionLabel(suggestion, locale)}
          </button>
        ))}
      </div>

      {mode === "form" ? (
        <CreateTripForm
          locale={locale}
          prefill={formPrefill}
          getTurnstileToken={getTurnstileToken}
          onCreated={(trip, initialMessage) => onCreated(trip.id, initialMessage)}
        />
      ) : (
        <div className="create-trip-chat-body">
          <ChatPanel
            tripId={null}
            locale={locale}
            onTripIdChange={onCreated}
            onToolCallsExecuted={() => {}}
            externalMessage={chatMessage}
            onExternalMessageSent={() => setChatMessage(null)}
            getTurnstileToken={getTurnstileToken}
          />
        </div>
      )}
      {/* Managed mode: normally invisible, occasionally shows an interactive
          checkbox here if Cloudflare's risk engine wants one. */}
      <div ref={turnstileRef} className="turnstile-widget" />
    </div>
  );
}
