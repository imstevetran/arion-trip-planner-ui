import { useCallback, useEffect, useRef, useState } from "react";
import { callTool, registerAllTools } from "./lib/webmcp/tools";
import { registerAllResources } from "./lib/webmcp/resources";
import { setCurrentLocale, setCurrentTripId } from "./lib/webmcp/state";
import { apiGet } from "./lib/api";
import type { Locale } from "./lib/i18n";
import type { FleetVehicle, TripBooking, TripDisruption, TripResource } from "./types";
import { CreateTripEntry } from "./components/CreateTripEntry";
import { Timeline, KINDS_REQUIRING_CUSTOMER_DETAILS } from "./components/Timeline";
import { ChatPanel } from "./components/ChatPanel";
import { RouteMap } from "./components/RouteMap";
import { PlanOptions } from "./components/PlanOptions";

const TRIP_ID_STORAGE_KEY = "arion-trip-planner:tripId";
const LOCALE_STORAGE_KEY = "arion-trip-planner:locale";

let toolsRegistered = false;

export default function App() {
  const sharedTripId = new URLSearchParams(window.location.search).get("share");
  const isSharedView = Boolean(sharedTripId);
  const [tripId, setTripId] = useState<string | null>(() => sharedTripId ?? localStorage.getItem(TRIP_ID_STORAGE_KEY));
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem(LOCALE_STORAGE_KEY) as Locale) ?? "en");
  const [trip, setTrip] = useState<TripResource | null>(null);
  const [bookings, setBookings] = useState<TripBooking[]>([]);
  const [disruptions, setDisruptions] = useState<TripDisruption[]>([]);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"plan" | "map">("plan");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [desktopPlanOpen, setDesktopPlanOpen] = useState(true);
  // Set (a fresh object each time) when a map pin is clicked — Timeline
  // scrolls that stop card into view and highlights it briefly. A new
  // object on every click, rather than just the stopId, means clicking the
  // *same* pin twice in a row still re-triggers Timeline's effect (a plain
  // stopId wouldn't change on the second click).
  const [stopToHighlight, setStopToHighlight] = useState<{ stopId: string } | null>(null);
  // The reverse direction — set when a Plan stop card is clicked, consumed
  // by RouteMap to pan to and open that pin's popup.
  const [stopToFocus, setStopToFocus] = useState<{ stopId: string } | null>(null);

  function leaveCurrentTrip() {
    localStorage.removeItem(TRIP_ID_STORAGE_KEY);
    setTripId(null);
    setTrip(null);
    setBookings([]);
    setDisruptions([]);
    setAssistantMessage(null);
    setMobileChatOpen(false);
  }

  function openAssistantWithMessage(message: string) {
    setAssistantMessage(message);
    setMobileChatOpen(true);
  }

  // Registered once, module-scoped guard so React StrictMode's double-invoke
  // in dev doesn't register every tool twice.
  useEffect(() => {
    if (toolsRegistered) return;
    toolsRegistered = true;
    registerAllTools();
    registerAllResources();
  }, []);

  useEffect(() => {
    setCurrentTripId(tripId);
    if (tripId && !isSharedView) localStorage.setItem(TRIP_ID_STORAGE_KEY, tripId);
  }, [tripId, isSharedView]);

  useEffect(() => {
    setCurrentLocale(locale);
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  // Geocoding/route computation can take a while when ORS's quota is
  // exhausted (a real, ongoing state this session — every stop falls back
  // to a throttled Nominatim call). Confirmed live: a plain 6s setInterval
  // with no in-flight guard fired a *new* /resources/trip/:id poll on top
  // of one still pending once a single fetch started taking longer than
  // 6s, and each new poll competes for the exact same rate-limited
  // fallback path — a pileup that only gets worse over time and can look
  // indistinguishable from the page being stuck loading forever, even
  // though any one request in isolation does eventually resolve.
  const refreshInFlight = useRef(false);
  // Mirrors `trip` synchronously, unlike the state variable itself — the
  // adaptive-polling scheduler below reads this from inside a stable
  // useEffect closure (deliberately not re-run on every `trip` update, see
  // its own comment) that would otherwise only ever see whatever `trip`
  // was at the moment that effect last ran.
  const latestTripRef = useRef<TripResource | null>(null);
  const refresh = useCallback(async () => {
    if (!tripId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const [tripData, bookingsData, disruptionsData] = await Promise.all([
        // Geocoding-heavy trips can genuinely take a while server-side (see
        // refreshInFlight's comment) — bounded so a rare truly-stuck
        // request can't hold refreshInFlight true forever and silently
        // block every later poll.
        apiGet<TripResource>(`/resources/trip/${tripId}`, { timeoutMs: 45_000 }),
        isSharedView ? Promise.resolve({ bookings: [] }) : apiGet<{ bookings: TripBooking[] }>(`/resources/trip/${tripId}/bookings`),
        isSharedView ? Promise.resolve({ disruptions: [] }) : apiGet<{ disruptions: TripDisruption[] }>(`/resources/trip/${tripId}/disruptions`),
      ]);
      setTrip(tripData);
      latestTripRef.current = tripData;
      setBookings(bookingsData.bookings);
      setDisruptions(disruptionsData.disruptions);
    } catch {
      // transient — next refresh (poll or tool-triggered) will retry
    } finally {
      refreshInFlight.current = false;
    }
  }, [tripId, isSharedView]);

  // trip-planner-api's GET /resources/trip/:id now returns immediately and
  // finishes geocoding/place-image/route work in the background (see
  // resources.ts) — a real fix for the 45s+ responses that used to block
  // on that work, but it means the response right after an action that
  // triggers it (selecting a planning style, refining the route) can show
  // stale data, with nothing to update it until the *next* poll. A flat 6s
  // cadence made that feel like up to a 6s stall. Polling fast while there's
  // visible unfinished work (an ungeocoded stop, or 2+ geocoded stops with
  // no route yet) closes most of that gap; capped at MAX_FAST_POLLS so a
  // trip whose route will never resolve (e.g. Phu Quoc's route exceeding
  // the self-hosted ORS server's 100km limit — a real, permanent
  // constraint, not "not finished yet") doesn't poll fast forever.
  const FAST_POLL_MS = 1_500;
  const NORMAL_POLL_MS = 6_000;
  const MAX_FAST_POLLS = 10;
  const fastPollsRemaining = useRef(MAX_FAST_POLLS);

  useEffect(() => {
    if (!tripId) return;
    fastPollsRemaining.current = MAX_FAST_POLLS;
    let cancelled = false;
    let timeoutId: number;

    async function tick() {
      await refresh();
      if (cancelled) return;
      timeoutId = window.setTimeout(() => void tick(), nextDelay());
    }

    function nextDelay(): number {
      const current = latestTripRef.current;
      const stillCatchingUp = current
        ? current.stops.some((stop) => stop.latitude === null) ||
          (current.stops.filter((stop) => stop.latitude !== null).length >= 2 && current.route === null)
        : true; // no data yet — assume still settling
      if (!stillCatchingUp) {
        fastPollsRemaining.current = MAX_FAST_POLLS; // reset for the next action
        return NORMAL_POLL_MS;
      }
      if (fastPollsRemaining.current <= 0) return NORMAL_POLL_MS;
      fastPollsRemaining.current -= 1;
      return FAST_POLL_MS;
    }

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // No dependency on `trip` itself — nextDelay reads latestTripRef
    // instead, precisely so this effect never has to re-run (and so never
    // has to reset the fast-poll budget) just because a poll updated the
    // trip state.
  }, [tripId, refresh]);

  // Google redirects back here after consent. Complete the original request
  // automatically so the person lands on the synced result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar") !== "connected" || params.get("tripId") !== tripId) return;
    window.history.replaceState({}, "", window.location.pathname);
    void callTool("addPlanToGoogleCalendar").then(() => refresh());
  }, [tripId, refresh]);

  useEffect(() => {
    if (isSharedView) return;
    apiGet<{ vehicles: FleetVehicle[] }>("/resources/fleet")
      .then((data) => setFleet(data.vehicles))
      .catch(() => setFleet([]));
  }, [isSharedView]);

  if (!tripId) {
    return <CreateTripEntry locale={locale} onLocaleChange={setLocale} onCreated={(id, message) => {
      setTripId(id);
      setAssistantMessage(message ?? null);
    }} />;
  }

  // Drives the traveler-details card ChatPanel shows — same condition
  // Timeline's ApprovalRow used to gate the inline form on, now computed
  // once here since ChatPanel needs it too. Real bookings (vehicle/flight)
  // can't be placed under a placeholder identity.
  const hasCustomerDetails = Boolean(trip?.trip.customer_full_name && trip?.trip.customer_phone);
  const needsCustomerDetails =
    !hasCustomerDetails &&
    bookings.some(
      (booking) =>
        KINDS_REQUIRING_CUSTOMER_DETAILS.includes(booking.kind) &&
        (booking.status === "pending_approval" || booking.status === "approved"),
    );

  return (
    <div className={`app-shell mobile-${mobileView}${mobileChatOpen ? " mobile-chat-open" : ""}${desktopPlanOpen ? "" : " plan-collapsed"}${isSharedView ? " shared-view" : ""}`}>
      <div className="mobile-nav" aria-label="Trip view">
        <button type="button" className={mobileView === "plan" ? "active" : ""} onClick={() => setMobileView("plan")}>Plan</button>
        <button type="button" className={mobileView === "map" ? "active" : ""} onClick={() => setMobileView("map")}>Map</button>
      </div>
      {!isSharedView && <button
        type="button"
        className="mobile-chat-trigger"
        aria-label="Ask agent"
        title="Ask agent"
        onClick={() => setMobileChatOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.8 8.8 0 0 1-3.55-.92L4 20l1.32-3.95A7.36 7.36 0 0 1 4 11.5a7.5 7.5 0 0 1 8-7.48 7.5 7.5 0 0 1 8 7.48Z" />
          <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
        </svg>
      </button>}
      <div className="map-column">
        <RouteMap
          trip={trip}
          locale={locale}
          stopToFocus={stopToFocus}
          onStopClick={(stopId) => {
            setStopToHighlight({ stopId });
            setMobileView("plan");
            setDesktopPlanOpen(true);
          }}
        />
        <button type="button" className="desktop-plan-toggle" onClick={() => setDesktopPlanOpen((open) => !open)}>
          {desktopPlanOpen ? "Hide plan" : "Show plan"}
        </button>
      </div>
      {trip ? (
        <div className="app-main">
          {!isSharedView && (trip.trip.status === "draft" || trip.trip.status === "planning") ? <PlanOptions locale={locale} onChoose={openAssistantWithMessage} /> : null}
          <Timeline
            trip={trip}
            tripId={tripId}
            bookings={bookings}
            disruptions={disruptions}
            fleet={fleet}
            locale={locale}
            onChanged={refresh}
            onAskAssistant={openAssistantWithMessage}
            embedded
            readOnly={isSharedView}
            stopToHighlight={stopToHighlight}
            onStopClick={(stopId) => {
              setStopToFocus({ stopId });
              setMobileView("map");
            }}
          />
        </div>
      ) : (
        <div className="app-main">
          <p className="empty-hint">Loading…</p>
        </div>
      )}
      {!isSharedView && <div className="chat-column">
        <button type="button" className="mobile-chat-close" onClick={() => setMobileChatOpen(false)}>Close</button>
        <ChatPanel
          tripId={tripId}
          locale={locale}
          onTripIdChange={setTripId}
          onToolCallsExecuted={() => void refresh()}
          externalMessage={assistantMessage}
          onExternalMessageSent={() => setAssistantMessage(null)}
          onStartNewTrip={leaveCurrentTrip}
          onCloseTrip={leaveCurrentTrip}
          needsCustomerDetails={needsCustomerDetails}
          onCustomerDetailsSaved={() => void refresh()}
        />
      </div>}
    </div>
  );
}
