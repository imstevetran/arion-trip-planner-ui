import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { TripResource, TripStop } from "../types";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import type { StreetImageryResult } from "../lib/streetImagery";
import { exploreUrl, fetchStreetImagery } from "../lib/streetImagery";

// Own the map — not nested inside the timeline's scroll container (an
// explicit requirement from the design review). Renders straight off
// trip://current's stop coordinates + route geometry, redrawing whenever
// that resource changes (App.tsx polls it).

// offset shifts the pin away from its true latlng *in screen pixels*, which
// is how coincident stops are pulled apart (see spreadCoincidentStops).
// Pixels rather than degrees so the fan stays the same size at every zoom.
function markerIcon(
  sequence: number,
  selection: "origin" | "destination" | null,
  offset: [number, number],
) {
  const background = selection === "origin" ? "#168457" : selection === "destination" ? "#d85a54" : "#d89b54";
  const label = selection === "origin" ? "A" : selection === "destination" ? "B" : String(sequence);
  const [dx, dy] = offset;
  return new L.DivIcon({
    className: "trip-stop-marker",
    html: `<span style="background:${background}">${label}</span>`,
    iconSize: [28, 28],
    // The anchor is the point that sits on the latlng, so moving it by -offset
    // draws the whole pin by +offset.
    iconAnchor: [14 - dx, 14 - dy],
    // ...and the popup has to follow the pin, not the latlng.
    popupAnchor: [dx, dy - 16],
  });
}

// ORS geocoding regularly resolves several stops to the *same* point: it
// searches with a hard 80km boundary.circle around the destination and
// size=1, so any place name Pelias doesn't actually hold (a small village,
// a named viewpoint) falls back to the best in-circle match, which is
// usually the destination locality itself. Those pins then stack exactly on
// top of each other and the map looks like it only has one stop. Fanning
// them out keeps every suggested stop visible and individually clickable.
// The real fix belongs in trip-planner-api's geocodePlace; this makes the
// map honest either way.
const COINCIDENT_PRECISION = 4; // ~11m — closer than this and pins overlap anyway
const FAN_RADIUS_PX = 22;

function spreadCoincidentStops(stops: TripStop[]): Map<string, [number, number]> {
  const groups = new Map<string, TripStop[]>();
  for (const stop of stops) {
    const key = `${(stop.latitude as number).toFixed(COINCIDENT_PRECISION)},${(stop.longitude as number).toFixed(COINCIDENT_PRECISION)}`;
    const group = groups.get(key);
    if (group) group.push(stop);
    else groups.set(key, [stop]);
  }

  const offsets = new Map<string, [number, number]>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      offsets.set(group[0].id, [0, 0]);
      continue;
    }
    // Ring around the shared point, starting at 12 o'clock.
    const radius = FAN_RADIUS_PX * (group.length > 6 ? 1.6 : 1);
    group.forEach((stop, index) => {
      const angle = (index / group.length) * 2 * Math.PI - Math.PI / 2;
      offsets.set(stop.id, [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
    });
  }
  return offsets;
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  const fittedPointsKey = useRef<string | null>(null);
  useEffect(() => {
    if (points.length === 0) return;
    const pointsKey = points.map(([lat, lon]) => `${lat},${lon}`).join(";");
    if (fittedPointsKey.current === pointsKey) return;
    fittedPointsKey.current = pointsKey;

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
// Street-level photos come from Google's Street View Static API - see
// lib/streetImagery.ts for the free metadata probe that has to happen first.
function useStreetImagery(latitude: number, longitude: number): { status: "loading" } | StreetImageryResult {
  // Keyed by coordinate so switching stops reads as "loading" on the very
  // first render, without an effect having to setState to get there.
  const coordinateKey = `${latitude},${longitude}`;
  const [loaded, setLoaded] = useState<{ key: string; result: StreetImageryResult } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStreetImagery(latitude, longitude, controller.signal)
      .then((result) => setLoaded({ key: coordinateKey, result }))
      // Only ever rejects on abort - a new stop or a closed panel, both of
      // which have already replaced or unmounted this state.
      .catch(() => {});
    return () => controller.abort();
  }, [coordinateKey, latitude, longitude]);

  return loaded?.key === coordinateKey ? loaded.result : { status: "loading" };
}

// A compact thumbnail card that opens *on the marker* (a Leaflet popup),
// rather than a panel docked to the corner of the map — clicking a pin
// should show the photo right there, the way Google Maps does it. Clicking
// the thumbnail opens that exact photo in Mapillary's interactive viewer.
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function compassLabel(heading: number): string {
  return COMPASS_POINTS[Math.round(heading / 45) % 8];
}

function StreetViewPopupContent({
  stop,
  locale,
  onContentResize,
}: {
  stop: TripStop;
  locale: Locale;
  onContentResize: () => void;
}) {
  const latitude = stop.latitude as number;
  const longitude = stop.longitude as number;
  const imagery = useStreetImagery(latitude, longitude);
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageBroken, setImageBroken] = useState(false);

  // react-leaflet re-measures a popup when its *children* prop changes, which
  // covers mounting this card but not the async hop from skeleton to photos
  // (that state lives in here, so RouteMap never re-renders). Without the
  // nudge leaflet keeps the skeleton's height and the grown card can hang off
  // the top of the map instead of auto-panning into view.
  useEffect(() => {
    onContentResize();
  }, [onContentResize, imagery.status, imageBroken]);

  const copy = locale === "vi"
    ? {
        loading: "Đang tìm ảnh…",
        empty: "Google chưa có ảnh Street View quanh điểm này.",
        missingKey: "Chưa cấu hình VITE_GOOGLE_MAPS_API_KEY.",
        failed: "Không tải được ảnh.",
        imageFailed: "Google tứ chối ảnh này — kiểm tra giối hạn referrer của API key.",
        open: "Mở Street View tương tác",
        explore: "Xem quanh đây",
        altPrefix: "Ảnh Street View gần ",
        otherShots: "Hướng nhìn khác",
        away: "cách điểm",
      }
    : {
        loading: "Looking for photos…",
        empty: "Google has no Street View coverage around this stop.",
        missingKey: "VITE_GOOGLE_MAPS_API_KEY isn't configured.",
        failed: "Couldn't load photos.",
        imageFailed: "Google refused this image — check the API key's referrer restrictions.",
        open: "Open interactive Street View",
        explore: "Look around here",
        altPrefix: "Street View near ",
        otherShots: "Other directions",
        away: "away",
      };

  if (imagery.status === "loading") {
    return (
      <div className="street-view-pop">
        <div className="street-view-skeleton" />
        <p>{copy.loading}</p>
      </div>
    );
  }

  if (imagery.status !== "ok") {
    const message =
      imagery.status === "empty" ? copy.empty
      : imagery.status === "missing-key" ? copy.missingKey
      : `${copy.failed} ${imagery.message}`;
    return (
      <div className="street-view-pop">
        <p>{message}</p>
        <a className="street-view-explore" href={exploreUrl(latitude, longitude)} target="_blank" rel="noreferrer">
          {copy.explore}
        </a>
      </div>
    );
  }

  const active = imagery.images[Math.min(activeIndex, imagery.images.length - 1)];

  return (
    <div className="street-view-pop">
      {imageBroken ? (
        <p>{copy.imageFailed}</p>
      ) : (
        <a className="street-view-main" href={active.viewerUrl} target="_blank" rel="noreferrer" title={copy.open}>
          <img
            src={active.thumbUrl}
            alt={`${copy.altPrefix}${stop.place_name}`}
            // return_error_code=true means a real 404 rather than Google's
            // grey placeholder, so this only fires on an actual problem.
            onError={() => setImageBroken(true)}
          />
          <span className="street-view-look" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12a8 8 0 0 1 13.5-5.8L20 8" />
              <path d="M20 4v4h-4" />
              <path d="M20 12a8 8 0 0 1-13.5 5.8L4 16" />
              <path d="M4 20v-4h4" />
            </svg>
          </span>
        </a>
      )}

      <p className="street-view-meta">
        <span>{compassLabel(active.heading)}</span>
        {imagery.distanceMeters >= 2 && <span>{Math.round(imagery.distanceMeters)} m {copy.away}</span>}
        {imagery.capturedLabel !== null && <span>{imagery.capturedLabel}</span>}
      </p>

      {!imageBroken && imagery.images.length > 1 && (
        <div className="street-view-thumbs" aria-label={copy.otherShots}>
          {imagery.images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={index === activeIndex ? "is-active" : undefined}
              onClick={() => setActiveIndex(index)}
              aria-label={`${copy.altPrefix}${stop.place_name} - ${compassLabel(image.heading)}`}
              aria-pressed={index === activeIndex}
            >
              {/* Same four URLs as the big view, so the strip is served from
                  cache and costs no extra billed requests. */}
              <img src={image.thumbUrl} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StopMarker({
  stop,
  locale,
  selection,
  offset,
  isPreviewing,
  onSelect,
  onPopupClose,
}: {
  stop: TripStop;
  locale: Locale;
  selection: "origin" | "destination" | null;
  offset: [number, number];
  isPreviewing: boolean;
  onSelect: () => void;
  onPopupClose: () => void;
}) {
  const popupRef = useRef<L.Popup | null>(null);
  const updatePopup = useCallback(() => popupRef.current?.update(), []);

  return (
    <Marker
      position={[stop.latitude as number, stop.longitude as number]}
      icon={markerIcon(stop.sequence, selection, offset)}
      eventHandlers={{ click: onSelect, popupclose: onPopupClose }}
    >
      {/* Hovering the open pin would otherwise float the tooltip right on
          top of its own photo card. */}
      {!isPreviewing && (
        <Tooltip direction="top" offset={[offset[0], offset[1] - 14]}>{stop.place_name}</Tooltip>
      )}
      <Popup ref={popupRef} className="street-view-popup" closeButton={false} minWidth={196} maxWidth={196} autoPan autoPanPadding={[16, 16]}>
        {/* Mounted only for the open pin — react-leaflet renders popup
            children eagerly, and a Mapillary lookup per stop on every map
            render is exactly what we don't want. */}
        {isPreviewing && <StreetViewPopupContent stop={stop} locale={locale} onContentResize={updatePopup} />}
      </Popup>
    </Marker>
  );
}

export function RouteMap({ trip, locale }: { trip: TripResource | null; locale: Locale }) {
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([]);
  const [previewStopId, setPreviewStopId] = useState<string | null>(null);
  const allStops = trip?.stops ?? [];
  const stops = useMemo(
    () => (trip?.stops ?? []).filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [trip],
  );
  // trip-planner-api geocodes draft stops a few per poll, so "fewer pins
  // than stops" is a normal transient state — say so instead of silently
  // dropping them, which reads as the map losing stops.
  const ungeocodedCount = allStops.length - stops.length;
  const markerOffsets = useMemo(() => spreadCoincidentStops(stops), [stops]);
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
        geocoding: (count: number) => `Đang định vị ${count} điểm còn lại…`,
      }
    : {
        select: "Select two places for directions",
        origin: "From",
        destination: "To",
        plannedLeg: "Planned leg (ORS)",
        openGoogleMaps: "Open directions in Google Maps",
        reverse: "Swap",
        clear: "Clear",
        geocoding: (count: number) => `Locating ${count} more ${count === 1 ? "stop" : "stops"}…`,
      };

  function toggleStop(stopId: string) {
    setPreviewStopId(stopId);
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
        {stops.map((stop) => (
          <StopMarker
            key={stop.id}
            stop={stop}
            locale={locale}
            selection={selectedStopIds[0] === stop.id ? "origin" : selectedStopIds[1] === stop.id ? "destination" : null}
            offset={markerOffsets.get(stop.id) ?? [0, 0]}
            isPreviewing={previewStopId === stop.id}
            onSelect={() => toggleStop(stop.id)}
            onPopupClose={() => setPreviewStopId((current) => (current === stop.id ? null : current))}
          />
        ))}
        {stopPoints.length > 0 && <FitBounds points={stopPoints} />}
      </MapContainer>
      {ungeocodedCount > 0 && <p className="map-geocoding-note">{copy.geocoding(ungeocodedCount)}</p>}
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
