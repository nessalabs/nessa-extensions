/**
 * What an extension declares: its views (`ui://` resources) and its tools,
 * checked once, when it is defined. Only `defineExtension` makes an
 * `Extension`, and only an `Extension` can be served, so a server never
 * starts with a tool that names a view it does not serve, or an input it
 * cannot describe.
 *
 * A tool says what it changes as one of three `effects`, not as two hints
 * that could disagree: `readOnlyHint` and `destructiveHint` are derived from
 * it (`toolAnnotations`). It says who may call it in `callers`, the
 * standard's `visibility`. And it always answers in text: `run` returns a
 * `text` that stands on its own, for a host without MCP Apps and for the
 * model, with optional `data` for the view.
 */
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps"
import { z } from "zod/v4"

/** Who may call a tool: the standard's `_meta.ui.visibility`. */
export type Caller = "model" | "app"

/**
 * What a tool changes. `read-only` changes nothing; `additive` only adds,
 * and never overwrites or removes; `destructive` may overwrite or remove, so
 * a host may ask the person first.
 */
export type Effects = "read-only" | "additive" | "destructive"

/** A view's URI. The standard requires the `ui://` scheme. */
export type ViewUri = `ui://${string}`

/** A value JSON can carry. */
export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** A view: one `ui://` resource of type `text/html;profile=mcp-app`. */
export interface ViewDefinition {
  readonly uri: ViewUri
  readonly name: string
  readonly title?: string
  readonly description?: string
  /** The view's HTML document, read when a host reads the resource. */
  readonly html: () => string | Promise<string>
  /** CSP domains, permissions, dedicated domain and border preference, as the standard defines them. */
  readonly ui?: McpUiResourceMeta
}

/** What a tool answers with: text that stands alone, and optional data for its view. */
export interface ToolOutcome {
  readonly text: string
  readonly data?: { readonly [key: string]: Json }
}

/** What a tool's `run` is given besides its input. */
export interface ToolCall {
  /** Aborted when the caller cancels the call. */
  readonly signal: AbortSignal
}

/** A tool, optionally with a view, as `defineTool` takes it. */
export interface ToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly input: Input
  readonly effects: Effects
  /** The `ui://` URI of a view this extension declares, which renders the tool's result. */
  readonly view?: ViewUri
  /** Who may call it. Defaults to the standard's `["model", "app"]`. */
  readonly callers?: readonly Caller[]
  /** Answers a call with what `input` parsed from the call's arguments. */
  readonly run: (
    input: z.output<Input>,
    call: ToolCall,
  ) => ToolOutcome | Promise<ToolOutcome>
}

declare const definedBrand: unique symbol

/**
 * A tool `defineTool` made. Its `run` takes any parsed input, so tools with
 * different inputs sit in one list; `defineTool` is what ties `run`'s input
 * to `input`, so a tool can be listed only through it.
 */
export interface Tool extends Omit<ToolDefinition, "run"> {
  readonly [definedBrand]: "tool"
  readonly run: (input: unknown, call: ToolCall) => ToolOutcome | Promise<ToolOutcome>
}

/** An extension's server, as `defineExtension` takes it. */
export interface ExtensionDefinition {
  readonly name: string
  readonly version: string
  readonly instructions?: string
  readonly views: readonly ViewDefinition[]
  readonly tools: readonly Tool[]
}

/** The JSON Schema a tool lists for its input. */
export type InputSchema = { readonly type: "object"; readonly [key: string]: unknown }

/** An extension `defineExtension` checked, with each tool's input already described as JSON Schema. */
export interface Extension extends ExtensionDefinition {
  readonly [definedBrand]: "extension"
  readonly inputSchemas: ReadonlyMap<string, InputSchema>
}

/** The standard's default visibility. */
export const defaultCallers: readonly Caller[] = ["model", "app"]

/** A definition that broke one of `defineExtension`'s rules. */
export class DefinitionError extends Error {
  override readonly name = "DefinitionError"
}

/** A tool, with `run`'s input typed from `input`. */
export function defineTool<Input extends z.ZodObject>(tool: ToolDefinition<Input>): Tool {
  // The brand is a type only; this is the one place a `Tool` is made.
  return tool as unknown as Tool
}

/**
 * Checks `definition` and makes it an `Extension`. Throws a
 * `DefinitionError` naming every rule it breaks:
 *
 * - a view's URI is `ui://` with a host, and unique; its name is not empty;
 * - each CSP domain is an origin: `http`, `https`, `ws` or `wss`, a host
 *   (`*.` may stand for one or more labels, above at least two), an optional
 *   port, and nothing else;
 * - a tool's name is unique and follows MCP's tool-name rule (1 to 128 of
 *   letters, digits, `_`, `-` and `.`);
 * - its `view` is one of the declared views;
 * - `callers` is non-empty, without repeats, of `"model"` and `"app"`, and
 *   a tool only the app may call needs a view to call it from;
 * - its `input` can be described as JSON Schema.
 */
export function defineExtension(definition: ExtensionDefinition): Extension {
  const inputSchemas = new Map<string, InputSchema>()
  const problems = [
    ...viewProblems(definition.views),
    ...toolProblems(definition, inputSchemas),
  ]
  if (problems.length > 0) {
    throw new DefinitionError(
      `${definition.name} is not a valid extension:\n- ${problems.join("\n- ")}`,
    )
  }
  // The brand is a type only; this is the one place an `Extension` is made.
  return { ...definition, inputSchemas } as unknown as Extension
}

/** The standard's annotations for `effects`. */
export function toolAnnotations(effects: Effects): {
  readOnlyHint: boolean
  destructiveHint: boolean
} {
  return {
    readOnlyHint: effects === "read-only",
    destructiveHint: effects === "destructive",
  }
}

function viewProblems(views: readonly ViewDefinition[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const view of views) {
    if (!isViewUri(view.uri)) {
      problems.push(`view ${JSON.stringify(view.uri)} is not a ui:// URI with a host`)
    }
    if (seen.has(view.uri)) problems.push(`view ${view.uri} is declared twice`)
    seen.add(view.uri)
    if (view.name.length === 0) problems.push(`view ${view.uri} has an empty name`)
    const csp = view.ui?.csp
    for (const key of [
      "connectDomains",
      "resourceDomains",
      "frameDomains",
      "baseUriDomains",
    ] as const) {
      for (const domain of csp?.[key] ?? []) {
        if (!isOrigin(domain)) {
          problems.push(
            `view ${view.uri}: csp.${key} ${JSON.stringify(domain)} is not an origin`,
          )
        }
      }
    }
  }
  return problems
}

/** MCP's rule for tool names (SEP-986). */
const toolName = /^[A-Za-z0-9_.-]{1,128}$/

function toolProblems(
  definition: ExtensionDefinition,
  inputSchemas: Map<string, InputSchema>,
): string[] {
  const problems: string[] = []
  const views = new Set(definition.views.map((view) => view.uri))
  const seen = new Set<string>()
  for (const tool of definition.tools) {
    const named = JSON.stringify(tool.name)
    if (!toolName.test(tool.name)) {
      problems.push(`tool ${named} is not 1 to 128 letters, digits, "_", "-" or "."`)
    }
    if (seen.has(tool.name)) problems.push(`tool ${named} is declared twice`)
    seen.add(tool.name)
    if (tool.view !== undefined && !views.has(tool.view)) {
      problems.push(`tool ${named} names view ${tool.view}, which is not declared`)
    }
    const callers = tool.callers ?? defaultCallers
    if (callers.length === 0) problems.push(`tool ${named} has no callers`)
    if (new Set(callers).size !== callers.length) {
      problems.push(`tool ${named} lists a caller twice`)
    }
    for (const caller of callers) {
      if (caller !== "model" && caller !== "app") {
        problems.push(`tool ${named} lists caller ${JSON.stringify(caller)}`)
      }
    }
    if (!callers.includes("model") && views.size === 0) {
      problems.push(`tool ${named} is only for the app, and the extension has no view`)
    }
    try {
      inputSchemas.set(
        tool.name,
        z.toJSONSchema(tool.input, { io: "input" }) as InputSchema,
      )
    } catch (error) {
      problems.push(
        `tool ${named} has an input JSON Schema cannot describe: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return problems
}

function isViewUri(uri: string): boolean {
  if (!uri.startsWith("ui://")) return false
  try {
    return new URL(uri).host.length > 0
  } catch {
    return false
  }
}

const cspSchemes: ReadonlySet<string> = new Set(["http:", "https:", "ws:", "wss:"])

/**
 * Whether `domain` is an origin a CSP source list can hold: `URL` reads it
 * back as exactly its own origin — so no path, query, fragment, credentials,
 * trailing dot or anything a CSP would read as another token — with an
 * allowed scheme. A leading `*.` stands for subdomains of a name with at
 * least two labels.
 */
function isOrigin(domain: string): boolean {
  const wildcard = /^([a-z]+:\/\/)\*\.(.+)$/i.exec(domain)
  const origin = wildcard ? `${wildcard[1]}${wildcard[2]}` : domain
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (!cspSchemes.has(url.protocol) || url.origin !== origin) return false
  if (!/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/i.test(url.hostname))
    return false
  return wildcard === null || url.hostname.split(".").length >= 2
}
