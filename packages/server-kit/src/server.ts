/**
 * An extension's MCP server: `tools/list`, `tools/call`, `resources/list`,
 * `resources/templates/list` and `resources/read`, each answered for the
 * client that sent the request. What a client that renders MCP Apps is
 * offered, and what any other client is, is the package README's
 * "Negotiation, per request" table.
 *
 * It is built on the SDK's low-level `Server`, not `McpServer`, because
 * `McpServer` lists one fixed set of tools, and this list depends on who asks.
 */
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  Server,
  type CallToolResult,
  type McpRequestContext,
  type Resource,
  type Tool as ListedTool,
} from "@modelcontextprotocol/server"
import { z } from "zod/v4"

import {
  checkedOf,
  defaultCallers,
  toolAnnotations,
  type Checked,
  type Extension,
  type Tool,
  type ViewDefinition,
} from "./definition.ts"
import { capabilitiesReader, rendersApps } from "./negotiation.ts"

/**
 * A factory the SDK's serving entries call for each connection (stdio), each
 * 2025-era session or each 2026-07-28 request (HTTP), each time with a fresh
 * `Server` over the same extension.
 */
export function serverFactory(extension: Extension): (ctx: McpRequestContext) => Server {
  const checked = checkedOf(extension)
  return serverFactoryOf(checked)
}

function serverFactoryOf(extension: Checked): (ctx: McpRequestContext) => Server {
  const tools = new Map(extension.tools.map((tool) => [tool.name, tool]))
  const views = new Map(extension.views.map((view) => [view.uri as string, view]))
  return ({ era }) => {
    const server = new Server(
      { name: extension.name, version: extension.version },
      {
        // No `extensions` entry: a server's capabilities are fixed before a
        // client declares its own, and MCP Apps defines the capability for
        // clients only; what a server offers each client is negotiated per
        // request (the README's "Negotiation, per request").
        capabilities: {
          tools: {},
          resources: {},
        },
        ...(extension.instructions === undefined
          ? {}
          : { instructions: extension.instructions }),
      },
    )
    const capabilities = capabilitiesReader(server, era)

    server.setRequestHandler("tools/list", (_request, ctx) => {
      const apps = rendersApps(capabilities(ctx))
      return {
        tools: [...tools.values()]
          .filter((tool) => apps || offeredWithoutApps(tool))
          .map((tool) => listedTool(extension, tool, apps)),
      }
    })

    server.setRequestHandler("tools/call", async (request, ctx) => {
      const { name, arguments: args } = request.params
      const tool = tools.get(name)
      if (
        tool === undefined ||
        (!rendersApps(capabilities(ctx)) && !offeredWithoutApps(tool))
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`)
      }
      return callTool(tool, args ?? {}, ctx.mcpReq.signal)
    })

    server.setRequestHandler("resources/list", (_request, ctx) => ({
      resources: rendersApps(capabilities(ctx))
        ? [...views.values()].map(listedView)
        : [],
    }))

    server.setRequestHandler("resources/templates/list", () => ({
      resourceTemplates: [],
    }))

    // A view is read whatever the client declared: the standard lets a server
    // leave views out of `resources/list`, not refuse to read them, and a host
    // that renders apps without declaring the extension still finds a view
    // by its URI.
    server.setRequestHandler("resources/read", async (request) => {
      const { uri } = request.params
      const view = views.get(uri)
      if (view === undefined) throw new ResourceNotFoundError(uri)
      let html: unknown
      try {
        html = await view.html()
      } catch (error) {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `View ${view.uri} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (typeof html !== "string") {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `View ${view.uri} gave no HTML document`,
        )
      }
      return {
        contents: [
          {
            uri: view.uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            ...(view.ui === undefined ? {} : { _meta: { ui: view.ui } }),
          },
        ],
      }
    })

    return server
  }
}

/** Whether a client without MCP Apps is offered `tool`: only when the model may call it. */
function offeredWithoutApps(tool: Tool): boolean {
  return (tool.callers ?? defaultCallers).includes("model")
}

/**
 * The tool as listed. A client that renders apps sees `_meta.ui` when the
 * tool has a view or callers other than the default. The deprecated flat
 * `_meta["ui/resourceUri"]` is not written (one current contract).
 */
function listedTool(extension: Checked, tool: Tool, apps: boolean): ListedTool {
  const callers = tool.callers ?? defaultCallers
  const defaultVisibility =
    callers.length === defaultCallers.length &&
    defaultCallers.every((caller) => callers.includes(caller))
  const ui =
    tool.view === undefined && defaultVisibility
      ? undefined
      : {
          ...(tool.view === undefined ? {} : { resourceUri: tool.view }),
          visibility: [...callers],
        }
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: extension.inputSchemas.get(tool.name) as ListedTool["inputSchema"],
    annotations: toolAnnotations(tool.effects),
    ...(apps && ui !== undefined ? { _meta: { ui } } : {}),
  }
}

function listedView(view: ViewDefinition): Resource {
  return {
    uri: view.uri,
    name: view.name,
    ...(view.title === undefined ? {} : { title: view.title }),
    ...(view.description === undefined ? {} : { description: view.description }),
    mimeType: RESOURCE_MIME_TYPE,
    ...(view.ui === undefined ? {} : { _meta: { ui: view.ui } }),
  }
}

/**
 * Runs `tool` on `args`. What a tool must answer, and that anything else is a
 * tool error naming it, is the package README's "Using it". Everything that
 * can run the tool's code — parsing its input, `run`, reading its answer —
 * happens inside the guard, and what is sent is a copy parsed from the
 * answer, never the answer itself.
 */
async function callTool(
  tool: Tool,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const input = await tool.input.safeParseAsync(args)
    if (!input.success) {
      return failure(
        `${tool.name} was given input it does not take: ${z.prettifyError(input.error)}`,
      )
    }
    const outcome = ownProperties(await tool.run(input.data, { signal }))
    if (outcome === undefined) return failure(`${tool.name} answered with no outcome`)
    const unknown = [...outcome.keys()].filter((key) => key !== "text" && key !== "data")
    if (unknown.length > 0) {
      return failure(
        `${tool.name} answered with ${unknown.join(", ")}, which an answer does not have`,
      )
    }
    const text = outcome.get("text")
    if (typeof text !== "string" || text.trim().length === 0) {
      return failure(`${tool.name} answered without text, which every tool must give`)
    }
    // `data?` lets a tool write `data: undefined`; that is no data.
    const answered = outcome.get("data")
    if (answered === undefined) return { content: [{ type: "text", text }] }
    const data = toJson(answered, 0)
    if (
      data === undefined ||
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return failure(
        `${tool.name} answered with data that is not a JSON object of at most ${maxDepth} levels`,
      )
    }
    return { content: [{ type: "text", text }], structuredContent: data }
  } catch (error) {
    return failure(
      `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** A JSON value, as `toJson` builds it. */
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** How deep `toJson` goes before it calls a value too deep to carry. */
const maxDepth = 256

/**
 * A plain object's own string-keyed data properties, read from their
 * descriptors so no getter runs; `undefined` for anything else — an array,
 * a class instance, a value with a symbol key, an accessor, or a property
 * JSON would not see.
 */
function ownProperties(value: unknown): Map<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const properties = new Map<string, unknown>()
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key === "symbol" || property === undefined || !("value" in property)) {
      return undefined
    }
    // JSON would not see a non-enumerable property, so it cannot carry the value whole.
    if (property.enumerable !== true) return undefined
    properties.set(key, property.value)
  }
  return properties
}

/**
 * A fresh JSON copy of `value`, or `undefined` when JSON cannot carry it
 * whole: anything but null, booleans, strings, finite numbers, and arrays
 * and plain objects of those — no holes, no extra or accessor properties, no
 * symbol keys, nesting under `maxDepth` (so no cycles). The copy is built from
 * what was read once, so it is exactly what was checked, whatever the
 * original does afterwards.
 */
function toJson(value: unknown, depth: number): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  // A cycle never ends, so it passes `maxDepth` and is refused there.
  if (typeof value !== "object" || depth >= maxDepth) return undefined
  if (Array.isArray(value)) return arrayToJson(value, depth)
  const properties = ownProperties(value)
  if (properties === undefined) return undefined
  const entries: Array<[string, JsonValue]> = []
  for (const [key, inner] of properties) {
    const json = toJson(inner, depth + 1)
    if (json === undefined) return undefined
    entries.push([key, json])
  }
  // `fromEntries` defines each key as its own property, `__proto__` included.
  return Object.fromEntries(entries)
}

function arrayToJson(value: unknown[], depth: number): JsonValue[] | undefined {
  const length = value.length
  const keys = Reflect.ownKeys(value)
  // Exactly its indices and `length`: no holes, nothing JSON would drop.
  if (keys.length !== length + 1) return undefined
  const copy: JsonValue[] = []
  for (const key of keys) {
    if (key === "length") continue
    if (typeof key !== "string" || String(Number(key)) !== key || Number(key) >= length) {
      return undefined
    }
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (property === undefined || !("value" in property)) return undefined
    const json = toJson(property.value, depth + 1)
    if (json === undefined) return undefined
    copy[Number(key)] = json
  }
  return copy
}

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true }
}
