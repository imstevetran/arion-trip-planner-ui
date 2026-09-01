import { getWebMcpServer } from "./server.js";
import { apiGet } from "../api.js";
import { getCurrentTripId } from "./state.js";

function jsonResourceContent(uri: URL, data: unknown) {
  return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }] };
}

export function registerAllResources(): void {
  const server = getWebMcpServer();

  server.registerResource({
    uri: "trip://current",
    name: "Current trip",
    description: "Full timeline snapshot: stops, flight, accommodation, vehicle, budget, and route geometry.",
    mimeType: "application/json",
    read: async (uri) => {
      const tripId = getCurrentTripId();
      if (!tripId) return jsonResourceContent(uri, null);
      const data = await apiGet(`/resources/trip/${tripId}`);
      return jsonResourceContent(uri, data);
    },
  });

  server.registerResource({
    uri: "fleet://vehicles",
    name: "Fleet vehicles",
    description: "Candidate Arion vehicles available for the trip.",
    mimeType: "application/json",
    read: async (uri) => jsonResourceContent(uri, await apiGet("/resources/fleet")),
  });

  server.registerResource({
    uri: "trip://bookings",
    name: "Trip bookings",
    description: "The approval-gated booking audit log for the current trip.",
    mimeType: "application/json",
    read: async (uri) => {
      const tripId = getCurrentTripId();
      if (!tripId) return jsonResourceContent(uri, { bookings: [] });
      return jsonResourceContent(uri, await apiGet(`/resources/trip/${tripId}/bookings`));
    },
  });

  server.registerResource({
    uri: "trip://disruptions",
    name: "Trip disruptions",
    description: "Active/unacknowledged disruptions for the current trip.",
    mimeType: "application/json",
    read: async (uri) => {
      const tripId = getCurrentTripId();
      if (!tripId) return jsonResourceContent(uri, { disruptions: [] });
      return jsonResourceContent(uri, await apiGet(`/resources/trip/${tripId}/disruptions`));
    },
  });
}
