/**
 * Whether the client of one request renders MCP Apps.
 *
 * The answer is per request, because the protocol's two eras carry client
 * capabilities differently: a 2025-era connection declares them once, in
 * `initialize`; a 2026-07-28 request carries them in its own `_meta`
 * envelope, and two requests on one HTTP endpoint may come from different
 * clients. Which one is read follows the era the server was made for, never
 * what a request happens to carry: a 2025-era request's `_meta` is the
 * client's own and is not validated as an envelope, so it does not override
 * what `initialize` declared.
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
