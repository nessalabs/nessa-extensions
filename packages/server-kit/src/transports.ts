/**
 * Serving an extension over stdio and over streamable HTTP on this machine.
 * What each serves, how HTTP holds a 2025-era client's session and when it
 * closes one, and what HTTP refuses, is the package README's "Transports"
 * section; this module is what it describes.
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
  if (!/^\/[^?#\s]*$/.test(path)) {
    throw new Error(
      `HTTP serves on a path with no query or fragment, not ${JSON.stringify(path)}`,
    )
  }
  const maxSessions = options.maxSessions ?? 64
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) {
    throw new Error(
      `maxSessions is a whole number of at least 1, not ${String(maxSessions)}`,
    )
  }
  const endpoint = httpEndpoint(serverFactory(extension), maxSessions, options.onerror)
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
    if (target.split("?", 1)[0] !== path) {
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

/** A 2025-era session: its transport, and how many of its requests are still being answered. */
interface Session {
  readonly transport: WebStandardStreamableHTTPServerTransport
  active: number
}

/**
 * The endpoint's web-standard face: modern requests to a fresh server each,
 * 2025-era requests to their session's server. Exported for its tests;
 * `serveOverHttp` is the entry.
 */
export function httpEndpoint(
  factory: ReturnType<typeof serverFactory>,
  maxSessions: number,
  report: ((error: Error) => void) | undefined,
): { fetch(request: Request): Promise<Response>; close(): Promise<void> } {
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    ...(report === undefined ? {} : { onerror: report }),
  })
  // In the order last used: the first is the one used longest ago.
  const sessions = new Map<string, Session>()
  // Initializes being answered, each holding a place a session will take.
  let opening = 0
  let closed = false

  /** An error answer, which `onerror` is told of. */
  function refuse(status: number, code: number, message: string): Response {
    report?.(new Error(`Refused with ${status}: ${message}`))
    return Response.json(
      { jsonrpc: "2.0", error: { code, message }, id: null },
      { status },
    )
  }

  /**
   * Makes room for one more session: none needed under the bound; otherwise
   * the idle session used longest ago is closed. False when every session is
   * answering a request — those are never closed under a caller.
   */
  function makeRoom(): boolean {
    if (sessions.size + opening < maxSessions) return true
    for (const [id, session] of sessions) {
      if (session.active > 0) continue
      sessions.delete(id)
      void session.transport.close()
      return true
    }
    return false
  }

  /**
   * Answers `request` on `session`. A POST — a call the server is working on
   * — counts as active until its answer, a JSON body or an event stream, has
   * been read to its end or cancelled. A GET only opens a stream for what the
   * server sends unasked; closing it ends no work, and a client that went away
   * may leave it open, so it does not keep the session from being closed.
   */
  async function answer(session: Session, request: Request): Promise<Response> {
    if (request.method !== "POST") return session.transport.handleRequest(request)
    session.active += 1
    let counted = true
    const finish = () => {
      if (counted) {
        counted = false
        session.active -= 1
      }
    }
    let response: Response
    try {
      response = await session.transport.handleRequest(request)
    } catch (error) {
      finish()
      throw error
    }
    if (response.body === null) {
      finish()
      return response
    }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            finish()
            controller.close()
          } else {
            controller.enqueue(chunk.value)
          }
        } catch (error) {
          finish()
          controller.error(error)
        }
      },
      cancel(reason) {
        finish()
        return reader.cancel(reason)
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  async function legacy(request: Request): Promise<Response> {
    const id = request.headers.get("mcp-session-id")
    if (id !== null) {
      const session = sessions.get(id)
      if (session === undefined) return refuse(404, -32001, "Session not found")
      sessions.delete(id)
      sessions.set(id, session)
      return answer(session, request)
    }
    // No session yet: only an `initialize` opens one, and only it holds a
    // place. The transport answers anything else with an error and never
    // initializes, and its server is closed here.
    const initializing = await isInitialize(request)
    if (initializing && !makeRoom()) {
      return refuse(503, -32000, "Every session is answering a request")
    }
    if (initializing) opening += 1
    try {
      const session: Session = {
        transport: new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (opened) => {
            if (closed) {
              void session.transport.close()
              return
            }
            sessions.set(opened, session)
          },
        }),
        active: 0,
      }
      session.transport.onclose = () => {
        const opened = session.transport.sessionId
        if (opened !== undefined) sessions.delete(opened)
      }
      const server = factory({ era: "legacy" })
      // Connecting routes the transport's errors to the server's `onerror`.
      if (report !== undefined) server.onerror = report
      await server.connect(session.transport)
      const response = await answer(session, request)
      const opened = session.transport.sessionId
      if (opened === undefined || !sessions.has(opened)) await server.close()
      return response
    } finally {
      if (initializing) opening -= 1
    }
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
      await Promise.all(open.map((session) => session.transport.close()))
    },
  }
}

/** Whether `request` is a JSON-RPC `initialize`, read from a copy of its body. */
async function isInitialize(request: Request): Promise<boolean> {
  try {
    const message: unknown = await request.clone().json()
    return (
      typeof message === "object" &&
      message !== null &&
      (message as { method?: unknown }).method === "initialize"
    )
  } catch {
    return false
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
