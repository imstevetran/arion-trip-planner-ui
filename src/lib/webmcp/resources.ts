import { getWebMcpServer } from "./server.js";
import { apiGet } from "../api.js";
import { getCurrentTripId } from "./state.js";

function jsonResourceContent(uri: URL, data: unknown) {
  return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data) }] };
}

export function registerAllResources(): void {
  const server = getWebMcpServer();

  // registerResource is an MCP-B extension beyond the base WebMCP spec
  // (@mcp-b/global's own README is explicit about this) — a visiting
  // browser that already defines a partial document.modelContext of its
  // own (a native implementation, or another extension) before this app's
  // script runs gets wrapped as-is rather than replaced, and may only
  // implement the base spec. Confirmed live: that crashed app bootstrap
  // entirely ("registerResource is not a function") for at least one real
  // visitor. Resources are this app's own introspection surface, not
  // required for the tools every actual booking action goes through, so
  // degrading to "no resources" here beats taking the whole app down.
  if (typeof server.registerResource !== "function") {
    console.warn("[webmcp] registerResource unavailable on this document.modelContext — skipping resource registration.");
    return;
  }

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
