import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { TripResource, TripStop } from "../types";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { fetchOrsProfiles, fetchOrsRoute, type OrsRoute, type OrsTravelProfile } from "../lib/openRouteService";

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

// A compact thumbnail card that opens *on the marker* (a Leaflet popup),
// rather than a panel docked to the corner of the map. The photo is a
// best-effort Wikipedia match (trip-planner-api's routing/wikimedia.ts,
// cached on the stop as image_url/image_attribution — no API key, no
// billing) — already present on `stop` from the trip resource poll, so
// unlike the old Google Street View version this needs no separate fetch
// or loading state at all.
function StopPhotoPopupContent({
  stop,
  locale,
  onContentResize,
}: {
  stop: TripStop;
  locale: Locale;
  onContentResize: () => void;
}) {
  const [imageBroken, setImageBroken] = useState(false);

  // react-leaflet re-measures a popup when its *children* prop changes,
  // which covers mounting this card but not the img load itself — without
  // the nudge leaflet can size the popup before the image's real aspect
  // ratio is known.
  useEffect(() => {
    onContentResize();
  }, [onContentResize, imageBroken]);

  const copy = locale === "vi"
    ? { empty: "Chưa có ảnh cho điểm này.", imageFailed: "Không tải được ảnh này." }
    : { empty: "No photo available for this stop yet.", imageFailed: "Couldn't load this image." };

  if (!stop.image_url || imageBroken) {
    return (
      <div className="street-view-pop">
        <p>{imageBroken ? copy.imageFailed : copy.empty}</p>
      </div>
    );
  }

  return (
    <div className="street-view-pop">
      <div className="street-view-main">
        <img src={stop.image_url} alt={stop.place_name} onError={() => setImageBroken(true)} />
      </div>
      {stop.image_attribution && <p className="street-view-meta">{stop.image_attribution}</p>}
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
  const markerRef = useRef<L.Marker | null>(null);
  const map = useMap();
  const icon = useMemo(() => markerIcon(stop.sequence, selection, offset), [offset, selection, stop.sequence]);
  const updatePopup = useCallback(() => {
    const popup = popupRef.current;
    // Async Street View state can settle just after Leaflet closes/detaches
    // the popup. Updating that detached instance makes Leaflet touch a null
    // `_source`, so only remeasure while it is still open on the marker.
    if (popup?.isOpen()) popup.update();
  }, []);

  // Fires both for a direct pin click and for RouteMap setting
  // previewStopId from a Plan-column click (App.tsx's stopToFocus) — either
  // way, this stop becoming the previewed one should pan it into view.
  // openPopup() is a harmless no-op on the direct-click path (Leaflet
  // already opens a marker's bound popup on click); it's the whole point on
  // the Plan → Map path, where nothing was actually clicked on the map.
  useEffect(() => {
    if (!isPreviewing) return;
    map.panTo([stop.latitude as number, stop.longitude as number]);
    markerRef.current?.openPopup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewing]);

  return (
    <Marker
      ref={markerRef}
      position={[stop.latitude as number, stop.longitude as number]}
      icon={icon}
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
        {isPreviewing && <StopPhotoPopupContent stop={stop} locale={locale} onContentResize={updatePopup} />}
      </Popup>
    </Marker>
  );
}

export function RouteMap({
  trip,
  locale,
  onStopClick,
  stopToFocus,
}: {
  trip: TripResource | null;
  locale: Locale;
  // Lets App.tsx scroll the matching stop card into view in the Plan
  // column and highlight it — clicking a pin should point at "this is
  // where that is in your itinerary," not just open the photo popup.
  onStopClick?: (stopId: string) => void;
  // The Plan → Map direction: App.tsx sets this (a fresh object each time,
  // so clicking the same Plan item twice in a row still re-triggers it)
  // when a stop card is clicked there.
  stopToFocus?: { stopId: string } | null;
}) {
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([]);
  const [previewStopId, setPreviewStopId] = useState<string | null>(null);

  useEffect(() => {
    if (stopToFocus) setPreviewStopId(stopToFocus.stopId);
    // Only the arrival of a *new* focus request should move the preview —
    // not every render where the same object is still the latest one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopToFocus]);
  const [travelProfile, setTravelProfile] = useState<OrsTravelProfile>("driving-car");
  const [selectedRoute, setSelectedRoute] = useState<OrsRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "error">("idle");
  const [routeError, setRouteError] = useState("");
  const [supportedProfiles, setSupportedProfiles] = useState<OrsTravelProfile[]>(["driving-car"]);
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

  const selectedRouteLine = useMemo<Array<[number, number]>>(
    () => (selectedRoute?.geometry ?? []).map(([lon, lat]) => [lat, lon]),
    [selectedRoute],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchOrsProfiles(controller.signal)
      .then((profiles) => setSupportedProfiles(profiles.length > 0 ? profiles : ["driving-car"]))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const selectedFrom = selectedStops[0];
  const selectedTo = selectedStops[1];
  const fromId = selectedFrom?.id ?? null;
  const fromLatitude = selectedFrom?.latitude ?? null;
  const fromLongitude = selectedFrom?.longitude ?? null;
  const toId = selectedTo?.id ?? null;
  const toLatitude = selectedTo?.latitude ?? null;
  const toLongitude = selectedTo?.longitude ?? null;

  useEffect(() => {
    if (!fromId || !toId || fromLatitude === null || fromLongitude === null || toLatitude === null || toLongitude === null) {
      const reset = window.setTimeout(() => {
        setSelectedRoute(null);
        setRouteStatus("idle");
        setRouteError("");
      }, 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      setSelectedRoute(null);
      setRouteStatus("loading");
      setRouteError("");
      fetchOrsRoute(
        [fromLongitude, fromLatitude],
        [toLongitude, toLatitude],
        travelProfile,
        controller.signal,
      ).then((route) => {
        setSelectedRoute(route);
        setRouteStatus("idle");
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRouteStatus("error");
        setRouteError(error instanceof Error ? error.message : "OpenRouteService request failed");
      });
    }, 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
    };
  }, [fromId, fromLatitude, fromLongitude, toId, toLatitude, toLongitude, travelProfile]);

  const mapFitPoints = useMemo<Array<[number, number]>>(() => {
    if (selectedRouteLine.length > 1) return selectedRouteLine;
    if (selectedStops.length === 2) {
      return selectedStops.map((stop) => [stop.latitude as number, stop.longitude as number]);
    }
    return stopPoints;
  }, [selectedRouteLine, selectedStops, stopPoints]);

  const copy = locale === "vi"
    ? {
        select: "Chọn 2 địa điểm để mở chỉ đường",
        origin: "Điểm đi",
        destination: "Điểm đến",
        plannedLeg: "Chặng trong lịch trình (ORS)",
        openGoogleMaps: "Mở chỉ đường Google Maps",
        travelMode: "Phương tiện",
        loadingRoute: "Đang tìm tuyến đường bằng ORS…",
        routeFailed: "Không thể tìm tuyến đường",
        unavailableMode: "Chưa được bật trên ORS server",
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
        travelMode: "Travel mode",
        loadingRoute: "Finding a route with ORS…",
        routeFailed: "Could not find a route",
        unavailableMode: "Not enabled on the ORS server",
        reverse: "Swap",
        clear: "Clear",
        geocoding: (count: number) => `Locating ${count} more ${count === 1 ? "stop" : "stops"}…`,
      };

  const travelModes: Array<{ value: OrsTravelProfile; label: string; icon: string }> = locale === "vi"
    ? [
        { value: "driving-car", label: "Ô tô", icon: "🚗" },
        { value: "foot-walking", label: "Đi bộ", icon: "🚶" },
        { value: "cycling-regular", label: "Xe đạp", icon: "🚲" },
        { value: "cycling-electric", label: "Xe đạp điện", icon: "⚡" },
        { value: "foot-hiking", label: "Đi bộ đường dài", icon: "🥾" },
      ]
    : [
        { value: "driving-car", label: "Car", icon: "🚗" },
        { value: "foot-walking", label: "Walking", icon: "🚶" },
        { value: "cycling-regular", label: "Bicycle", icon: "🚲" },
        { value: "cycling-electric", label: "E-bike", icon: "⚡" },
        { value: "foot-hiking", label: "Hiking", icon: "🥾" },
      ];
  const activeTravelMode = travelModes.find((mode) => mode.value === travelProfile)!;

  function toggleStop(stopId: string) {
    setPreviewStopId(stopId);
    onStopClick?.(stopId);
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
        {selectedRouteLine.length > 1 && <Polyline positions={selectedRouteLine} pathOptions={{ color: "#168457", weight: 5, opacity: 0.9 }} />}
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
        {mapFitPoints.length > 0 && <FitBounds points={mapFitPoints} />}
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
              <details className="map-travel-mode">
                <summary>
                  <span>{copy.travelMode}</span>
                  <b className="map-travel-current"><span className="map-travel-icon" aria-hidden="true">{activeTravelMode.icon}</span>{activeTravelMode.label}</b>
                </summary>
                <div className="map-travel-options">
                  {travelModes.map((mode) => (
                    <label
                      key={mode.value}
                      className={`${travelProfile === mode.value ? "is-selected" : ""}${supportedProfiles.includes(mode.value) ? "" : " is-disabled"}`.trim() || undefined}
                      title={supportedProfiles.includes(mode.value) ? undefined : copy.unavailableMode}
                    >
                      <input type="radio" name="travel-profile" checked={travelProfile === mode.value} disabled={!supportedProfiles.includes(mode.value)} onChange={() => setTravelProfile(mode.value)} />
                      <span className="map-travel-icon" aria-hidden="true">{mode.icon}</span>{mode.label}
                    </label>
                  ))}
                </div>
              </details>
              {supportedProfiles.length === 1 && <p className="map-route-profile-note">{copy.unavailableMode}</p>}
              {routeStatus === "loading" && <p className="map-route-status">{copy.loadingRoute}</p>}
              {routeStatus === "error" && <p className="map-route-error">{copy.routeFailed}: {routeError}</p>}
              {selectedRoute && <p className="map-directions-leg">ORS: {selectedRoute.distanceKm.toFixed(1)} km · {Math.round(selectedRoute.durationMinutes)} min</p>}
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
