# Arion Trip Planner

A live day-by-day trip timeline — route, flight, accommodation, vehicle —
edited by talking to an assistant. Built for a hackathon submission.

**This repo contains no secrets.** It's a thin client: the map, timeline,
and chat all render from data fetched over plain HTTP from
[`trip-planner-api`](https://github.com/imstevetran/arion-auto-data/tree/main/apps/trip-planner-api),
which holds every API key (Supabase, Anthropic, OpenRouteService, Brave
Search) and talks to the booking mocks. The only config this app needs is
`VITE_TRIP_PLANNER_API_URL`.

## Why WebMCP

Every action the chat (or a human, via the Approve/Reject buttons) can take
is registered as a real [WebMCP](https://github.com/webmachinelearning/webmcp)
tool via `document.modelContext.registerTool()` — using
[`@mcp-b/webmcp-ts-sdk`](https://www.npmjs.com/package/@mcp-b/webmcp-ts-sdk),
the reference implementation, not a bespoke registry. Every piece of
readable state (`trip://current`, `fleet://vehicles`, `trip://bookings`,
`trip://disruptions`) is a real WebMCP resource the same way.

Each tool's `execute()` body is a thin proxy to `trip-planner-api`'s
`POST /tools/:name/execute`, which does the actual work server-side — so the
browser never holds a secret, but the registrations themselves are genuine:
`document.modelContext.getTools()` lists all 17 of them, discoverable by any
future WebMCP-capable agent, not just this app's own chat panel.

**Booking-execution tools (`approveBooking`/`rejectBooking`) are registered
here for the UI's own Approve/Reject buttons, but are never offered to the
backend chat loop's LLM tool list** — see
`apps/trip-planner-api/src/webmcp/toolSchemas.ts` in the main repo. The
assistant can stage a booking; only a human tap executes one.

## Running it

```bash
npm install
cp .env.example .env.local   # point VITE_TRIP_PLANNER_API_URL at your trip-planner-api
npm run dev
```

Needs `trip-planner-api` running (default `http://localhost:4300`) to do
anything beyond render the empty "new trip" form — see that service's own
README for what it needs configured (Supabase, Anthropic, OpenRouteService,
Brave Search, and the two booking mocks).

## What's here vs. simplified for time

- **Desktop**: the approved three-pane layout (map | timeline | chat), all
  visible at once.
- **Mobile**: currently a stacked single-column fallback (map on top,
  timeline, chat below) rather than the approved two-screen
  (timeline-home + full-screen-chat, segmented Timeline/Map toggle,
  floating chat button) design — a real gap against the approved mockup,
  not a silent scope cut.
- **Live push**: disruption turns and trip-state changes are picked up by
  polling (chat history every 4s, trip resources every 6s), not a real
  SSE/WebSocket channel. The backend already appends a disruption's
  proactive chat turn immediately; only the delivery to an open tab is
  polling-based for now.
- Visual identity (Inter, `#d89b54` primary, navy `#0c1421`, light-only)
  matches the main Arion app's real design system — see the design brief
  from the review phase for the token reference.
