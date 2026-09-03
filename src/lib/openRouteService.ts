// Same-origin by default: Vite proxies /ors in development, avoiding ORS's
// browser CORS rejection and keeping the API key out of the JS bundle.
// Deployments can point this at an equivalent server-side proxy endpoint.
const ORS_DIRECTIONS_URL =
  (import.meta.env.VITE_ORS_DIRECTIONS_URL as string | undefined) ?? "/ors/v2/directions";

export type OrsTravelProfile = "driving-car" | "foot-walking" | "cycling-regular" | "cycling-electric" | "foot-hiking";

export type OrsRoute = {
  geometry: Array<[number, number]>;
  distanceKm: number;
  durationMinutes: number;
};

type OrsStatusResponse = {
  profiles?: Record<string, unknown>;
};

type OrsGeoJsonResponse = {
  features?: Array<{
    geometry?: { coordinates?: Array<[number, number]> };
    properties?: { summary?: { distance?: number; duration?: number } };
  }>;
  error?: { message?: string } | string;
};

export async function fetchOrsProfiles(signal: AbortSignal): Promise<OrsTravelProfile[]> {
  const response = await fetch("/ors/v2/status", { signal, headers: { Accept: "application/json" } });
  const body = (await response.json().catch(() => ({}))) as OrsStatusResponse;
  if (!response.ok || !body.profiles) throw new Error(`OpenRouteService status failed (${response.status})`);
  return Object.keys(body.profiles).filter((profile): profile is OrsTravelProfile =>
    ["driving-car", "foot-walking", "cycling-regular", "cycling-electric", "foot-hiking"].includes(profile),
  );
}

export async function fetchOrsRoute(
  from: [number, number],
  to: [number, number],
  profile: OrsTravelProfile,
  signal: AbortSignal,
): Promise<OrsRoute> {
  const response = await fetch(`${ORS_DIRECTIONS_URL}/${profile}/geojson`, {
    method: "POST",
    signal,
    headers: { Accept: "application/geo+json, application/json", "Content-Type": "application/json" },
    // Geocoders often return the centre of a large attraction rather than
    // its roadside entrance. The self-hosted engine accepts a wider search
    // radius, preventing otherwise valid POIs from failing at its 400 m
    // default snap distance (for example Marble Mountains).
    body: JSON.stringify({ coordinates: [from, to], radiuses: [2_000, 2_000] }),
  });
  const body = (await response.json().catch(() => ({}))) as OrsGeoJsonResponse;
  const feature = body.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  if (!response.ok || !coordinates?.length || !summary) {
    const apiMessage = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(apiMessage ?? `OpenRouteService request failed (${response.status})`);
  }
  return { geometry: coordinates, distanceKm: (summary.distance ?? 0) / 1_000, durationMinutes: (summary.duration ?? 0) / 60 };
}
