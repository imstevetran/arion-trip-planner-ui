import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { TripResource } from "../types";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";

// Own the map — not nested inside the timeline's scroll container (an
// explicit requirement from the design review). Renders straight off
// trip://current's stop coordinates + route geometry, redrawing whenever
// that resource changes (App.tsx polls it).

const markerIcon = new L.DivIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#d89b54;border:2px solid #0c1421;box-shadow:0 0 0 3px rgba(216,155,84,0.35)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

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

export function RouteMap({ trip, locale }: { trip: TripResource | null; locale: Locale }) {
  const stopPoints = useMemo<Array<[number, number]>>(
    () =>
      (trip?.stops ?? [])
        .filter((stop) => stop.latitude !== null && stop.longitude !== null)
        .map((stop) => [stop.latitude as number, stop.longitude as number]),
    [trip],
  );

  const routeLine = useMemo<Array<[number, number]>>(
    () => (trip?.route?.geometry ?? []).map(([lon, lat]) => [lat, lon]),
    [trip],
  );

  if (stopPoints.length === 0) {
    return <p className="map-empty">{t(locale, "noTripYet")}</p>;
  }

  return (
    <MapContainer center={stopPoints[0]} zoom={11} scrollWheelZoom zoomControl={false}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: "#e4ad63", weight: 3, dashArray: "1 8" }} />}
      {stopPoints.map((point, index) => (
        <Marker key={index} position={point} icon={markerIcon} />
      ))}
      <FitBounds points={stopPoints} />
    </MapContainer>
  );
}
