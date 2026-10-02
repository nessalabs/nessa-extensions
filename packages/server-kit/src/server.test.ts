import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod/v4"

import { defineExtension, defineTool, type ExtensionDefinition } from "./definition.ts"
import {
  apps,
  clientAt,
  overHttp,
  overStdio,
  sample,
  type ClientSetup,
  type Era,
} from "./testing.ts"
import { serveOverHttp } from "./transports.ts"

const opened: Array<() => Promise<void>> = []

/** What a tool answered, without the result `_meta` a 2026-07-28 server adds to every result. */
function answer(result: Record<string, unknown>) {
  const { _meta: _envelope, ...rest } = result
  return rest
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()))
})

const transports = { stdio: overStdio, http: overHttp } as const
const eras: readonly Era[] = ["legacy", "modern"]

async function connect(
  transport: keyof typeof transports,
  setup: ClientSetup,
  definition: ExtensionDefinition = sample,
) {
  const connection = await transports[transport](definition, setup)
  opened.push(connection.close)
  return connection.client
}

describe.each(Object.keys(transports) as Array<keyof typeof transports>)(
  "over %s",
  (transport) => {
    describe.each(eras)("a %s-era client", (era) => {
      describe("that renders MCP Apps", () => {
        const setup = { era, mimeTypes: apps }

        it("lists every tool, with its view and callers in _meta.ui and its effects as hints", async () => {
          const client = await connect(transport, setup)
          const { tools } = await client.listTools()
          expect(tools.map((tool) => [tool.name, tool._meta, tool.annotations])).toEqual([
            [
              "show_board",
              { ui: { resourceUri: "ui://sample/board", visibility: ["model", "app"] } },
              { readOnlyHint: true, destructiveHint: false },
            ],
            [
              "refresh_board",
              { ui: { resourceUri: "ui://sample/board", visibility: ["app"] } },
              { readOnlyHint: false, destructiveHint: false },
            ],
            ["clear", undefined, { readOnlyHint: false, destructiveHint: true }],
          ])
          expect(tools[0]?.inputSchema).toMatchObject({
            type: "object",
            properties: { rows: { type: "integer", minimum: 1 } },
            required: ["rows"],
          })
        })

        it("declares MCP Apps in its own capabilities", async () => {
          const client = await connect(transport, setup)
          expect(client.getServerCapabilities()?.extensions).toEqual({
            "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] },
          })
        })

        it("lists and serves the view as text/html;profile=mcp-app with its _meta.ui", async () => {
          const client = await connect(transport, setup)
          const ui = {
            csp: { connectDomains: ["https://api.example.com"] },
            permissions: { clipboardWrite: {} },
            prefersBorder: true,
          }
          expect((await client.listResources()).resources).toEqual([
            {
              uri: "ui://sample/board",
              name: "board",
              title: "Board",
              description: "The sample board",
              mimeType: RESOURCE_MIME_TYPE,
              _meta: { ui },
            },
          ])
          expect(
            (await client.readResource({ uri: "ui://sample/board" })).contents,
          ).toEqual([
            {
              uri: "ui://sample/board",
              mimeType: RESOURCE_MIME_TYPE,
              text: "<!doctype html><html><body>board</body></html>",
              _meta: { ui },
            },
          ])
        })

        it("answers a call with text, and the data as structured content", async () => {
          const client = await connect(transport, setup)
          expect(
            answer(await client.callTool({ name: "show_board", arguments: { rows: 3 } })),
          ).toEqual({
            content: [{ type: "text", text: "3 rows" }],
            structuredContent: { rows: 3 },
          })
          expect(
            answer(await client.callTool({ name: "refresh_board", arguments: {} })),
          ).toEqual({
            content: [{ type: "text", text: "refreshed" }],
          })
        })

        it("refuses a view it does not declare", async () => {
          const client = await connect(transport, setup)
          await expect(
            client.readResource({ uri: "ui://sample/other" }),
          ).rejects.toThrow()
        })
      })

      describe.each([
        ["declares no extensions", undefined],
        ["declares MCP Apps without the mcp-app type", ["text/html"]],
      ] as const)("that %s", (_name, mimeTypes) => {
        const setup = { era, ...(mimeTypes === undefined ? {} : { mimeTypes }) }

        it("lists the tools the model may call, without _meta.ui", async () => {
          const client = await connect(transport, setup)
          const { tools } = await client.listTools()
          expect(tools.map((tool) => [tool.name, tool._meta])).toEqual([
            ["show_board", undefined],
            ["clear", undefined],
          ])
        })

        it("still answers in text", async () => {
          const client = await connect(transport, setup)
          expect(
            answer(await client.callTool({ name: "show_board", arguments: { rows: 2 } })),
          ).toEqual({
            content: [{ type: "text", text: "2 rows" }],
            structuredContent: { rows: 2 },
          })
        })

        it("neither lists nor serves a view, nor calls a tool only the app may call", async () => {
          const client = await connect(transport, setup)
          expect((await client.listResources()).resources).toEqual([])
          await expect(
            client.readResource({ uri: "ui://sample/board" }),
          ).rejects.toThrow()
          await expect(
            client.callTool({ name: "refresh_board", arguments: {} }),
          ).rejects.toThrow(/Unknown tool: refresh_board/)
        })
      })

      describe("calling a tool", () => {
        const setup = { era, mimeTypes: apps }
        const failing = defineExtension({
          name: "failing",
          version: "0.0.1",
          views: [],
          tools: [
            defineTool({
              name: "throws",
              description: "Throws",
              input: z.object({}),
              effects: "read-only",
              run: () => {
                throw new Error("disk is full")
              },
            }),
            defineTool({
              name: "silent",
              description: "Answers with no text",
              input: z.object({}),
              effects: "read-only",
              run: () => ({ text: "  " }),
            }),
          ],
        })

        it("reports input it does not take as a tool error", async () => {
          const client = await connect(transport, setup)
          const result = await client.callTool({
            name: "show_board",
            arguments: { rows: 0 },
          })
          expect(result.isError).toBe(true)
          expect(result.content).toEqual([
            {
              type: "text",
              text: expect.stringMatching(
                /^show_board was given input it does not take: .*rows/s,
              ),
            },
          ])
        })

        it("reports a run that throws, and an answer without text, as tool errors", async () => {
          const client = await connect(transport, setup, failing)
          expect(
            answer(await client.callTool({ name: "throws", arguments: {} })),
          ).toEqual({
            content: [{ type: "text", text: "throws failed: disk is full" }],
            isError: true,
          })
          expect(
            answer(await client.callTool({ name: "silent", arguments: {} })),
          ).toEqual({
            content: [
              {
                type: "text",
                text: "silent answered without text, which every tool must give",
              },
            ],
            isError: true,
          })
        })

        it("refuses a tool it does not have", async () => {
          const client = await connect(transport, setup)
          await expect(
            client.callTool({ name: "toString", arguments: {} }),
          ).rejects.toThrow(/Unknown tool: toString/)
        })
      })
    })
  },
)

describe("over http, modern era", () => {
  it("answers each request on one endpoint for the client that sent it", async () => {
    const serving = await serveOverHttp(sample)
    opened.push(serving.close)
    const withApps = await clientAt(serving.url, { era: "modern", mimeTypes: apps })
    const plain = await clientAt(serving.url, { era: "modern" })
    opened.push(
      () => withApps.close(),
      () => plain.close(),
    )
    expect((await withApps.listTools()).tools.map((tool) => tool.name)).toEqual([
      "show_board",
      "refresh_board",
      "clear",
    ])
    expect((await plain.listTools()).tools.map((tool) => tool.name)).toEqual([
      "show_board",
      "clear",
    ])
    expect((await withApps.listTools()).tools).toHaveLength(3)
  })
})
