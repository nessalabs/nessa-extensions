import { request as httpRequest } from "node:http"
import { fileURLToPath } from "node:url"

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { afterEach, describe, expect, it } from "vitest"

import { apps, capabilitiesFor, clientAt, sample } from "./testing.ts"
import { serveOverHttp, type HttpServing } from "./transports.ts"

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
  }: { method?: string; headers?: Record<string, string>; body?: unknown },
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

  it("is refused past the cap, and the cap frees when a session ends", async () => {
    const { url } = await serving({ maxSessions: 1 })
    const first = new StreamableHTTPClientTransport(url)
    const holder = new Client(
      { name: "first", version: "1" },
      { capabilities: capabilitiesFor({ era: "legacy" }) },
    )
    await holder.connect(first)
    const refused = await raw(url, { body: initialize })
    expect(refused.status).toBe(503)
    expect(JSON.parse(refused.text).error).toEqual({
      code: -32000,
      message: "Too many open sessions",
    })

    await first.terminateSession()
    await holder.close()
    const next = await clientAt(url, { era: "legacy", mimeTypes: apps })
    opened.push(() => next.close())
    expect((await next.listTools()).tools).toHaveLength(3)
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
