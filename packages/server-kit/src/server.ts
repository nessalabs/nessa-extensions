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
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
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
        capabilities: {
          tools: {},
          resources: {},
          extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
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
 * Runs `tool` on `args`. Input that does not parse, a `run` that throws, and
 * an answer that is not text with optional JSON data are each a tool error
 * naming the tool — never a success, and never a protocol error that hides
 * which tool failed.
 */
async function callTool(
  tool: Tool,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  const input = tool.input.safeParse(args)
  if (!input.success) {
    return failure(
      `${tool.name} was given input it does not take: ${z.prettifyError(input.error)}`,
    )
  }
  try {
    const outcome: unknown = await tool.run(input.data, { signal })
    // Read inside the guard: getters and proxies in an outcome run code.
    if (!isPlainObject(outcome)) return failure(`${tool.name} answered with no outcome`)
    const { text, data } = outcome
    if (typeof text !== "string" || text.trim().length === 0) {
      return failure(`${tool.name} answered without text, which every tool must give`)
    }
    if (data !== undefined && !(isPlainObject(data) && isJson(data, new Set(), 0))) {
      return failure(`${tool.name} answered with data that is not a JSON object`)
    }
    return {
      content: [{ type: "text", text }],
      ...(data === undefined ? {} : { structuredContent: data }),
    }
  } catch (error) {
    return failure(
      `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** How deep `isJson` walks before it calls a value too deep to carry. */
const maxDepth = 256

/**
 * Whether JSON carries `value` without losing any of it: null, booleans,
 * strings, finite numbers, and arrays and plain objects of those — no holes
 * or extra properties on an array, no symbol keys, no accessors, no cycles,
 * and nesting under `maxDepth`. `inside` holds the containers being walked.
 */
function isJson(value: unknown, inside: Set<object>, depth: number): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || inside.has(value) || depth >= maxDepth) return false
  const array = Array.isArray(value)
  if (!array && !isPlainObject(value)) return false
  const keys = Reflect.ownKeys(value)
  if (array) {
    // Exactly its indices and `length`: no holes, nothing JSON drops.
    if (keys.length !== value.length + 1) return false
  }
  inside.add(value)
  const json = keys.every((key) => {
    if (typeof key === "symbol") return false
    if (array && key === "length") return true
    // Read from the descriptor, so no getter runs; an accessor has no
    // `value`, which is not JSON.
    const property = Object.getOwnPropertyDescriptor(value, key)
    return (
      property !== undefined &&
      property.enumerable === true &&
      isJson(property.value, inside, depth + 1)
    )
  })
  inside.delete(value)
  return json
}

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true }
}
