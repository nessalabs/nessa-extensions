/**
 * Whether the client of one request renders MCP Apps, read from where its
 * era carries client capabilities. Why per request and why by era is the
 * package README's "Negotiation, per request" section.
 */
import {
  getUiCapability,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import {
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
  type McpRequestContext,
  type Server,
  type ServerContext,
} from "@modelcontextprotocol/server"

/** Whether `capabilities` declare `io.modelcontextprotocol/ui` with `text/html;profile=mcp-app`. */
export function rendersApps(capabilities: ClientCapabilities | undefined): boolean {
  const mimeTypes: unknown = getUiCapability(capabilities)?.mimeTypes
  return Array.isArray(mimeTypes) && mimeTypes.includes(RESOURCE_MIME_TYPE)
}

/**
 * Reads the capabilities the client of a request declared, for a server made
 * for `era`: from the request's envelope for a 2026-07-28 server, from
 * `initialize` for a 2025-era one.
 */
export function capabilitiesReader(
  server: Server,
  era: McpRequestContext["era"],
): (ctx: ServerContext) => ClientCapabilities | undefined {
  if (era === "modern") {
    return (ctx) => {
      const envelope: Record<string, unknown> | undefined = ctx.mcpReq.envelope
      return envelope !== undefined &&
        Object.hasOwn(envelope, CLIENT_CAPABILITIES_META_KEY)
        ? (envelope[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities)
        : undefined
    }
  }
  // The SDK marks this accessor deprecated in favour of the envelope, which a
  // 2025-era request does not carry; on a 2025-era connection it holds what
  // `initialize` declared.
  return () => server.getClientCapabilities()
}
