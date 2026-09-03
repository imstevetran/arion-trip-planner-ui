import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { TripResource, TripStop } from "../types";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";

// Own the map — not nested inside the timeline's scroll container (an
// explicit requirement from the design review). Renders straight off
// trip://current's stop coordinates + route geometry, redrawing whenever
// that resource changes (App.tsx polls it).

function markerIcon(sequence: number, selection: "origin" | "destination" | null) {
  const background = selection === "origin" ? "#168457" : selection === "destination" ? "#d85a54" : "#d89b54";
  const label = selection === "origin" ? "A" : selection === "destination" ? "B" : String(sequence);
  return new L.DivIcon({
    className: "trip-stop-marker",
    html: `<span style="background:${background}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

function ResizeMap() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// Default view when there are no geocoded stops yet (centered on Vietnam) —
// keeps a live, pannable map on screen at all times instead of swapping in a
// text placeholder, which read as "the map is broken" rather than "no route
// yet" (confirmed live: a customer testing a fresh trip expected the map to
// already be there, not appear only once stops are geocoded).
const DEFAULT_CENTER: [number, number] = [16.05, 108.2];
const DEFAULT_ZOOM = 5;

export function RouteMap({ trip, locale }: { trip: TripResource | null; locale: Locale }) {
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([]);
  const stops = useMemo(
    () => (trip?.stops ?? []).filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [trip],
  );
  const stopPoints = useMemo<Array<[number, number]>>(
    () =>
      stops
        .map((stop) => [stop.latitude as number, stop.longitude as number]),
    [stops],
  );

  const selectedStops = useMemo(
    () => selectedStopIds.map((id) => stops.find((stop) => stop.id === id)).filter((stop): stop is TripStop => Boolean(stop)),
    [selectedStopIds, stops],
  );

  const routeLine = useMemo<Array<[number, number]>>(
    () => (trip?.route?.geometry ?? []).map(([lon, lat]) => [lat, lon]),
    [trip],
  );

  const selectedLeg = useMemo(() => {
    if (selectedStops.length !== 2 || !trip?.route) return null;
    const [from, to] = selectedStops;
    return trip.route.legs.find((leg) => leg.fromStopId === from.id && leg.toStopId === to.id) ?? null;
  }, [selectedStops, trip]);

  const googleMapsUrl = useMemo(() => {
    if (selectedStops.length !== 2) return null;
    const [origin, destination] = selectedStops;
    const query = new URLSearchParams({
      api: "1",
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
      travelmode: "driving",
      utm_source: "arion_trip_planner",
      utm_campaign: "selected_stops_directions",
    });
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  }, [selectedStops]);

  const copy = locale === "vi"
    ? {
        select: "Chọn 2 địa điểm để mở chỉ đường",
        origin: "Điểm đi",
        destination: "Điểm đến",
        plannedLeg: "Chặng trong lịch trình (ORS)",
        openGoogleMaps: "Mở chỉ đường Google Maps",
        reverse: "Đổi chiều",
        clear: "Xóa chọn",
      }
    : {
        select: "Select two places for directions",
        origin: "From",
        destination: "To",
        plannedLeg: "Planned leg (ORS)",
        openGoogleMaps: "Open directions in Google Maps",
        reverse: "Swap",
        clear: "Clear",
      };

  function toggleStop(stopId: string) {
    setSelectedStopIds((currentIds) => {
      const ids = currentIds.filter((id) => stops.some((stop) => stop.id === id));
      if (ids.includes(stopId)) return ids.filter((id) => id !== stopId);
      return ids.length < 2 ? [...ids, stopId] : [ids[1], stopId];
    });
  }

  return (
    <div className="map-shell">
      <MapContainer
        center={stopPoints[0] ?? DEFAULT_CENTER}
        zoom={stopPoints[0] ? 11 : DEFAULT_ZOOM}
        scrollWheelZoom
        zoomControl={false}
      >
        <ResizeMap />
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: "#e4ad63", weight: 3, dashArray: "1 8" }} />}
        {stops.map((stop) => {
          const selection = selectedStopIds[0] === stop.id ? "origin" : selectedStopIds[1] === stop.id ? "destination" : null;
          return (
            <Marker
              key={stop.id}
              position={[stop.latitude as number, stop.longitude as number]}
              icon={markerIcon(stop.sequence, selection)}
              eventHandlers={{ click: () => toggleStop(stop.id) }}
            >
              <Tooltip direction="top" offset={[0, -14]}>{stop.place_name}</Tooltip>
            </Marker>
          );
        })}
        {stopPoints.length > 0 && <FitBounds points={stopPoints} />}
      </MapContainer>
      {stops.length > 0 && (
        <aside className="map-directions-card" aria-live="polite">
          {selectedStops.length < 2 ? (
            <p>{copy.select}</p>
          ) : (
            <>
              <div className="map-directions-places">
                <p><span className="map-directions-label origin">A</span><b>{copy.origin}</b> {selectedStops[0].place_name}</p>
                <p><span className="map-directions-label destination">B</span><b>{copy.destination}</b> {selectedStops[1].place_name}</p>
              </div>
              {selectedLeg && <p className="map-directions-leg">{copy.plannedLeg}: {selectedLeg.distanceKm.toFixed(1)} km · {Math.round(selectedLeg.durationMinutes)} min</p>}
              <a className="map-google-directions" href={googleMapsUrl ?? undefined} target="_blank" rel="noreferrer">
                {copy.openGoogleMaps}
              </a>
              <div className="map-directions-actions">
                <button type="button" onClick={() => setSelectedStopIds(([from, to]) => to ? [to, from] : [])}>{copy.reverse}</button>
                <button type="button" onClick={() => setSelectedStopIds([])}>{copy.clear}</button>
              </div>
            </>
          )}
        </aside>
      )}
      {stopPoints.length === 0 && <p className="map-empty">{t(locale, "mapEmpty")}</p>}
    </div>
  );
}
