import { request as httpRequest } from "node:http"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod/v4"

import { defineExtension, defineTool } from "./definition.ts"
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

/** Whether a raw 2025-era initialize reached the endpoint, which refuses its era by name. */
function reached(answer: { status: number; text: string }): boolean {
  if (answer.status !== 400 || !answer.text.startsWith("{")) return false
  return (JSON.parse(answer.text) as { error?: { code?: number } }).error?.code === -32022
}

describe("serveOverHttp", () => {
  it.each(["0.0.0.0", "localhost"])("refuses to listen on %s", async (host) => {
    await expect(serveOverHttp(sample, { host: host as "127.0.0.1" })).rejects.toThrow(
      `HTTP serves on a loopback address only, not "${host}"`,
    )
  })

  it.each(["/mcp?x", "/a#b", "mcp", "/a b", "/a/../mcp", "/café", "/a\\b"])(
    "refuses path %j",
    async (path) => {
      await expect(serveOverHttp(sample, { path: path as "/mcp" })).rejects.toThrow(
        `HTTP serves on a path with no query or fragment, not ${JSON.stringify(path)}`,
      )
    },
  )

  it("serves on ::1 too, and shows it in the URL", async () => {
    const served = await serving({ host: "::1" })
    expect(served.url.hostname).toBe("[::1]")
    const client = await clientAt(served.url, { era: "modern", mimeTypes: apps })
    opened.push(() => client.close())
    expect((await client.listTools()).tools).toHaveLength(3)
  })

  it("refuses a 2025-era client by naming the era it serves", async () => {
    const { url } = await serving()
    const answer = await raw(url, { body: initialize })
    expect(answer.status).toBe(400)
    expect(JSON.parse(answer.text)).toMatchObject({
      error: {
        code: -32022,
        data: { supported: ["2026-07-28"], requested: "2025-06-18" },
      },
    })
    await expect(clientAt(url, { era: "legacy" })).rejects.toThrow(/-32022/)
  })

  it.each([
    ["GET", undefined, 405],
    ["DELETE", undefined, 405],
    ["POST", [initialize], 400],
    ["POST", { jsonrpc: "2.0", method: "notifications/initialized" }, 202],
  ])(
    "refuses a 2025-era %s with a body of %j: %i, before any server",
    async (method, body, status) => {
      const { url } = await serving()
      const answer = await raw(url, { method, body })
      expect(answer.status).toBe(status)
      if (status === 202) expect(answer.text).toBe("")
      else expect(answer.text).toMatch(/"error":/)
    },
  )

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
      reached(
        await raw(url, {
          headers: { origin: "http://localhost:5173" },
          body: initialize,
        }),
      ),
    ).toBe(true)
  })

  it("answers a target that is not a path with 400, and refuses it before the endpoint", async () => {
    const { url } = await serving()
    const absolute = await raw(url, {
      body: initialize,
      target: `http://evil.example${url.pathname}`,
    })
    expect(absolute.status).toBe(400)
    expect(reached(absolute)).toBe(false)
  })

  it("serves its path exactly, with or without a query", async () => {
    const { url } = await serving({ path: "/extension" })
    expect(url.pathname).toBe("/extension")
    expect((await raw(url, { body: initialize, target: "/mcp" })).status).toBe(404)
    expect(
      (await raw(url, { body: initialize, target: "//evil.example/extension" })).status,
    ).toBe(404)
    expect((await raw(url, { body: initialize, target: "/x/../extension" })).status).toBe(
      404,
    )
    for (const target of ["/extension/x", "/extensionx"]) {
      expect((await raw(url, { body: initialize, target })).status).toBe(404)
    }
    expect(reached(await raw(url, { body: initialize, target: "/extension?x=1" }))).toBe(
      true,
    )
    const client = await clientAt(new URL("?x=1", url), {
      era: "modern",
      mimeTypes: apps,
    })
    opened.push(() => client.close())
    expect((await client.listTools()).tools).toHaveLength(3)
  })

  it("tells onerror of a request it refused", async () => {
    const errors: Error[] = []
    const { url } = await serving({ onerror: (error) => errors.push(error) })
    await raw(url, { body: initialize })
    expect(errors.map((error) => error.message).join("\n")).toMatch(/2025-06-18/)
  })
})

describe("serveOverStdio", () => {
  it.each(["legacy", "modern"] as const)(
    "serves an extension as a child process to a %s-era client",
    async (era) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("./stdio.fixture.ts", import.meta.url))],
        stderr: "pipe",
      })
      const client = new Client(
        { name: "stdio", version: "1" },
        {
          capabilities: capabilitiesFor({ era, mimeTypes: apps }),
          versionNegotiation:
            era === "legacy" ? { mode: "legacy" } : { mode: { pin: "2026-07-28" } },
        },
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
    },
  )
})

describe("closing an HTTP server", () => {
  it("ends a call in flight: its run is aborted and its caller's request fails", async () => {
    let aborted: (value: boolean) => void = () => {}
    let begun: () => void = () => {}
    const sawAbort = new Promise<boolean>((resolve) => (aborted = resolve))
    const started = new Promise<void>((resolve) => (begun = resolve))
    const extension = defineExtension({
      name: "slow",
      version: "0.0.1",
      views: [],
      tools: [
        defineTool({
          name: "wait",
          description: "Waits until aborted",
          input: z.object({}),
          effects: "read-only",
          run: (_input, { signal }) =>
            new Promise((resolve) => {
              begun()
              signal.addEventListener("abort", () => {
                aborted(signal.aborted)
                resolve({ text: "stopped" })
              })
            }),
        }),
      ],
    })
    const served = await serveOverHttp(extension)
    const client = await clientAt(served.url, { era: "modern" })
    const call = client.callTool({ name: "wait", arguments: {} })
    await started
    const closing = served.close()
    await expect(call).rejects.toThrow()
    await closing
    await expect(sawAbort).resolves.toBe(true)
    await client.close()
  })
})
