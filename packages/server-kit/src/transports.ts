/**
 * Serving an extension: over stdio, as `npx @nessalabs/<name>` runs it, and
 * over streamable HTTP on this machine.
 *
 * Both hand the SDK's serving entries `serverFactory(definition)`, so the
 * same tools and views answer both, in either protocol era.
 *
 * Over HTTP the two eras are served differently, because they declare
 * client capabilities differently (`negotiation.ts`):
 *
 * - A 2026-07-28 request carries its capabilities, so each is answered by a
 *   fresh server (`createMcpHandler`, modern only).
 * - A 2025-era client declares them once, in `initialize`, so it gets a
 *   session: one server for the session's life, found by its
 *   `Mcp-Session-Id`, so every later request is answered knowing what the
 *   client declared. The SDK's stateless legacy serving would answer each
 *   request with a server that never saw `initialize`, and offer such a
 *   client no views at all.
 *
 * HTTP listens on a loopback address only, and refuses a request whose
 * `Host` or `Origin` names anything but this machine, which keeps a web page
 * from reaching the server by DNS rebinding. Serving a remote host, which
 * needs authentication, is not built here (#11).
 */
import { randomUUID } from "node:crypto"
import { createServer, type Server as HttpServer } from "node:http"
import type { AddressInfo } from "node:net"

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node"
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpServerFactory,
} from "@modelcontextprotocol/server"
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio"

import type { ExtensionDefinition } from "./definition.ts"
import { serverFactory } from "./server.ts"

/** Serves `definition` over this process's stdin and stdout. */
export function serveOverStdio(
  definition: ExtensionDefinition,
  options: { readonly onerror?: (error: Error) => void } = {},
): StdioServerHandle {
  return serveStdio(serverFactory(definition), options)
}

/** Where to listen for HTTP. */
export interface HttpOptions {
  /** A loopback address. Defaults to `127.0.0.1`. */
  readonly host?: "127.0.0.1" | "::1" | "localhost"
  /** Defaults to 0: a free port, read back from `HttpServing.url`. */
  readonly port?: number
  /** The endpoint's path. Defaults to `/mcp`. */
  readonly path?: `/${string}`
  /**
   * At most this many 2025-era sessions are open at once; another
   * `initialize` is refused until one ends. Defaults to 64.
   */
  readonly maxSessions?: number
  readonly onerror?: (error: Error) => void
}

/** A running HTTP server. */
export interface HttpServing {
  /** The endpoint, with the port actually bound. */
  readonly url: URL
  /** Stops listening and ends open connections. */
  close(): Promise<void>
}

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"])

/** Serves `definition` over streamable HTTP on a loopback address. */
export async function serveOverHttp(
  definition: ExtensionDefinition,
  options: HttpOptions = {},
): Promise<HttpServing> {
  const host = options.host ?? "127.0.0.1"
  if (!loopbackHosts.has(host)) {
    throw new Error(`HTTP serves on a loopback address only, not ${JSON.stringify(host)}`)
  }
  const path = options.path ?? "/mcp"
  const onerror = options.onerror === undefined ? {} : { onerror: options.onerror }
  const endpoint = httpEndpoint(serverFactory(definition), options)
  const handle = toNodeHandler(endpoint, onerror)
  const validHost = localhostHostValidation()
  const validOrigin = localhostOriginValidation()
  const server = createServer((req, res) => {
    if (!validHost(req, res) || !validOrigin(req, res)) return
    if (new URL(req.url ?? "/", "http://localhost").pathname !== path) {
      res.writeHead(404).end()
      return
    }
    void handle(req, res)
  })
  await listen(server, host, options.port ?? 0)
  const { port } = server.address() as AddressInfo
  const shown = host === "::1" ? "[::1]" : host
  return {
    url: new URL(`http://${shown}:${port}${path}`),
    close: async () => {
      await endpoint.close()
      await close(server)
    },
  }
}

/**
 * The endpoint's web-standard face: modern requests to a fresh server each,
 * 2025-era requests to their session's server.
 */
function httpEndpoint(
  factory: McpServerFactory,
  options: Pick<HttpOptions, "onerror" | "maxSessions">,
): { fetch(request: Request): Promise<Response>; close(): Promise<void> } {
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
  })
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const maxSessions = options.maxSessions ?? 64

  async function legacy(request: Request): Promise<Response> {
    const id = request.headers.get("mcp-session-id")
    if (id !== null) {
      const session = sessions.get(id)
      return session === undefined
        ? jsonRpcError(404, -32001, "Session not found")
        : session.handleRequest(request)
    }
    if (sessions.size >= maxSessions) {
      return jsonRpcError(503, -32000, "Too many open sessions")
    }
    // No session yet: only an `initialize` opens one. The transport answers
    // anything else with an error and never initializes, and is closed here.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (opened) => {
        sessions.set(opened, transport)
      },
    })
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId)
    }
    const server = await factory({ era: "legacy" })
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    if (transport.sessionId === undefined || !sessions.has(transport.sessionId)) {
      await server.close()
    }
    return response
  }

  return {
    fetch: async (request) =>
      (await isLegacyRequest(request)) ? legacy(request) : modern.fetch(request),
    close: async () => {
      await modern.close()
      await Promise.all([...sessions.values()].map((session) => session.close()))
      sessions.clear()
    },
  }
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status })
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function close(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}
