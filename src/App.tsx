import { useCallback, useEffect, useState } from "react";
import { callTool, registerAllTools } from "./lib/webmcp/tools";
import { registerAllResources } from "./lib/webmcp/resources";
import { setCurrentLocale, setCurrentTripId } from "./lib/webmcp/state";
import { apiGet } from "./lib/api";
import type { Locale } from "./lib/i18n";
import type { FleetVehicle, TripBooking, TripDisruption, TripResource } from "./types";
import { CreateTripEntry } from "./components/CreateTripEntry";
import { Timeline } from "./components/Timeline";
import { ChatPanel } from "./components/ChatPanel";
import { RouteMap } from "./components/RouteMap";
import { PlanOptions } from "./components/PlanOptions";

const TRIP_ID_STORAGE_KEY = "arion-trip-planner:tripId";
const LOCALE_STORAGE_KEY = "arion-trip-planner:locale";

let toolsRegistered = false;

export default function App() {
  const [tripId, setTripId] = useState<string | null>(() => localStorage.getItem(TRIP_ID_STORAGE_KEY));
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem(LOCALE_STORAGE_KEY) as Locale) ?? "en");
  const [trip, setTrip] = useState<TripResource | null>(null);
  const [bookings, setBookings] = useState<TripBooking[]>([]);
  const [disruptions, setDisruptions] = useState<TripDisruption[]>([]);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"plan" | "map">("plan");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [desktopPlanOpen, setDesktopPlanOpen] = useState(true);

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
    if (tripId) localStorage.setItem(TRIP_ID_STORAGE_KEY, tripId);
  }, [tripId]);

  useEffect(() => {
    setCurrentLocale(locale);
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    try {
      const [tripData, bookingsData, disruptionsData] = await Promise.all([
        apiGet<TripResource>(`/resources/trip/${tripId}`),
        apiGet<{ bookings: TripBooking[] }>(`/resources/trip/${tripId}/bookings`),
        apiGet<{ disruptions: TripDisruption[] }>(`/resources/trip/${tripId}/disruptions`),
      ]);
      setTrip(tripData);
      setBookings(bookingsData.bookings);
      setDisruptions(disruptionsData.disruptions);
    } catch {
      // transient — next refresh (poll or tool-triggered) will retry
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    void refresh();
    // Poll so a disruption's effect on trip_bookings/disruptions shows up
    // even without an explicit tool call from this tab.
    const interval = setInterval(() => void refresh(), 6000);
    return () => clearInterval(interval);
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
    apiGet<{ vehicles: FleetVehicle[] }>("/resources/fleet")
      .then((data) => setFleet(data.vehicles))
      .catch(() => setFleet([]));
  }, []);

  if (!tripId) {
    return <CreateTripEntry locale={locale} onLocaleChange={setLocale} onCreated={(id, message) => {
      setTripId(id);
      setAssistantMessage(message ?? null);
    }} />;
  }

  return (
    <div className={`app-shell mobile-${mobileView}${mobileChatOpen ? " mobile-chat-open" : ""}${desktopPlanOpen ? "" : " plan-collapsed"}`}>
      <div className="mobile-nav" aria-label="Trip view">
        <button type="button" className={mobileView === "plan" ? "active" : ""} onClick={() => setMobileView("plan")}>Plan</button>
        <button type="button" className={mobileView === "map" ? "active" : ""} onClick={() => setMobileView("map")}>Map</button>
        <button type="button" className="mobile-chat-trigger" onClick={() => setMobileChatOpen(true)}>Ask agent</button>
      </div>
      <div className="map-column">
        <RouteMap trip={trip} locale={locale} />
        <button type="button" className="desktop-plan-toggle" onClick={() => setDesktopPlanOpen((open) => !open)}>
          {desktopPlanOpen ? "Hide plan" : "Show plan"}
        </button>
      </div>
      {trip ? (
        <div className="app-main">
          {trip.trip.status === "draft" || trip.trip.status === "planning" ? <PlanOptions locale={locale} onChoose={openAssistantWithMessage} /> : null}
          <Timeline trip={trip} bookings={bookings} disruptions={disruptions} fleet={fleet} locale={locale} onChanged={refresh} onAskAssistant={openAssistantWithMessage} embedded />
        </div>
      ) : (
        <div className="app-main">
          <p className="empty-hint">Loading…</p>
        </div>
      )}
      <div className="chat-column">
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
        />
      </div>
    </div>
  );
}
