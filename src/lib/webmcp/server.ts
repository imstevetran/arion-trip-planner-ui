import { initializeWebModelContext } from "@mcp-b/global";
import type { BrowserMcpServer } from "@mcp-b/webmcp-ts-sdk";

let initialized = false;

// initializeWebModelContext() wires up a real tab/iframe postMessage
// transport (TabServerTransport), which is what lets an external WebMCP
// client — a browser extension acting on behalf of Claude, ChatGPT, etc. —
// actually call these tools instead of just seeing document.modelContext
// exist. allowedOrigins is required whenever transport is configured at
// all (omitting it entirely is the only way to get @mcp-b/global's
// wildcard default) — scoped to this page's own origin so an unrelated
// site framing/tabbing this one can't drive real bookings through it.
// registerTool()/registerResource() (the latter an MCP-B extension beyond
// the base WebMCP spec) still work the same as before; only the transport
// is new.
//
// Confirmed live: caching document.modelContext into a module variable
// right after calling initializeWebModelContext() broke registerResource
// with "e.registerResource is not a function" — the object
// initializeWebModelContext() hands back synchronously isn't guaranteed to
// already carry every MCP-B extension method; some finish attaching a tick
// later. Reading document.modelContext fresh on every call (idempotent per
// @mcp-b/global's own docs, so re-calling init here is cheap/safe) avoids
// ever holding on to that earlier, incomplete reference.
export function getWebMcpServer(): BrowserMcpServer {
  if (!initialized) {
    initializeWebModelContext({
      transport: { tabServer: { allowedOrigins: [window.location.origin] } },
    });
    initialized = true;
  }
  return document.modelContext as unknown as BrowserMcpServer;
}
