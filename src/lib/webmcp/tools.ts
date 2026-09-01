import type { InputSchema } from "@mcp-b/webmcp-types";
import { getWebMcpServer } from "./server.js";
import { apiPost } from "../api.js";
import { getCurrentLocale, getCurrentTripId } from "./state.js";

// Mirrors apps/trip-planner-api/src/webmcp/toolSchemas.ts — kept in sync by
// hand since the two live in separate repos by design (see the design
// brief / plan). Every execute() body is a thin proxy to
// POST /tools/:name/execute, which runs the real handler server-side; the
// browser never talks to Supabase/ORS/Brave/the mocks directly.
const TOOL_DEFINITIONS: Array<{
  name: string;
  description: string;
  inputSchema: InputSchema;
}> = [
  {
    name: "createTrip",
    description:
      "Start a new trip plan: origin, destination, budget in VND, start date, and trip length in days.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        budgetVnd: { type: "number" },
        startDate: { type: "string" },
        days: { type: "number" },
      },
      required: ["destination", "budgetVnd", "startDate", "days"],
    },
  },
  {
    name: "suggestRoute",
    description: "Generate a draft ordered list of stops for the current trip.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "refineRoute",
    description: "Regenerate the draft route given free-text feedback.",
    inputSchema: {
      type: "object",
      properties: { feedback: { type: "string" } },
      required: ["feedback"],
    },
  },
  {
    name: "lockItinerary",
    description: "Geocode stops, compute driving distance, and fix the itinerary.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "addStop",
    description: "Add a stop to the trip.",
    inputSchema: {
      type: "object",
      properties: {
        placeName: { type: "string" },
        plannedDate: { type: "string" },
        expectedDurationHours: { type: "number" },
      },
      required: ["placeName"],
    },
  },
  {
    name: "removeStop",
    description: "Remove a stop by id.",
    inputSchema: { type: "object", properties: { stopId: { type: "string" } }, required: ["stopId"] },
  },
  {
    name: "reorderStop",
    description: "Move a stop to a new position.",
    inputSchema: {
      type: "object",
      properties: { stopId: { type: "string" }, newSequence: { type: "number" } },
      required: ["stopId", "newSequence"],
    },
  },
  {
    name: "setStopDuration",
    description: "Change how long the customer plans to spend at a stop.",
    inputSchema: {
      type: "object",
      properties: { stopId: { type: "string" }, expectedDurationHours: { type: "number" } },
      required: ["stopId", "expectedDurationHours"],
    },
  },
  {
    name: "searchFlights",
    description: "Search flight itineraries for the trip.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "selectFlight",
    description: "Select flight itinerary/itineraries from a prior search.",
    inputSchema: {
      type: "object",
      properties: { itineraryIds: { type: "array", items: { type: "string" } } },
      required: ["itineraryIds"],
    },
  },
  {
    name: "searchAccommodation",
    description: "Search accommodation candidates for a stop.",
    inputSchema: { type: "object", properties: { stopId: { type: "string" } }, required: ["stopId"] },
  },
  {
    name: "selectAccommodation",
    description: "Select an accommodation candidate.",
    inputSchema: { type: "object", properties: { optionId: { type: "string" } }, required: ["optionId"] },
  },
  {
    name: "assignVehicle",
    description: "Assign a fleet vehicle to the trip and estimate its cost.",
    inputSchema: { type: "object", properties: { vehicleId: { type: "string" } }, required: ["vehicleId"] },
  },
  {
    name: "requestBookingApproval",
    description: "Stage a pending selection for human approval.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["flight", "accommodation", "vehicle"] },
        targetId: { type: "string" },
      },
      required: ["kind", "targetId"],
    },
  },
  {
    name: "acknowledgeDisruption",
    description: "Mark a disruption alert as seen.",
    inputSchema: { type: "object", properties: { disruptionId: { type: "string" } }, required: ["disruptionId"] },
  },
  // Human-gated: registered as real WebMCP tools (so the Approve/Reject
  // buttons — and any future external agent acting on an explicit human
  // instruction — can call them the standard way), but never exposed to
  // the chat/LLM tool list on the backend (see toolSchemas.ts there).
  {
    name: "approveBooking",
    description: "Execute the real booking for a pending trip_bookings row. Only call this from a human Approve click.",
    inputSchema: { type: "object", properties: { tripBookingId: { type: "string" } }, required: ["tripBookingId"] },
  },
  {
    name: "rejectBooking",
    description: "Mark a pending trip_bookings row as rejected. Only call this from a human Reject click.",
    inputSchema: { type: "object", properties: { tripBookingId: { type: "string" } }, required: ["tripBookingId"] },
  },
];

// The actual network call, shared by every registered tool's execute() body
// and by UI event handlers (Approve/Reject buttons etc.) that want to call
// a tool directly without going through document.modelContext.getTools() —
// same effect, no extra indirection for our own bundled UI.
export async function callTool<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const tripId = name === "createTrip" ? null : getCurrentTripId();
  const { result } = await apiPost<{ result: T }>(`/tools/${name}/execute`, {
    tripId,
    input,
    locale: getCurrentLocale(),
  });
  return result;
}

export function registerAllTools(onToolExecuted?: (name: string, result: unknown) => void): void {
  const server = getWebMcpServer();
  for (const tool of TOOL_DEFINITIONS) {
    void server.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input: Record<string, unknown>) => {
        const result = await callTool(tool.name, input);
        onToolExecuted?.(tool.name, result);
        return result;
      },
    });
  }
}
