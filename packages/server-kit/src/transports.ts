/**
 * Serving an extension over stdio and over streamable HTTP on this machine.
 * What each serves, which protocol eras, and what HTTP refuses, is the
 * package README's "Transports" section; this module is what it describes.
 */
import { createServer, type Server as HttpServer } from "node:http"
import type { AddressInfo } from "node:net"

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio"

import type { Extension } from "./definition.ts"
import { serverFactory } from "./server.ts"

/** Serves `extension` over this process's stdin and stdout, in either protocol era. */
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
   * Told of what the endpoint could not serve: a request it refused, an
   * answer it could not write. Reporting only; it never changes an answer.
   */
  readonly onerror?: (error: Error) => void
}

/** A running HTTP server. */
export interface HttpServing {
  /** The endpoint, with the port actually bound. */
  readonly url: URL
  /** Stops listening, and ends requests in flight and open connections. */
  close(): Promise<void>
}

const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "::1"])

/** Serves `extension` over streamable HTTP, to 2026-07-28 clients, on a loopback address. */
export async function serveOverHttp(
  extension: Extension,
  options: HttpOptions = {},
): Promise<HttpServing> {
  const host = options.host ?? "127.0.0.1"
  if (!loopbackHosts.has(host)) {
    throw new Error(`HTTP serves on a loopback address only, not ${JSON.stringify(host)}`)
  }
  const path = options.path ?? "/mcp"
  // Exactly the path a request's target is matched against, so the `url`
  // returned is one the server answers.
  if (!/^\/[^?#\s]*$/.test(path) || new URL(path, "http://localhost").pathname !== path) {
    throw new Error(
      `HTTP serves on a path with no query or fragment, not ${JSON.stringify(path)}`,
    )
  }
  const onerror = options.onerror === undefined ? {} : { onerror: options.onerror }
  const endpoint = createMcpHandler(serverFactory(extension), {
    legacy: "reject",
    ...onerror,
  })
  const handle = toNodeHandler(endpoint, onerror)
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
    // Idle connections close with the server; requests in flight were ended
    // by the endpoint's own close.
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
