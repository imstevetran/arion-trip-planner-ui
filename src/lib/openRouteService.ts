const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions";
const ORS_API_KEY = import.meta.env.VITE_OPENROUTESERVICE_API_KEY as string | undefined;

export type OrsTravelProfile = "driving-car" | "foot-walking" | "cycling-regular" | "cycling-electric" | "foot-hiking";

export type OrsRoute = {
  geometry: Array<[number, number]>;
  distanceKm: number;
  durationMinutes: number;
};

type OrsGeoJsonResponse = {
  features?: Array<{
    geometry?: { coordinates?: Array<[number, number]> };
    properties?: { summary?: { distance?: number; duration?: number } };
  }>;
  error?: { message?: string } | string;
};

export async function fetchOrsRoute(
  from: [number, number],
  to: [number, number],
  profile: OrsTravelProfile,
  signal: AbortSignal,
): Promise<OrsRoute> {
  if (!ORS_API_KEY) throw new Error("VITE_OPENROUTESERVICE_API_KEY is not configured");

  const response = await fetch(`${ORS_DIRECTIONS_URL}/${profile}/geojson`, {
    method: "POST",
    signal,
    headers: { Accept: "application/geo+json, application/json", Authorization: ORS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [from, to] }),
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
