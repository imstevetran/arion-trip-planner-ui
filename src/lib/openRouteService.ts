import { API_BASE_URL, FRONTEND_API_SECRET } from "./api.js";

// trip-planner-api's own /routing/preview/:profile (routes/routing.ts) — a
// thin, authenticated passthrough to ORS that keeps the ORS API key out of
// this bundle entirely, same reasoning api.ts's requests already follow.
// This used to default to a same-origin /ors/... path that only Vite's dev
// proxy (vite.config.ts) ever answered; the deployed static site has
// nothing listening there, so every request 405'd once this shipped.
const ORS_DIRECTIONS_URL = `${API_BASE_URL}/routing/preview`;

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
  error?: { code?: number; message?: string } | string;
};

export async function fetchOrsProfiles(signal: AbortSignal): Promise<OrsTravelProfile[]> {
  const response = await fetch(`${API_BASE_URL}/routing/status`, {
    signal,
    headers: { Accept: "application/json", Authorization: `Bearer ${FRONTEND_API_SECRET}` },
  });
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
  async function request(snapRadius: number) {
    const response = await fetch(`${ORS_DIRECTIONS_URL}/${profile}`, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/geo+json, application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${FRONTEND_API_SECRET}`,
      },
      body: JSON.stringify({
        coordinates: [from, to],
        radiuses: [snapRadius, snapRadius],
        // ORS otherwise defaults to recommended/fastest. For an explicitly
        // selected A-to-B route the product requirement is minimum distance.
        preference: "shortest",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as OrsGeoJsonResponse;
    return { response, body };
  }

  // Keep endpoints attached to roads close to their marker. Only broaden
  // the search for large POIs whose geocoded centre has no road within the
  // self-hosted engine's normal 400 m snapping radius.
  let { response, body } = await request(400);
  if (!response.ok && typeof body.error !== "string" && body.error?.code === 2010) {
    ({ response, body } = await request(2_000));
  }
  const feature = body.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const summary = feature?.properties?.summary;
  if (!response.ok || !coordinates?.length || !summary) {
    const apiMessage = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(apiMessage ?? `OpenRouteService request failed (${response.status})`);
  }
  return { geometry: coordinates, distanceKm: (summary.distance ?? 0) / 1_000, durationMinutes: (summary.duration ?? 0) / 60 };
}
