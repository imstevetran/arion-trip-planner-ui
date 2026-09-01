import { BrowserMcpServer } from "@mcp-b/webmcp-ts-sdk";

let server: BrowserMcpServer | null = null;

// A real BrowserMcpServer (@mcp-b/webmcp-ts-sdk — the reference WebMCP
// implementation), constructed directly rather than through
// @mcp-b/global's initializeWebModelContext(): that helper always wires up
// a tab/iframe postMessage transport for talking to an external MCP client
// (e.g. a browser extension), which this app doesn't need — our own chat UI
// calls the backend directly. registerTool()/registerResource() work
// without ever calling .connect(), so this still exposes a genuine
// document.modelContext any *future* native browser agent (or another
// script) could discover the standard way, without forcing an unused
// transport connection today.
export function getWebMcpServer(): BrowserMcpServer {
  if (!server) {
    server = new BrowserMcpServer({ name: "arion-trip-planner", version: "0.1.0" });
    try {
      Object.defineProperty(document, "modelContext", {
        value: server,
        configurable: true,
        writable: false,
      });
    } catch {
      // Something else (a native implementation, or a previous call in a
      // hot-reloaded dev session) already defined it — leave it alone.
    }
  }
  return server;
}
