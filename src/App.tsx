import { useCallback, useEffect, useState } from "react";
import { registerAllTools } from "./lib/webmcp/tools";
import { registerAllResources } from "./lib/webmcp/resources";
import { setCurrentLocale, setCurrentTripId } from "./lib/webmcp/state";
import { apiGet } from "./lib/api";
import type { Locale } from "./lib/i18n";
import type { FleetVehicle, Trip, TripBooking, TripDisruption, TripResource } from "./types";
import { CreateTripForm } from "./components/CreateTripForm";
import { Timeline } from "./components/Timeline";
import { ChatPanel } from "./components/ChatPanel";
import { RouteMap } from "./components/RouteMap";

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

  useEffect(() => {
    apiGet<{ vehicles: FleetVehicle[] }>("/resources/fleet")
      .then((data) => setFleet(data.vehicles))
      .catch(() => setFleet([]));
  }, []);

  if (!tripId) {
    return (
      <CreateTripForm
        locale={locale}
        onLocaleChange={setLocale}
        onCreated={(newTrip: Trip) => setTripId(newTrip.id)}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="map-column">
        <RouteMap trip={trip} locale={locale} />
      </div>
      {trip ? (
        <Timeline trip={trip} bookings={bookings} disruptions={disruptions} fleet={fleet} locale={locale} onChanged={refresh} />
      ) : (
        <div className="app-main">
          <p className="empty-hint">Loading…</p>
        </div>
      )}
      <ChatPanel
        tripId={tripId}
        locale={locale}
        onTripIdChange={setTripId}
        onToolCallsExecuted={() => void refresh()}
      />
    </div>
  );
}
