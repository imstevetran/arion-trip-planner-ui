// Street-level photos for a map stop, via Google's Street View Static API.
//
// Two requests, in this order, and the order is the whole point:
//
//  1. /streetview/metadata — free, no quota consumed, and CORS-open
//     (Access-Control-Allow-Origin: *, verified). It answers whether Google
//     actually has a panorama near the stop, and returns the pano_id, the
//     panorama's *real* position (which is on the road, not on the stop) and
//     its capture date.
//  2. /streetview — the billed image endpoint, requested by pano_id so the
//     pixels are guaranteed to come from the panorama step 1 described.
//
// Skipping step 1 is what made the earlier attempt look broken: the image
// endpoint answers HTTP 200 with a generic grey "Sorry, we have no imagery
// here" JPEG rather than an error, so places without coverage rendered as
// grey boxes with no way to tell them apart from a real photo.
//
// The key is inlined into the public bundle by Vite, so it MUST be locked
// down in Google Cloud Console by HTTP referrer + restricted to the Street
// View Static API alone. See .env.example.

const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview";
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// A geocoded stop is the middle of a place or building, so the nearest
// panorama is typically tens of metres away on the adjacent road. 50m is the
// endpoint's own default and too tight for that; note this is documented on
// the image endpoint and only tacitly supported on metadata, so treat a
// too-small result as "Google ignored it" rather than a bug.
const SEARCH_RADIUS_METERS = 300;
// Each entry below is one *billed* image request per marker opened, so keep
// the count deliberate. The same four URLs back both the big view and the
// thumbnail strip — the browser serves the strip from cache, so switching
// views costs nothing extra.
const RELATIVE_HEADINGS = [0, 90, 180, 270];
const IMAGE_SIZE = "400x250";
const METERS_PER_DEGREE_LAT = 111_320;

export type StreetImage = {
  id: string;
  thumbUrl: string;
  heading: number;
  viewerUrl: string;
};

// "empty" = Google answered ZERO_RESULTS; there is genuinely no coverage.
// "missing-key" = VITE_GOOGLE_MAPS_API_KEY was never configured.
// "failed" = network error, or a metadata status that isn't OK/ZERO_RESULTS
//            (REQUEST_DENIED on a mis-restricted key is the common one).
export type StreetImageryResult =
  | {
      status: "ok";
      images: StreetImage[];
      capturedLabel: string | null;
      distanceMeters: number;
    }
  | { status: "empty" }
  | { status: "missing-key" }
  | { status: "failed"; message: string };

type MetadataResponse = {
  status?: string;
  pano_id?: string;
  date?: string;
  copyright?: string;
  location?: { lat?: number; lng?: number };
  error_message?: string;
};

function haversineMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRadians = Math.PI / 180;
  const meanLatCos = Math.cos(((fromLat + toLat) / 2) * toRadians);
  const dLat = (toLat - fromLat) * METERS_PER_DEGREE_LAT;
  const dLon = (toLon - fromLon) * METERS_PER_DEGREE_LAT * meanLatCos;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Compass bearing from the panorama towards the stop, so the default shot
// faces the place the traveller actually cares about instead of whichever
// way the survey car happened to be pointing.
function bearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRadians = Math.PI / 180;
  const [lat1, lat2] = [fromLat * toRadians, toLat * toRadians];
  const deltaLon = (toLon - fromLon) * toRadians;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

function imageUrl(panoId: string, heading: number): string {
  const query = new URLSearchParams({
    size: IMAGE_SIZE,
    pano: panoId,
    heading: heading.toFixed(1),
    fov: "90",
    pitch: "0",
    // Surface a real 404 instead of the grey placeholder. Coverage is
    // already confirmed by then, so this only ever fires on a genuine
    // problem (revoked key, retired panorama) - which the <img> onError
    // can then report honestly.
    return_error_code: "true",
    key: GOOGLE_MAPS_API_KEY as string,
  });
  return `${IMAGE_URL}?${query.toString()}`;
}

// Deep link into Google Maps' interactive panorama, opened on the same
// pano and facing the same way as the still that was clicked.
export function panoViewerUrl(panoId: string, heading: number): string {
  const query = new URLSearchParams({
    api: "1",
    map_action: "pano",
    pano: panoId,
    heading: heading.toFixed(1),
  });
  return `https://www.google.com/maps/@?${query.toString()}`;
}

// Fallback for when there is no panorama to link to - drops the viewer at
// the coordinates and lets Google find whatever is nearest.
export function exploreUrl(latitude: number, longitude: number): string {
  const query = new URLSearchParams({
    api: "1",
    map_action: "pano",
    viewpoint: `${latitude},${longitude}`,
  });
  return `https://www.google.com/maps/@?${query.toString()}`;
}

export async function fetchStreetImagery(
  latitude: number,
  longitude: number,
  signal: AbortSignal,
): Promise<StreetImageryResult> {
  if (!GOOGLE_MAPS_API_KEY) return { status: "missing-key" };

  try {
    const metadataQuery = new URLSearchParams({
      location: `${latitude},${longitude}`,
      radius: String(SEARCH_RADIUS_METERS),
      // Skip indoor photospheres (shop interiors, museum halls) - a stop
      // preview should show the street you would arrive on.
      source: "outdoor",
      key: GOOGLE_MAPS_API_KEY,
    });

    const response = await fetch(`${METADATA_URL}?${metadataQuery.toString()}`, { signal });
    const metadata = (await response.json()) as MetadataResponse;

    if (metadata.status === "ZERO_RESULTS" || metadata.status === "NOT_FOUND") {
      return { status: "empty" };
    }
    if (metadata.status !== "OK" || !metadata.pano_id) {
      return {
        status: "failed",
        message: metadata.error_message ?? metadata.status ?? `Street View metadata failed (${response.status})`,
      };
    }

    const panoId = metadata.pano_id;
    const panoLat = metadata.location?.lat ?? latitude;
    const panoLon = metadata.location?.lng ?? longitude;
    const distanceMeters = haversineMeters(latitude, longitude, panoLat, panoLon);
    // Standing essentially on the stop makes the bearing meaningless (and
    // numerically unstable), so just start facing north.
    const facing = distanceMeters < 2 ? 0 : bearingDegrees(panoLat, panoLon, latitude, longitude);

    const images = RELATIVE_HEADINGS.map((offset) => {
      const heading = (facing + offset) % 360;
      return {
        id: `${panoId}:${offset}`,
        thumbUrl: imageUrl(panoId, heading),
        heading,
        viewerUrl: panoViewerUrl(panoId, heading),
      };
    });

    return { status: "ok", images, capturedLabel: metadata.date ?? null, distanceMeters };
  } catch (error) {
    // An abort is the caller closing the popup or clicking another stop -
    // never surface it as a failure.
    if (signal.aborted) throw error;
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Street View request failed",
    };
  }
}
