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
 *   client no views at all. Sessions are bounded without being refused: a
 *   client that goes away without ending its session leaves nothing that
 *   says so, so when `maxSessions` are open a new one closes the session
 *   used longest ago, whose client — if it comes back — is told the session
 *   is gone and starts another, as the protocol has it.
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
} from "@modelcontextprotocol/server"
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio"

import type { Extension } from "./definition.ts"
import { serverFactory } from "./server.ts"

/** Serves `extension` over this process's stdin and stdout. */
export function serveOverStdio(
  extension: Extension,
  options: { readonly onerror?: (error: Error) => void } = {},
): StdioServerHandle {
  return serveStdio(serverFactory(extension), options)
}

/** Where and how to listen for HTTP. */
export interface HttpOptions {
  /** A loopback address. Defaults to `127.0.0.1`. */
  readonly host?: "127.0.0.1" | "::1"
  /** Defaults to 0: a free port, read back from `HttpServing.url`. */
  readonly port?: number
  /** The endpoint's path. Defaults to `/mcp`. */
  readonly path?: `/${string}`
  /**
   * At most this many 2025-era sessions are open at once; a new one closes
   * the session used longest ago. Defaults to 64.
   */
  readonly maxSessions?: number
  /**
   * Told of what the endpoint could not serve: a request it refused, a
   * session's transport or server failing, an answer it could not write.
   * Reporting only; it never changes an answer.
   */
  readonly onerror?: (error: Error) => void
}

/** A running HTTP server. */
export interface HttpServing {
  /** The endpoint, with the port actually bound. */
  readonly url: URL
  /** Stops listening, ends open sessions and connections. */
  close(): Promise<void>
}

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "::1"])

/** Serves `extension` over streamable HTTP on a loopback address. */
export async function serveOverHttp(
  extension: Extension,
  options: HttpOptions = {},
): Promise<HttpServing> {
  const host = options.host ?? "127.0.0.1"
  if (!loopbackHosts.has(host)) {
    throw new Error(`HTTP serves on a loopback address only, not ${JSON.stringify(host)}`)
  }
  const path = options.path ?? "/mcp"
  const endpoint = httpEndpoint(serverFactory(extension), options)
  const handle = toNodeHandler(
    endpoint,
    options.onerror === undefined ? {} : { onerror: options.onerror },
  )
  const validHost = localhostHostValidation()
  const validOrigin = localhostOriginValidation()
  const server = createServer((req, res) => {
    if (!validHost(req, res) || !validOrigin(req, res)) return
    // Only a path: an absolute-form target is not one this endpoint serves.
    const target = req.url ?? ""
    if (!target.startsWith("/")) {
      res.writeHead(400).end()
      return
    }
    if (new URL(target, "http://localhost").pathname !== path) {
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
  factory: ReturnType<typeof serverFactory>,
  options: Pick<HttpOptions, "onerror" | "maxSessions">,
): { fetch(request: Request): Promise<Response>; close(): Promise<void> } {
  const report = options.onerror
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    ...(report === undefined ? {} : { onerror: report }),
  })
  // In the order last used: the first is the one used longest ago.
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()
  const maxSessions = options.maxSessions ?? 64
  let closed = false

  /** An error answer, which `onerror` is told of. */
  function refuse(status: number, code: number, message: string): Response {
    report?.(new Error(`Refused with ${status}: ${message}`))
    return Response.json(
      { jsonrpc: "2.0", error: { code, message }, id: null },
      { status },
    )
  }

  function used(id: string, session: WebStandardStreamableHTTPServerTransport): void {
    sessions.delete(id)
    sessions.set(id, session)
  }

  async function legacy(request: Request): Promise<Response> {
    const id = request.headers.get("mcp-session-id")
    if (id !== null) {
      const session = sessions.get(id)
      if (session === undefined) return refuse(404, -32001, "Session not found")
      used(id, session)
      return session.handleRequest(request)
    }
    // No session yet: only an `initialize` opens one. The transport answers
    // anything else with an error and never initializes, and is closed here.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (opened) => {
        if (closed) {
          void transport.close()
          return
        }
        // Make room before adding, in the same turn, so the count never
        // passes the bound however many sessions open at once.
        while (sessions.size >= maxSessions) {
          const [oldest] = sessions.keys()
          if (oldest === undefined) break
          void sessions.get(oldest)?.close()
          sessions.delete(oldest)
        }
        sessions.set(opened, transport)
      },
    })
    transport.onclose = () => {
      const opened = transport.sessionId
      if (opened !== undefined && sessions.get(opened) === transport)
        sessions.delete(opened)
    }
    if (report !== undefined) transport.onerror = report
    const server = factory({ era: "legacy" })
    if (report !== undefined) server.onerror = report
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    const opened = transport.sessionId
    if (opened === undefined || sessions.get(opened) !== transport) await server.close()
    return response
  }

  return {
    fetch: async (request) => {
      if (closed) return refuse(503, -32000, "The server is closing")
      return (await isLegacyRequest(request)) ? legacy(request) : modern.fetch(request)
    },
    close: async () => {
      closed = true
      await modern.close()
      const open = [...sessions.values()]
      sessions.clear()
      await Promise.all(open.map((session) => session.close()))
    },
  }
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
