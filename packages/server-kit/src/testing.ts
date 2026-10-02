/**
 * A client fixture for the kit's tests: an MCP client from the SDK, in
 * either protocol era, declaring MCP Apps or not, connected to an
 * extension's server over the SDK's stdio entry (on an in-memory pipe) or
 * over HTTP.
 */
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import { defineExtension, defineTool, type Extension } from "./definition.ts"
import { serverFactory } from "./server.ts"
import { serveOverHttp } from "./transports.ts"
import { z } from "zod/v4"

export type Era = "legacy" | "modern"

export interface ClientSetup {
  readonly era: Era
  /** Whether the client declares `io.modelcontextprotocol/ui`, and with which MIME types. */
  readonly mimeTypes?: readonly string[]
}

/** The client capabilities `setup` declares. */
export function capabilitiesFor(setup: ClientSetup) {
  return setup.mimeTypes === undefined
    ? {}
    : { extensions: { [EXTENSION_ID]: { mimeTypes: [...setup.mimeTypes] } } }
}

function newClient(setup: ClientSetup): Client {
  return new Client(
    { name: "fixture", version: "1.0.0" },
    {
      capabilities: capabilitiesFor(setup),
      versionNegotiation:
        setup.era === "legacy" ? { mode: "legacy" } : { mode: { pin: "2026-07-28" } },
    },
  )
}

/** A client connected over the SDK's stdio entry; `close` ends both sides. */
export async function overStdio(definition: Extension, setup: ClientSetup) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const serving = serveStdio(serverFactory(definition), { transport: serverSide })
  const client = newClient(setup)
  await client.connect(clientSide)
  return {
    client,
    close: async () => {
      await client.close()
      await serving.close()
    },
  }
}

/** A client connected to the HTTP endpoint at `url`. */
export async function clientAt(url: URL, setup: ClientSetup): Promise<Client> {
  const client = newClient(setup)
  await client.connect(new StreamableHTTPClientTransport(url))
  return client
}

/** A client connected over HTTP on a loopback port; `close` ends both sides. */
export async function overHttp(definition: Extension, setup: ClientSetup) {
  const serving = await serveOverHttp(definition)
  const client = await clientAt(serving.url, setup)
  return {
    client,
    url: serving.url,
    close: async () => {
      await client.close()
      await serving.close()
    },
  }
}

export const apps: readonly string[] = [RESOURCE_MIME_TYPE]

/** An extension with each kind of tool: one with a view, one only the app calls, one with no UI. */
export const sample = defineExtension({
  name: "sample",
  version: "1.2.3",
  views: [
    {
      uri: "ui://sample/board",
      name: "board",
      title: "Board",
      description: "The sample board",
      html: () => "<!doctype html><html><body>board</body></html>",
      ui: {
        csp: { connectDomains: ["https://api.example.com"] },
        permissions: { clipboardWrite: {} },
        prefersBorder: true,
      },
    },
  ],
  tools: [
    defineTool({
      name: "show_board",
      title: "Show board",
      description: "Shows the board",
      input: z.object({ rows: z.number().int().min(1) }),
      effects: "read-only",
      view: "ui://sample/board",
      run: ({ rows }) => ({ text: `${rows} rows`, data: { rows } }),
    }),
    defineTool({
      name: "refresh_board",
      description: "Refreshes the board for the app",
      input: z.object({}),
      effects: "additive",
      view: "ui://sample/board",
      callers: ["app"],
      run: () => ({ text: "refreshed" }),
    }),
    defineTool({
      name: "clear",
      description: "Clears everything",
      input: z.object({ confirm: z.literal(true) }),
      effects: "destructive",
      run: () => ({ text: "cleared" }),
    }),
  ],
})
