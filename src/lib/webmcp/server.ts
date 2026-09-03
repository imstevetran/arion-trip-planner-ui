import { initializeWebModelContext } from "@mcp-b/global";
import type { BrowserMcpServer } from "@mcp-b/webmcp-ts-sdk";

let server: BrowserMcpServer | null = null;

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
export function getWebMcpServer(): BrowserMcpServer {
  if (!server) {
    initializeWebModelContext({
      transport: { tabServer: { allowedOrigins: [window.location.origin] } },
    });
    server = document.modelContext as unknown as BrowserMcpServer;
  }
  return server;
}
