/**
 * An extension's MCP server, built from its definition: `tools/list`,
 * `tools/call`, `resources/list` and `resources/read`, each answered for the
 * client that sent the request (`negotiation.ts`).
 *
 * For a client that renders MCP Apps, a tool lists its view and callers in
 * `_meta.ui`, and the views are resources. For one that does not, the server
 * is a plain MCP server: tools list without `_meta.ui`, a tool only the app
 * may call is neither listed nor callable, and views are neither listed nor
 * readable. Either way a call answers in text (`ToolOutcome.text`).
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
  type McpServerFactory,
  type Resource,
  type ServerContext,
  type Tool,
} from "@modelcontextprotocol/server"
import { z } from "zod/v4"

import {
  defaultCallers,
  toolAnnotations,
  type ExtensionDefinition,
  type ToolDefinition,
  type ViewDefinition,
} from "./definition.ts"
import { clientCapabilitiesOf, rendersApps } from "./negotiation.ts"

/**
 * A factory the SDK's serving entries call for each connection (stdio) or
 * request (HTTP), each time with a fresh `Server` over the same definition.
 */
export function serverFactory(definition: ExtensionDefinition): McpServerFactory {
  const tools = new Map(definition.tools.map((tool) => [tool.name, tool]))
  const views = new Map(definition.views.map((view) => [view.uri as string, view]))
  return () => createServer(definition, tools, views)
}

function createServer(
  definition: ExtensionDefinition,
  tools: ReadonlyMap<string, ToolDefinition>,
  views: ReadonlyMap<string, ViewDefinition>,
): Server {
  const server = new Server(
    { name: definition.name, version: definition.version },
    {
      capabilities: {
        tools: {},
        resources: {},
        extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
      },
      ...(definition.instructions === undefined
        ? {}
        : { instructions: definition.instructions }),
    },
  )
  const apps = (ctx: ServerContext) => rendersApps(clientCapabilitiesOf(server, ctx))

  server.setRequestHandler("tools/list", (_request, ctx) => {
    const withApps = apps(ctx)
    return {
      tools: [...tools.values()]
        .filter((tool) => withApps || offeredWithoutApps(tool))
        .map((tool) => listedTool(tool, withApps)),
    }
  })

  server.setRequestHandler("tools/call", async (request, ctx) => {
    const { name, arguments: args } = request.params
    const tool = tools.get(name)
    if (tool === undefined || (!apps(ctx) && !offeredWithoutApps(tool))) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`)
    }
    return callTool(tool, args ?? {}, ctx.mcpReq.signal)
  })

  server.setRequestHandler("resources/list", (_request, ctx) => ({
    resources: apps(ctx) ? [...views.values()].map(listedView) : [],
  }))

  server.setRequestHandler("resources/read", async (request, ctx) => {
    const { uri } = request.params
    const view = views.get(uri)
    if (view === undefined || !apps(ctx)) throw new ResourceNotFoundError(uri)
    const html = await view.html()
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

/** Whether a client without MCP Apps is offered `tool`: only when the model may call it. */
function offeredWithoutApps(tool: ToolDefinition): boolean {
  return (tool.callers ?? defaultCallers).includes("model")
}

function listedTool(tool: ToolDefinition, withApps: boolean): Tool {
  const ui =
    tool.view === undefined && tool.callers === undefined
      ? undefined
      : {
          ...(tool.view === undefined ? {} : { resourceUri: tool.view }),
          visibility: [...(tool.callers ?? defaultCallers)],
        }
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: "input" }) as Tool["inputSchema"],
    annotations: toolAnnotations(tool.effects),
    ...(withApps && ui !== undefined ? { _meta: { ui } } : {}),
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
 * an answer without text are each a tool error the caller can read — never a
 * success, and never a protocol error that hides which tool failed.
 */
async function callTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  const input = tool.input.safeParse(args)
  if (!input.success) {
    return failure(
      `${tool.name} was given input it does not take: ${z.prettifyError(input.error)}`,
    )
  }
  let outcome
  try {
    outcome = await tool.run(input.data, { signal })
  } catch (error) {
    return failure(
      `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof outcome.text !== "string" || outcome.text.trim().length === 0) {
    return failure(`${tool.name} answered without text, which every tool must give`)
  }
  return {
    content: [{ type: "text", text: outcome.text }],
    ...(outcome.data === undefined ? {} : { structuredContent: outcome.data }),
  }
}

function failure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true }
}
