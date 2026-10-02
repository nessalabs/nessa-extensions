import { request as httpRequest } from "node:http"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod/v4"

import { defineExtension, defineTool, type Extension } from "./definition.ts"
import { serverFactory } from "./server.ts"
import { apps, capabilitiesFor, clientAt, sample } from "./testing.ts"
import { httpEndpoint, serveOverHttp, type HttpServing } from "./transports.ts"

const opened: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()))
})

async function serving(
  options: Parameters<typeof serveOverHttp>[1] = {},
): Promise<HttpServing> {
  const served = await serveOverHttp(sample, options)
  opened.push(served.close)
  return served
}

/** One raw HTTP request, with headers `fetch` will not send (`Host`). */
function raw(
  url: URL,
  {
    method = "POST",
    headers = {},
    body,
    target,
  }: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
    target?: string
  },
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        ...(target === undefined ? {} : { path: target }),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (text += chunk))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text }),
        )
      },
    )
    req.on("error", reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: capabilitiesFor({ era: "legacy", mimeTypes: apps }),
    clientInfo: { name: "raw", version: "1" },
  },
}

describe("serveOverHttp", () => {
  it("listens on a loopback address only", async () => {
    await expect(
      serveOverHttp(sample, { host: "0.0.0.0" as "127.0.0.1" }),
    ).rejects.toThrow('HTTP serves on a loopback address only, not "0.0.0.0"')
  })

  it("serves on ::1 too, and shows it in the URL", async () => {
    const served = await serving({ host: "::1" })
    expect(served.url.hostname).toBe("[::1]")
    const client = await clientAt(served.url, { era: "modern", mimeTypes: apps })
    opened.push(() => client.close())
    expect((await client.listTools()).tools).toHaveLength(3)
  })

  it("refuses a Host or Origin that is not this machine", async () => {
    const { url } = await serving()
    expect(
      (await raw(url, { headers: { host: "evil.example" }, body: initialize })).status,
    ).toBe(403)
    expect(
      (await raw(url, { headers: { origin: "https://evil.example" }, body: initialize }))
        .status,
    ).toBe(403)
    expect(
      (await raw(url, { headers: { origin: "http://localhost:5173" }, body: initialize }))
        .status,
    ).toBe(200)
  })

  it("answers a target that is not a path with 400", async () => {
    const { url } = await serving()
    const absolute = await raw(url, {
      body: initialize,
      target: `http://evil.example${url.pathname}`,
    })
    expect(absolute.status).toBe(400)
  })

  it("answers only on its path", async () => {
    const { url } = await serving({ path: "/extension" })
    expect(url.pathname).toBe("/extension")
    expect((await raw(new URL("/mcp", url), { body: initialize })).status).toBe(404)
    expect((await raw(url, { body: initialize })).status).toBe(200)
  })
})

describe("a 2025-era session over HTTP", () => {
  it("is refused when its id is not one the server opened", async () => {
    const { url } = await serving()
    const answer = await raw(url, {
      headers: { "mcp-session-id": "not-a-session" },
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    })
    expect(answer.status).toBe(404)
    expect(JSON.parse(answer.text)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    })
  })

  it("opens only on initialize, so a stray request holds no session", async () => {
    const { url } = await serving({ maxSessions: 1 })
    const stray = await raw(url, {
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    })
    expect(stray.status).toBeGreaterThanOrEqual(400)
    expect(stray.headers["mcp-session-id"]).toBeUndefined()
    const client = await clientAt(url, { era: "legacy", mimeTypes: apps })
    opened.push(() => client.close())
    expect((await client.listTools()).tools).toHaveLength(3)
  })

  it("closes the session used longest ago when a new one would pass the cap", async () => {
    const { url } = await serving({ maxSessions: 2 })
    const open = async () => {
      const opened = await raw(url, { body: initialize })
      const id = opened.headers["mcp-session-id"] as string
      await raw(url, {
        headers: { "mcp-session-id": id },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      })
      return id
    }
    const list = (id: string) =>
      raw(url, {
        headers: { "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      })
    const first = await open()
    const second = await open()
    expect((await list(first)).status).toBe(200) // the first is now the one used last
    const third = await open()
    expect((await list(third)).status).toBe(200)
    expect((await list(first)).status).toBe(200)
    expect((await list(second)).status).toBe(404)
  })

  it("keeps accepting clients that close without ending their session", async () => {
    const { url } = await serving({ maxSessions: 2 })
    for (let round = 0; round < 5; round++) {
      const client = await clientAt(url, { era: "legacy", mimeTypes: apps })
      expect((await client.listTools()).tools).toHaveLength(3)
      await client.close()
    }
    for (let round = 0; round < 5; round++) {
      expect((await raw(url, { body: initialize })).status).toBe(200)
    }
  })

  it("frees a session's place when it is ended, so no other session is closed for it", async () => {
    const { url } = await serving({ maxSessions: 2 })
    const open = async () => {
      const opened = await raw(url, { body: initialize })
      const id = opened.headers["mcp-session-id"] as string
      await raw(url, {
        headers: { "mcp-session-id": id },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      })
      return id
    }
    const list = (id: string) =>
      raw(url, {
        headers: { "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      })
    const ending = await open()
    const staying = await open()
    expect((await list(ending)).status).toBe(200) // the ending one is now used last
    const ended = await raw(url, {
      method: "DELETE",
      headers: { "mcp-session-id": ending, "mcp-protocol-version": "2025-06-18" },
    })
    expect(ended.status).toBe(200)
    expect((await list(ending)).status).toBe(404)
    await open()
    expect((await list(staying)).status).toBe(200)
  })

  it("tells onerror of a request it refused", async () => {
    const errors: string[] = []
    const { url } = await serving({ onerror: (error) => errors.push(error.message) })
    await raw(url, {
      headers: { "mcp-session-id": "not-a-session" },
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    })
    expect(errors).toContain("Refused with 404: Session not found")
  })
})

describe("serveOverStdio", () => {
  it("serves an extension as a child process on stdin and stdout", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("./stdio.fixture.ts", import.meta.url))],
      stderr: "pipe",
    })
    const client = new Client(
      { name: "stdio", version: "1" },
      { capabilities: capabilitiesFor({ era: "legacy", mimeTypes: apps }) },
    )
    await client.connect(transport)
    opened.push(() => client.close())
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "show_board",
      "refresh_board",
      "clear",
    ])
    expect(
      (await client.readResource({ uri: "ui://sample/board" })).contents[0]?.mimeType,
    ).toBe("text/html;profile=mcp-app")
  })
})

describe("serveOverHttp's options", () => {
  it.each([Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "refuses maxSessions %s",
    async (maxSessions) => {
      await expect(serveOverHttp(sample, { maxSessions })).rejects.toThrow(
        `maxSessions is a whole number of at least 1, not ${String(maxSessions)}`,
      )
    },
  )

  it.each(["/mcp?x", "/a#b", "mcp", "/a b"])("refuses path %j", async (path) => {
    await expect(serveOverHttp(sample, { path: path as "/mcp" })).rejects.toThrow(
      `HTTP serves on a path with no query or fragment, not ${JSON.stringify(path)}`,
    )
  })

  it("serves its path exactly, with or without a query", async () => {
    const { url } = await serving()
    expect(
      (await raw(url, { body: initialize, target: "//evil.example/mcp" })).status,
    ).toBe(404)
    expect((await raw(url, { body: initialize, target: "/x/../mcp" })).status).toBe(404)
    expect((await raw(url, { body: initialize, target: "/mcp?x=1" })).status).toBe(200)
  })
})

/** A tool call held open until the test lets it finish. */
function heldExtension(): {
  extension: Extension
  release: () => void
  started: Promise<void>
} {
  let release = () => {}
  let started = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const begun = new Promise<void>((resolve) => (started = resolve))
  const extension = defineExtension({
    name: "held",
    version: "0.0.1",
    views: [],
    tools: [
      defineTool({
        name: "hold",
        description: "Answers when released",
        input: z.object({}),
        effects: "read-only",
        run: async () => {
          started()
          await held
          return { text: "released" }
        },
      }),
    ],
  })
  return { extension, release, started: begun }
}

describe("a 2025-era session's place over HTTP", () => {
  const sessionOf = (answer: {
    headers: Record<string, string | string[] | undefined>
  }) => answer.headers["mcp-session-id"] as string

  it("is never taken from a session answering a call; a new one waits for a free place", async () => {
    const { extension, release, started } = heldExtension()
    const served = await serveOverHttp(extension, { maxSessions: 1 })
    opened.push(served.close)
    const id = sessionOf(await raw(served.url, { body: initialize }))
    const headers = { "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" }
    await raw(served.url, {
      headers,
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    })
    const call = raw(served.url, {
      headers,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "hold", arguments: {} },
      },
    })
    await started

    const refused = await raw(served.url, { body: initialize })
    expect(refused.status).toBe(503)
    expect(JSON.parse(refused.text).error).toEqual({
      code: -32000,
      message: "Every session is answering a request",
    })

    release()
    const answered = await call
    expect(answered.status).toBe(200)
    expect(answered.text).toContain("released")
    expect((await raw(served.url, { body: initialize })).status).toBe(200)
    // The held session, idle again, made the room.
    expect(
      (
        await raw(served.url, {
          headers,
          body: { jsonrpc: "2.0", id: 4, method: "tools/list" },
        })
      ).status,
    ).toBe(404)
  })
})

describe("the HTTP endpoint", () => {
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    })

  /** The endpoint, and whether each server it made has closed. */
  function endpoint(report?: (error: Error) => void) {
    const base = serverFactory(sample)
    const closed: boolean[] = []
    const made = httpEndpoint(
      (ctx) => {
        const server = base(ctx)
        const at = closed.push(false) - 1
        server.onclose = () => {
          closed[at] = true
        }
        return server
      },
      64,
      report,
    )
    opened.push(() => made.close())
    return { made, closed }
  }

  it("closes the server of a request that opens no session", async () => {
    const { made, closed } = endpoint()
    const stray = await made.fetch(
      request({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    )
    expect(stray.status).toBeGreaterThanOrEqual(400)
    expect(closed).toEqual([true])
  })

  it("keeps the server of a session it opened", async () => {
    const { made, closed } = endpoint()
    expect((await made.fetch(request(initialize))).status).toBe(200)
    expect(closed).toEqual([false])
  })

  it("opens no session for an initialize answered while it closes", async () => {
    const { made, closed } = endpoint()
    const opening = made.fetch(request(initialize))
    await made.close()
    await opening
    expect(closed).toEqual([true])
  })

  it("answers 503 once closed", async () => {
    const { made } = endpoint()
    await made.close()
    const answer = await made.fetch(request(initialize))
    expect(answer.status).toBe(503)
    expect(await answer.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "The server is closing" },
      id: null,
    })
  })

  it("tells onerror of what a session's transport refuses", async () => {
    const errors: Error[] = []
    const { made } = endpoint((error) => errors.push(error))
    const answer = await made.fetch(request(initialize, { accept: "application/json" }))
    expect(answer.status).toBe(406)
    expect(errors.length).toBeGreaterThan(0)
  })
})
