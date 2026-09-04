import { useEffect, useRef, useState } from "react";
import { apiGet, apiPostStream } from "../lib/api";
import { STRINGS, t, type Locale } from "../lib/i18n";
import { renderInline, renderMarkdown } from "../lib/markdown";
import { callTool } from "../lib/webmcp/tools";
import { SendIcon } from "./icons";
import { CustomerDetailsForm } from "./CustomerDetailsForm";
import { KINDS_REQUIRING_CUSTOMER_DETAILS } from "./Timeline";
import type { ChatMessage, FleetVehicle, SuggestedAction, TripBooking, TripResource } from "../types";

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

type ApprovalItem = { booking: TripBooking; label: string; priceVnd: number | null; blocked: boolean };

// DOM anchors for the scroll-to links between the two cards below — the
// customer-details card points down to this once saved, and a blocked
// approval row points back up to it.
const CUSTOMER_DETAILS_CARD_ID = "customer-details-card";
const PENDING_APPROVALS_CARD_ID = "pending-approvals-card";

function scrollToCard(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Approving/rejecting/retrying a booking used to live in the Timeline
// (Plan) column via ApprovalRow — moved here so it's next to where the
// customer is already looking after a chat turn, instead of a separate
// column they had no reason to check. Timeline still shows a status pill
// and a "review in chat" pointer (see its own ApprovalRow).
function pendingApprovalItems(
  trip: TripResource,
  bookings: TripBooking[],
  fleet: FleetVehicle[],
  hasCustomerDetails: boolean,
): ApprovalItem[] {
  const items: ApprovalItem[] = [];
  for (const booking of bookings) {
    if (booking.status !== "pending_approval" && booking.status !== "approved" && booking.status !== "failed") {
      continue;
    }
    // Stays visible (unlike before) even while blocked on customer details
    // — hiding it entirely left no link back to the details card above it
    // once the customer scrolled past. approveBooking itself still refuses
    // this server-side regardless of what the button here does.
    const blocked = KINDS_REQUIRING_CUSTOMER_DETAILS.includes(booking.kind) && !hasCustomerDetails;

    if (booking.kind === "flight") {
      const option = trip.flightOptions.find((candidate) => candidate.id === booking.trip_flight_option_id);
      if (!option) continue;
      items.push({
        booking,
        label: `${option.carrier_name} ${option.flight_number}`,
        priceVnd: option.price_vnd,
        blocked,
      });
    } else if (booking.kind === "accommodation") {
      const option = trip.accommodationOptions.find(
        (candidate) => candidate.id === booking.trip_accommodation_option_id,
      );
      if (!option) continue;
      items.push({ booking, label: option.name, priceVnd: option.price_vnd_per_night, blocked });
    } else if (booking.kind === "vehicle") {
      if (!trip.vehicleAssignment || trip.vehicleAssignment.id !== booking.trip_vehicle_assignment_id) continue;
      const vehicle = fleet.find((candidate) => candidate.id === trip.vehicleAssignment!.vehicle_id);
      items.push({
        booking,
        label: vehicle ? `${vehicle.make} ${vehicle.model}` : "Vehicle",
        priceVnd: trip.vehicleAssignment.estimated_daily_rate_vnd,
        blocked,
      });
    }
  }
  return items;
}

function PendingApprovals({
  trip,
  bookings,
  fleet,
  hasCustomerDetails,
  locale,
  onChanged,
}: {
  trip: TripResource;
  bookings: TripBooking[];
  fleet: FleetVehicle[];
  hasCustomerDetails: boolean;
  locale: Locale;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const items = pendingApprovalItems(trip, bookings, fleet, hasCustomerDetails);
  if (items.length === 0) return null;

  async function act(bookingId: string, action: "approveBooking" | "rejectBooking") {
    setBusyId(bookingId);
    try {
      await callTool(action, { tripBookingId: bookingId });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="msg assistant" id={PENDING_APPROVALS_CARD_ID}>
      <div className="bubble pending-approvals-card">
        <div className="customer-details-title">{t(locale, "pendingApprovalsTitle")}</div>
        {items.map(({ booking, label, priceVnd, blocked }) => (
          <div key={booking.id} className="pending-approval-row">
            <div className="pending-approval-main">
              <span>
                {label}
                {priceVnd !== null ? ` · ${formatVnd(priceVnd)}` : ""}
              </span>
              {blocked && <p className="customer-details-pending-hint">{t(locale, "customerDetailsInChatHint")}</p>}
              {!blocked && booking.status === "failed" && (
                <p className="customer-details-error">{booking.failure_reason ?? t(locale, "bookingFailedGeneric")}</p>
              )}
            </div>
            {blocked ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => scrollToCard(CUSTOMER_DETAILS_CARD_ID)}
              >
                {t(locale, "customerDetailsFillAboveHint")}
              </button>
            ) : (
              <div className="stop-actions">
                <button
                  type="button"
                  className="btn approve"
                  disabled={busyId === booking.id}
                  onClick={() => act(booking.id, "approveBooking")}
                >
                  {booking.status === "failed" ? t(locale, "retry") : t(locale, "approve")}
                </button>
                <button
                  type="button"
                  className="btn reject"
                  disabled={busyId === booking.id}
                  onClick={() => act(booking.id, "rejectBooking")}
                >
                  {t(locale, "reject")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type ChatTurnResponse = {
  reply: string;
  tripId: string | null;
  toolCalls: string[];
  suggestedActions?: SuggestedAction[];
  calendarSync?: ChatMessage["calendarSync"];
};

// Mirrors trip-planner-api's ChatProgressEvent (chat/agent.ts) — streamed
// line-by-line over POST /chat (see lib/api.ts's apiPostStream) as the
// assistant's tool loop advances.
type ChatProgressEvent =
  | { type: "progress"; stage: "thinking"; fallback?: true }
  | { type: "progress"; stage: "tool"; tool: string };

// A tool name the backend hasn't got a label for yet (or a human-gated one
// like approveBooking that the chat loop never actually calls) falls back
// to the generic "thinking" text rather than showing nothing or a raw
// camelCase tool name to the customer.
function toolStatusText(locale: Locale, tool: string): string {
  const key = `toolStatus_${tool}` as keyof typeof STRINGS.en;
  return STRINGS[locale][key] ?? t(locale, "thinking");
}

// Keyed by message index — ephemeral, per-render-only UI state for the
// checkbox + Confirm/Cancel panel under a message's suggestedActions.
// Deliberately not folded into ChatMessage itself: the history poll can
// replace the whole `messages` array wholesale, and re-deriving "which
// message a given selection belongs to" from a stable id isn't possible
// since history messages have no id, only position.
type ActionsUiState = { selected: Set<string>; dismissed: boolean };

function SuggestedActionsPanel({
  actions,
  uiState,
  onToggle,
  onConfirm,
  onCancel,
  locale,
}: {
  actions: SuggestedAction[];
  uiState: ActionsUiState;
  onToggle: (label: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  locale: Locale;
}) {
  if (uiState.dismissed) return null;
  return (
    <div className="suggested-actions">
      {actions.map((action) => (
        <label className="suggested-action-row" key={action.label}>
          <input
            type="checkbox"
            checked={uiState.selected.has(action.label)}
            onChange={() => onToggle(action.label)}
          />
          <span>
            <strong>{action.label}</strong>
            {action.description ? <> — {renderInline(action.description, action.label)}</> : null}
          </span>
        </label>
      ))}
      <div className="suggested-action-buttons">
        <button type="button" className="btn reject" onClick={onCancel}>
          {t(locale, "cancel")}
        </button>
        <button
          type="button"
          className="btn approve"
          disabled={uiState.selected.size === 0}
          onClick={onConfirm}
        >
          {t(locale, "confirm")}
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({
  tripId,
  locale,
  onTripIdChange,
  onToolCallsExecuted,
  externalMessage,
  onExternalMessageSent,
  onStartNewTrip,
  onCloseTrip,
  getTurnstileToken,
  needsCustomerDetails = false,
  onCustomerDetailsSaved,
  trip,
  bookings,
  fleet,
  onBookingsChanged,
}: {
  tripId: string | null;
  locale: Locale;
  onTripIdChange: (id: string) => void;
  onToolCallsExecuted: () => void;
  // A suggestion chip elsewhere in the UI can push a ready-made message in
  // here and have it sent immediately, same as if the customer had typed
  // and pressed send themselves.
  externalMessage?: string | null;
  onExternalMessageSent?: () => void;
  onStartNewTrip?: () => void;
  onCloseTrip?: () => void;
  // Only provided (and only needed) pre-trip — see CreateTripEntry. Once a
  // trip exists, this panel is a different mounted instance entirely (the
  // app shell's, in App.tsx) and every message already carries a real
  // tripId, so there's nothing here for Turnstile to gate.
  getTurnstileToken?: () => Promise<string>;
  // App.tsx computes this from trip+bookings (a pending vehicle/flight
  // booking with no traveler identity on file yet) — shown as a card below
  // the conversation rather than blocking a specific message, since it's
  // trip state, not something any one chat turn produced.
  needsCustomerDetails?: boolean;
  onCustomerDetailsSaved?: () => void;
  // Same trip/bookings/fleet state Timeline renders from — needed here too
  // now that approving/rejecting a booking happens in this panel. Omitted
  // (and PendingApprovals stays hidden) for the pre-trip instance and the
  // shared/read-only view, neither of which has anything to approve.
  trip?: TripResource | null;
  bookings?: TripBooking[];
  fleet?: FleetVehicle[];
  onBookingsChanged?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // What the assistant is doing right now — driven live by the backend's
  // stream of ChatProgressEvent lines (see agent.ts/routes/chat.ts), not
  // guessed from elapsed time. Falls back to "thinking" before the first
  // event of a turn arrives.
  const [stage, setStage] = useState<
    { kind: "tool"; tool: string } | { kind: "thinking"; fallback?: true }
  >({ kind: "thinking" });
  // Only used while stage is "thinking" with no tool name to show yet — a
  // single model call can itself run up to ~180s (see llmClient.ts), and
  // silently sitting on three dots that whole time reads as broken, not
  // slow. Resets on every new stage (a fresh visible step earns a fresh
  // budget of patience) rather than just once per turn.
  const [thinkingTier, setThinkingTier] = useState<0 | 1 | 2>(0);
  const [actionsUi, setActionsUi] = useState<Record<number, ActionsUiState>>({});
  // Tracks locally whether the traveler-details card below was just
  // submitted, independent of the `needsCustomerDetails` prop — that prop
  // flips false the instant App.tsx's refresh() picks up the saved details,
  // which unmounts the form with no trace it ever succeeded (confirmed
  // live: customers reported nothing visibly happening after saving).
  // Staying true here instead swaps the form for a confirmation + next-step
  // hint, and this can't be a message in `messages` — the 4s history poll
  // above replaces that array wholesale and would wipe an unpersisted one.
  const [detailsSaved, setDetailsSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHistoryLength = useRef(0);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setThinkingTier(0);
    if (!busy) return;
    const slow = window.setTimeout(() => setThinkingTier(1), 6_000);
    const verySlow = window.setTimeout(() => setThinkingTier(2), 20_000);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(verySlow);
    };
  }, [busy, stage]);

  // Poll chat history so a backend-initiated disruption turn (see
  // trip-planner-api's chat/disruptionTurn.ts) shows up here without the
  // customer having said anything — a real push channel (SSE) would replace
  // this polling loop, kept simple for now.
  //
  // Fetches once immediately on mount, not just on the first interval tick:
  // this component remounts fresh (empty `messages`) the instant a trip gets
  // created, because that swaps CreateTripEntry's chat panel out for the app
  // shell's — confirmed live, the reply that created the trip would
  // otherwise vanish from view for up to 4s while the new instance waited
  // for its first poll.
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    async function poll() {
      try {
        const data = await apiGet<{ messages: ChatMessage[] }>(`/chat/${tripId}/history`);
        if (cancelled) return;
        // A history request may have started before send() added its
        // optimistic user message. Never let that stale response replace the
        // in-flight turn; the next poll after the turn settles will reconcile
        // against the server's completed history.
        if (requestInFlight.current) return;
        if (data.messages.length !== lastHistoryLength.current) {
          lastHistoryLength.current = data.messages.length;
          setMessages(data.messages);
          setActionsUi({});
        }
      } catch {
        // transient — next poll will retry
      }
    }
    void poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tripId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    // Also waits on `busy` — send() itself no-ops while a previous turn is
    // still in flight, so without this a chip clicked mid-reply would get
    // silently dropped (this effect would still fire once, send() would
    // bail, and the pending message would already be cleared). Re-running
    // when busy flips back to false retries it instead of losing it.
    if (!externalMessage || busy) return;
    void send(externalMessage);
    onExternalMessageSent?.();
    // Deliberately omits send/onExternalMessageSent — send closes over
    // draft/tripId/locale, which change every render and would turn this
    // into a resend loop if included.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMessage, busy]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? draft).trim();
    if (!text || requestInFlight.current) return;
    requestInFlight.current = true;
    if (overrideText === undefined) setDraft("");
    setMessages((current) => [...current, { role: "user", text }]);
    setStage({ kind: "thinking" });
    setBusy(true);
    try {
      // Every message before a trip exists is a potential createTrip call —
      // the model decides which one actually triggers it, so this can't be
      // narrowed to just the triggering turn. See trip-planner-api's
      // routes/chat.ts.
      const turnstileToken = !tripId ? await getTurnstileToken?.() : undefined;
      const result = await apiPostStream<ChatProgressEvent, ChatTurnResponse>(
        "/chat",
        { tripId, message: text, locale, ...(turnstileToken ? { turnstileToken } : {}) },
        (event) =>
          setStage(
            event.stage === "tool"
              ? { kind: "tool", tool: event.tool }
              : { kind: "thinking", ...(event.fallback ? { fallback: true } : {}) },
          ),
        // A tool-driven turn commonly needs two model calls: one to select
        // and run tools, then another to turn their results into the final
        // reply. The API allows each model call up to 180s, so the browser
        // must not abort halfway through a still-valid backend turn.
        { timeoutMs: 390_000 },
      );
      setMessages((current) => [
        ...current,
        { role: "assistant", text: result.reply, suggestedActions: result.suggestedActions, calendarSync: result.calendarSync },
      ]);
      lastHistoryLength.current += 2;
      if (result.tripId && result.tripId !== tripId) onTripIdChange(result.tripId);
      if (result.toolCalls.length > 0) onToolCallsExecuted();
    } catch (error) {
      // The raw error (e.g. "LLM gateway request failed (500): {...}") is
      // real diagnostic detail, not something a customer should have to
      // read as the assistant's "reply" — confirmed live, a customer
      // reported the assistant "doesn't reply anything" when what actually
      // happened was this exact JSON blob rendered in the bubble.
      console.error("[chat] send failed:", error);
      setMessages((current) => [...current, { role: "assistant", text: t(locale, "chatError") }]);
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function toggleAction(index: number, label: string) {
    setActionsUi((current) => {
      const existing = current[index] ?? { selected: new Set<string>(), dismissed: false };
      const selected = new Set(existing.selected);
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      return { ...current, [index]: { ...existing, selected } };
    });
  }

  function dismissActions(index: number) {
    setActionsUi((current) => ({
      ...current,
      [index]: { selected: current[index]?.selected ?? new Set(), dismissed: true },
    }));
  }

  function confirmActions(index: number) {
    const selected = actionsUi[index]?.selected;
    if (!selected || selected.size === 0) return;
    dismissActions(index);
    void send(`${t(locale, "actionsConfirmedPrefix")}${Array.from(selected).join(", ")}.`);
  }

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <h3>{t(locale, "chat")}</h3>
        {(onStartNewTrip || onCloseTrip) && (
          <div className="chat-trip-actions">
            {onStartNewTrip && <button type="button" onClick={onStartNewTrip}>{locale === "vi" ? "Chuyến mới" : "New trip"}</button>}
            {onCloseTrip && <button type="button" className="close-trip" aria-label={locale === "vi" ? "Đóng chuyến hiện tại" : "Close current trip"} onClick={onCloseTrip}>×</button>}
          </div>
        )}
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && <p className="empty-hint">{t(locale, "noTripYet")}</p>}
        {messages.map((message, index) => (
          <div className={`msg ${message.role}`} key={index}>
            <div className="bubble">
              {message.role === "assistant" ? renderMarkdown(message.text) : message.text}
            </div>
            {message.role === "assistant" && message.suggestedActions && message.suggestedActions.length > 0 && (
              <SuggestedActionsPanel
                actions={message.suggestedActions}
                uiState={actionsUi[index] ?? { selected: new Set(), dismissed: false }}
                onToggle={(label) => toggleAction(index, label)}
                onConfirm={() => confirmActions(index)}
                onCancel={() => dismissActions(index)}
                locale={locale}
              />
            )}
            {message.role === "assistant" && message.calendarSync?.status === "authorization_required" && message.calendarSync.authorizationUrl && (
              <a className="calendar-chat-link" href={message.calendarSync.authorizationUrl}>
                {locale === "vi" ? "Ket noi Google Calendar" : "Connect Google Calendar"}
              </a>
            )}
            {message.role === "assistant" && message.calendarSync?.status === "synced" && message.calendarSync.calendarUrl && (
              <a className="calendar-chat-link" href={message.calendarSync.calendarUrl} target="_blank" rel="noreferrer">
                {message.calendarSync.syncedEventCount} {locale === "vi" ? "events da dong bo" : "events synced"} ↗
              </a>
            )}
          </div>
        ))}
        {(needsCustomerDetails || detailsSaved) && (
          <div className="msg assistant" id={CUSTOMER_DETAILS_CARD_ID}>
            <div className="bubble customer-details-card">
              {detailsSaved ? (
                <>
                  <p className="customer-details-saved">✓ {t(locale, "customerDetailsSaved")}</p>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => scrollToCard(PENDING_APPROVALS_CARD_ID)}
                  >
                    {t(locale, "reviewPendingBookingHint")}
                  </button>
                </>
              ) : (
                <CustomerDetailsForm
                  locale={locale}
                  onSaved={() => {
                    setDetailsSaved(true);
                    onCustomerDetailsSaved?.();
                  }}
                />
              )}
            </div>
          </div>
        )}
        {trip && bookings && (
          <PendingApprovals
            trip={trip}
            bookings={bookings}
            fleet={fleet ?? []}
            hasCustomerDetails={Boolean(trip.trip.customer_full_name && trip.trip.customer_phone)}
            locale={locale}
            onChanged={() => onBookingsChanged?.()}
          />
        )}
        {busy && (
          <div className="msg assistant">
            <div className="bubble typing">
              <span />
              <span />
              <span />
              <em className="typing-status">
                {stage.kind === "tool"
                  ? toolStatusText(locale, stage.tool)
                  : stage.fallback
                    ? t(locale, "thinkingFallback")
                    : t(locale, thinkingTier === 2 ? "thinkingVerySlow" : thinkingTier === 1 ? "thinkingSlow" : "thinking")}
              </em>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
          placeholder={t(locale, "chatPlaceholder")}
          disabled={busy}
        />
        <button className="send-btn" onClick={() => void send()} disabled={busy || !draft.trim()}>
          <SendIcon style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  );
}
