import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/client"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod/v4"

import { defineExtension, defineTool, type Extension, type Tool } from "./definition.ts"
import {
  apps,
  capabilitiesFor,
  clientAt,
  overHttp,
  overStdio,
  sample,
  type ClientSetup,
  type Era,
} from "./testing.ts"
import { serveOverHttp } from "./transports.ts"

const opened: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()))
})

/** What a tool answered, without the result `_meta` a 2026-07-28 server adds to every result. */
function answer(result: Record<string, unknown>) {
  const { _meta: _envelope, ...rest } = result
  return rest
}

const transports = { stdio: overStdio, http: overHttp } as const
const eras: readonly Era[] = ["legacy", "modern"]

async function connect(
  transport: keyof typeof transports,
  setup: ClientSetup,
  extension: Extension = sample,
) {
  const connection = await transports[transport](extension, setup)
  opened.push(connection.close)
  return connection.client
}

const notFound = (uri: string) => ({
  code: -32602,
  message: expect.stringContaining(`Resource not found: ${uri}`),
})
const unknownTool = (name: string) => ({
  code: -32602,
  message: expect.stringContaining(`Unknown tool: ${name}`),
})

/** `[1, <hole>, 3]`, written without a sparse literal. */
const holey = (): unknown[] => Object.assign(new Array<unknown>(3), { 0: 1, 2: 3 })

/** Tools whose answers break the rules, as untyped code could write them. */
const unruly = (run: () => unknown): Tool =>
  defineTool({
    name: "unruly",
    description: "Answers as it likes",
    input: z.object({}),
    effects: "read-only",
    run: run as Tool["run"],
  })

describe.each(Object.keys(transports) as Array<keyof typeof transports>)(
  "over %s",
  (transport) => {
    // HTTP serves 2026-07-28 clients only; stdio serves both eras.
    describe.each(transport === "http" ? (["modern"] as const) : eras)(
      "a %s-era client",
      (era) => {
        describe("that renders MCP Apps", () => {
          const setup = { era, mimeTypes: apps }

          it("lists every tool, with its view and callers in _meta.ui and its effects as hints", async () => {
            const client = await connect(transport, setup)
            const { tools } = await client.listTools()
            expect(
              tools.map((tool) => [tool.name, tool._meta, tool.annotations]),
            ).toEqual([
              [
                "show_board",
                {
                  ui: { resourceUri: "ui://sample/board", visibility: ["model", "app"] },
                },
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

          it("writes _meta.ui for a tool without a view only when its callers are not the default", async () => {
            const view = sample.views[0]!
            const extension = defineExtension({
              name: "callers",
              version: "0.0.1",
              views: [view],
              tools: [
                { name: "both", callers: ["app", "model"] as const },
                { name: "app_only", callers: ["app"] as const },
                { name: "model_only", callers: ["model"] as const },
              ].map(({ name, callers }) =>
                defineTool({
                  name,
                  description: name,
                  input: z.object({}),
                  effects: "read-only",
                  callers,
                  run: () => ({ text: name }),
                }),
              ),
            })
            const client = await connect(transport, setup, extension)
            expect(
              (await client.listTools()).tools.map((tool) => [tool.name, tool._meta]),
            ).toEqual([
              ["both", undefined],
              ["app_only", { ui: { visibility: ["app"] } }],
              ["model_only", { ui: { visibility: ["model"] } }],
            ])
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
            expect((await client.listResourceTemplates()).resourceTemplates).toEqual([])
          })

          it("answers a call with text, and the data as structured content", async () => {
            const client = await connect(transport, setup)
            expect(
              answer(
                await client.callTool({ name: "show_board", arguments: { rows: 3 } }),
              ),
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

          it("refuses a view it does not declare as not found", async () => {
            const client = await connect(transport, setup)
            await expect(
              client.readResource({ uri: "ui://sample/other" }),
            ).rejects.toMatchObject(notFound("ui://sample/other"))
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
              answer(
                await client.callTool({ name: "show_board", arguments: { rows: 2 } }),
              ),
            ).toEqual({
              content: [{ type: "text", text: "2 rows" }],
              structuredContent: { rows: 2 },
            })
          })

          it("lists no view, but serves one read by its URI", async () => {
            const client = await connect(transport, setup)
            expect((await client.listResources()).resources).toEqual([])
            expect(
              (await client.readResource({ uri: "ui://sample/board" })).contents,
            ).toEqual([
              expect.objectContaining({
                uri: "ui://sample/board",
                mimeType: RESOURCE_MIME_TYPE,
              }),
            ])
          })

          it("does not call a tool only the app may call", async () => {
            const client = await connect(transport, setup)
            await expect(
              client.callTool({ name: "refresh_board", arguments: {} }),
            ).rejects.toMatchObject(unknownTool("refresh_board"))
          })
        })

        describe("calling a tool", () => {
          const setup = { era, mimeTypes: apps }

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

          it.each([
            [
              "throws",
              () => {
                throw new Error("disk is full")
              },
              "unruly failed: disk is full",
            ],
            ["rejects", () => Promise.reject(new Error("gone")), "unruly failed: gone"],
            [
              "answers blank text",
              () => ({ text: "  " }),
              "unruly answered without text, which every tool must give",
            ],
            [
              "answers no text",
              () => ({ data: {} }),
              "unruly answered without text, which every tool must give",
            ],
            ["answers nothing", () => undefined, "unruly answered with no outcome"],
            ["answers a string", () => "done", "unruly answered with no outcome"],
            [
              "answers data that is an array",
              () => ({ text: "x", data: [1] }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a BigInt",
              () => ({ text: "x", data: { n: 1n } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a non-finite number",
              () => ({ text: "x", data: { n: Infinity } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a Date",
              () => ({ text: "x", data: { at: new Date(0) } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers undefined inside data",
              () => ({ text: "x", data: { a: [undefined] } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers data whose getter throws",
              () => ({
                text: "x",
                data: {
                  get a() {
                    throw new Error("boom")
                  },
                },
              }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers text through a getter, which is never run",
              () => ({
                get text() {
                  throw new Error("boom-text")
                },
              }),
              "unruly answered with no outcome",
            ],
            [
              "answers a proxy whose keys throw",
              () => ({
                text: "x",
                data: new Proxy(
                  {},
                  {
                    ownKeys() {
                      throw new Error("proxy-boom")
                    },
                  },
                ),
              }),
              "unruly failed: proxy-boom",
            ],
            [
              "answers data nested too deep",
              () => {
                let deep: unknown = 1
                for (let i = 0; i < 20000; i++) deep = [deep]
                return { text: "x", data: { deep } }
              },
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a symbol key",
              () => ({ text: "x", data: { [Symbol("s")]: 1n } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a sparse array",
              () => ({ text: "x", data: { a: holey() } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers an array with an extra property",
              () => ({ text: "x", data: { a: Object.assign([1], { extra: 2 }) } }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a hole balanced by an extra property",
              () => ({
                text: "x",
                data: { list: Object.assign(holey(), { extra: 2 }) },
              }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers data as an array",
              () => ({ text: "x", data: [1] }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a property JSON would not see",
              () => ({
                text: "x",
                data: Object.defineProperty({}, "hidden", {
                  value: 1,
                  enumerable: false,
                }),
              }),
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a key an answer does not have",
              () => ({ text: "x", structuredContent: { a: 1 } }),
              "unruly answered with structuredContent, which an answer does not have",
            ],
            [
              "answers data 257 levels deep",
              () => {
                let deep: Record<string, unknown> = {}
                for (let i = 0; i < 256; i++) deep = { d: deep }
                return { text: "x", data: deep }
              },
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
            [
              "answers a cycle",
              () => {
                const data: Record<string, unknown> = {}
                data.self = data
                return { text: "x", data }
              },
              "unruly answered with data that is not a JSON object of at most 256 levels",
            ],
          ])(
            "reports a run that %s as a tool error naming the tool",
            async (_name, run, text) => {
              const extension = defineExtension({
                name: "unruly",
                version: "0.0.1",
                views: [],
                tools: [unruly(run)],
              })
              const client = await connect(transport, setup, extension)
              expect(
                answer(await client.callTool({ name: "unruly", arguments: {} })),
              ).toEqual({
                content: [{ type: "text", text }],
                isError: true,
              })
            },
          )

          it("takes data that JSON carries, shared, nested or without a prototype", async () => {
            const shared = { k: [1, "a", null, true] }
            const bare = Object.assign(Object.create(null) as Record<string, unknown>, {
              n: 1,
            })
            const extension = defineExtension({
              name: "json",
              version: "0.0.1",
              views: [],
              tools: [
                unruly(() => ({
                  text: "x",
                  data: { a: shared, b: shared, c: { d: [] }, bare },
                })),
              ],
            })
            const client = await connect(transport, setup, extension)
            expect(
              answer(await client.callTool({ name: "unruly", arguments: {} })),
            ).toEqual({
              content: [{ type: "text", text: "x" }],
              structuredContent: { a: shared, b: shared, c: { d: [] }, bare: { n: 1 } },
            })
          })

          it("takes data 256 levels deep, and an own __proto__ key as a key", async () => {
            let deep: Record<string, unknown> = {}
            // `data` is the first level, so `deep` holds the other 255.
            for (let i = 0; i < 254; i++) deep = { d: deep }
            const own = JSON.parse('{"__proto__": {"polluted": true}}') as object
            const extension = defineExtension({
              name: "deep",
              version: "0.0.1",
              views: [],
              tools: [unruly(() => ({ text: "x", data: { deep, own } }))],
            })
            const client = await connect(transport, setup, extension)
            const result = answer(
              await client.callTool({ name: "unruly", arguments: {} }),
            )
            expect(result.isError).toBeUndefined()
            const sent = result.structuredContent as { own: object }
            expect(Object.hasOwn(sent.own, "__proto__")).toBe(true)
            expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
          })

          it("takes data: undefined as no data", async () => {
            const extension = defineExtension({
              name: "nodata",
              version: "0.0.1",
              views: [],
              tools: [unruly(() => ({ text: "x", data: undefined }))],
            })
            const client = await connect(transport, setup, extension)
            expect(
              answer(await client.callTool({ name: "unruly", arguments: {} })),
            ).toEqual({
              content: [{ type: "text", text: "x" }],
            })
          })

          it("sends a copy, so an array's own toJSON never runs", async () => {
            const list = [1, 2]
            Object.setPrototypeOf(
              list,
              Object.assign(Object.create(Array.prototype), { toJSON: () => "replaced" }),
            )
            const extension = defineExtension({
              name: "copied",
              version: "0.0.1",
              views: [],
              tools: [unruly(() => ({ text: "x", data: { list } }))],
            })
            const client = await connect(transport, setup, extension)
            expect(
              answer(await client.callTool({ name: "unruly", arguments: {} })),
            ).toEqual({
              content: [{ type: "text", text: "x" }],
              structuredContent: { list: [1, 2] },
            })
          })

          it("sends the copy it checked, not what a proxy answers afterwards", async () => {
            let reads = 0
            const data = new Proxy(
              { a: 1 },
              {
                getOwnPropertyDescriptor(target, key) {
                  reads += 1
                  if (reads > 1) throw new Error("late read")
                  return Reflect.getOwnPropertyDescriptor(target, key)
                },
              },
            )
            const extension = defineExtension({
              name: "proxied",
              version: "0.0.1",
              views: [],
              tools: [unruly(() => ({ text: "x", data }))],
            })
            const client = await connect(transport, setup, extension)
            expect(
              answer(await client.callTool({ name: "unruly", arguments: {} })),
            ).toEqual({
              content: [{ type: "text", text: "x" }],
              structuredContent: { a: 1 },
            })
          })

          it.each([
            [
              "an async refinement",
              z.object({ n: z.number() }).refine(async () => true),
              { type: "text", text: "parsed" },
            ],
            [
              "a transform that throws",
              z.object({
                n: z.number().transform(() => {
                  throw new Error("boom in transform")
                }),
              }),
              { type: "text", text: "parse failed: boom in transform" },
            ],
          ])("parses input with %s inside the guard", async (_name, input, expected) => {
            const extension = defineExtension({
              name: "parsing",
              version: "0.0.1",
              views: [],
              tools: [
                defineTool({
                  name: "parse",
                  description: "Parses its input",
                  input: input as z.ZodObject,
                  effects: "read-only",
                  run: () => ({ text: "parsed" }),
                }),
              ],
            })
            const client = await connect(transport, setup, extension)
            const result = answer(
              await client.callTool({ name: "parse", arguments: { n: 1 } }),
            )
            expect(result.content).toEqual([expected])
          })

          it("refuses a tool it does not have", async () => {
            const client = await connect(transport, setup)
            await expect(
              client.callTool({ name: "toString", arguments: {} }),
            ).rejects.toMatchObject(unknownTool("toString"))
          })

          it("aborts the run's signal when the caller cancels", async () => {
            let aborted: (reason: unknown) => void = () => {}
            const seen = new Promise((resolve) => (aborted = resolve))
            const extension = defineExtension({
              name: "slow",
              version: "0.0.1",
              views: [],
              tools: [
                defineTool({
                  name: "wait",
                  description: "Waits until cancelled",
                  input: z.object({}),
                  effects: "read-only",
                  run: (_input, { signal }) =>
                    new Promise((resolve) =>
                      signal.addEventListener("abort", () => {
                        aborted(signal.aborted)
                        resolve({ text: "stopped" })
                      }),
                    ),
                }),
              ],
            })
            const client = await connect(transport, setup, extension)
            const controller = new AbortController()
            const call = client.callTool(
              { name: "wait", arguments: {} },
              { signal: controller.signal },
            )
            await new Promise((resolve) => setTimeout(resolve, 50))
            controller.abort()
            await expect(call).rejects.toThrow()
            await expect(seen).resolves.toBe(true)
          })
        })

        describe("reading a view", () => {
          it("names the view when its html throws", async () => {
            const view = {
              ...sample.views[0]!,
              html: () => Promise.reject(new Error("no build")),
            }
            const extension = defineExtension({
              name: "broken",
              version: "0.0.1",
              views: [view],
              tools: [],
            })
            const client = await connect(transport, { era, mimeTypes: apps }, extension)
            await expect(client.readResource({ uri: view.uri })).rejects.toMatchObject({
              code: -32603,
              message: expect.stringContaining("View ui://sample/board failed: no build"),
            })
          })

          it("refuses a view whose html is not a document", async () => {
            const view = {
              ...sample.views[0]!,
              html: (() => 42) as unknown as () => string,
            }
            const extension = defineExtension({
              name: "broken",
              version: "0.0.1",
              views: [view],
              tools: [],
            })
            const client = await connect(transport, { era, mimeTypes: apps }, extension)
            await expect(client.readResource({ uri: view.uri })).rejects.toMatchObject({
              code: -32603,
              message: expect.stringContaining(
                "View ui://sample/board gave no HTML document",
              ),
            })
          })
        })
      },
    )
  },
)

describe("a 2025-era client's capabilities", () => {
  it.each(["stdio"] as const)(
    "come from initialize over %s, whatever a later request's _meta claims",
    async (transport) => {
      const plain = await connect(transport, { era: "legacy" })
      const claimed = {
        _meta: {
          [CLIENT_CAPABILITIES_META_KEY]: capabilitiesFor({
            era: "legacy",
            mimeTypes: apps,
          }),
        },
      }
      expect((await plain.listTools(claimed)).tools.map((tool) => tool.name)).toEqual([
        "show_board",
        "clear",
      ])

      const rendering = await connect(transport, { era: "legacy", mimeTypes: apps })
      const denied = { _meta: { [CLIENT_CAPABILITIES_META_KEY]: {} } }
      expect((await rendering.listTools(denied)).tools.map((tool) => tool.name)).toEqual([
        "show_board",
        "refresh_board",
        "clear",
      ])
    },
  )
})

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
