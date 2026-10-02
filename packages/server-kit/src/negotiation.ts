/**
 * Whether the client of one request renders MCP Apps.
 *
 * The answer is per request, because the protocol carries client
 * capabilities in two ways: a 2025-era connection declares them once, in
 * `initialize`; a 2026-07-28 request carries them in its own `_meta`
 * envelope, and two requests on one HTTP endpoint may come from different
 * clients. `clientCapabilitiesOf` reads the envelope first and the
 * connection's `initialize` second.
 */
import {
  getUiCapability,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import {
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
  type Server,
  type ServerContext,
} from "@modelcontextprotocol/server"

/** Whether `capabilities` declare `io.modelcontextprotocol/ui` with `text/html;profile=mcp-app`. */
export function rendersApps(capabilities: ClientCapabilities | undefined): boolean {
  const mimeTypes: unknown = getUiCapability(capabilities)?.mimeTypes
  return Array.isArray(mimeTypes) && mimeTypes.includes(RESOURCE_MIME_TYPE)
}

/** The capabilities the client of the request in `ctx` declared, from its envelope or its `initialize`. */
export function clientCapabilitiesOf(
  server: Server,
  ctx: ServerContext,
): ClientCapabilities | undefined {
  const envelope: Record<string, unknown> | undefined = ctx.mcpReq.envelope
  if (envelope !== undefined && Object.hasOwn(envelope, CLIENT_CAPABILITIES_META_KEY)) {
    return envelope[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities
  }
  // On a 2025-era connection the envelope is absent and this accessor holds
  // what `initialize` declared. The SDK marks it deprecated in favour of the
  // envelope read above, which a 2025-era request does not carry.
  return server.getClientCapabilities()
}
