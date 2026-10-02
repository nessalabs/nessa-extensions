/**
 * What an extension declares: its views (`ui://` resources) and its tools,
 * checked once, when it is defined, so a server never starts with a tool
 * that names a view it does not serve.
 *
 * A tool says what it changes as one of three `effects`, not as two hints
 * that could disagree: `readOnlyHint` and `destructiveHint` are derived from
 * it (`toolAnnotations`). It says who may call it in `callers`, the
 * standard's `visibility`. And it always answers in text: `run` returns a
 * `text` that stands on its own, for a host without MCP Apps and for the
 * model, with optional `data` for the view.
 */
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps"
import type { z } from "zod/v4"

/** Who may call a tool: the standard's `_meta.ui.visibility`. */
export type Caller = "model" | "app"

/**
 * What a tool changes. `read-only` changes nothing; `additive` adds or
 * updates without losing anything; `destructive` may lose something, so a
 * host may ask the person first.
 */
export type Effects = "read-only" | "additive" | "destructive"

/** A view's URI. The standard requires the `ui://` scheme. */
export type ViewUri = `ui://${string}`

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
  readonly data?: Record<string, unknown>
}

/** What a tool's `run` is given besides its input. */
export interface ToolCall {
  /** Aborted when the caller cancels the call. */
  readonly signal: AbortSignal
}

/** A tool, optionally with a view. */
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
  /**
   * Answers a call with input that already passed `input`. Method syntax on
   * purpose: it lets a tool with a narrower input sit in `tools` beside the
   * others, and `server.ts` only ever calls it with what `input` parsed.
   */
  run(input: z.output<Input>, call: ToolCall): ToolOutcome | Promise<ToolOutcome>
}

/** An extension's server: its identity, views and tools. */
export interface ExtensionDefinition {
  readonly name: string
  readonly version: string
  readonly instructions?: string
  readonly views: readonly ViewDefinition[]
  readonly tools: readonly ToolDefinition[]
}

/** The standard's default visibility. */
export const defaultCallers: readonly Caller[] = ["model", "app"]

/** A definition that broke one of `defineExtension`'s rules. */
export class DefinitionError extends Error {
  override readonly name = "DefinitionError"
}

/**
 * Checks `definition` and returns it unchanged. Throws a `DefinitionError`
 * naming every rule it breaks:
 *
 * - view URIs use `ui://` with a host, and are unique;
 * - tool names are unique and non-empty;
 * - a tool's `view` is one of the declared views;
 * - `callers` is non-empty, without repeats, of `"model"` and `"app"`;
 * - each CSP domain is an origin: a scheme and a host (a leading `*.` is
 *   allowed), with no path, query or fragment.
 */
export function defineExtension<const Definition extends ExtensionDefinition>(
  definition: Definition,
): Definition {
  const problems = [...viewProblems(definition.views), ...toolProblems(definition)]
  if (problems.length > 0) {
    throw new DefinitionError(
      `${definition.name} is not a valid extension:\n- ${problems.join("\n- ")}`,
    )
  }
  return definition
}

/** A tool, with `run`'s input typed from `input`. Returns it unchanged. */
export function defineTool<Input extends z.ZodObject>(
  tool: ToolDefinition<Input>,
): ToolDefinition<Input> {
  return tool
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

function toolProblems(definition: ExtensionDefinition): string[] {
  const problems: string[] = []
  const views = new Set(definition.views.map((view) => view.uri))
  const seen = new Set<string>()
  for (const tool of definition.tools) {
    if (tool.name.length === 0) problems.push("a tool has an empty name")
    if (seen.has(tool.name)) problems.push(`tool ${tool.name} is declared twice`)
    seen.add(tool.name)
    if (tool.view !== undefined && !views.has(tool.view)) {
      problems.push(`tool ${tool.name} names view ${tool.view}, which is not declared`)
    }
    const callers = tool.callers ?? defaultCallers
    if (callers.length === 0) problems.push(`tool ${tool.name} has no callers`)
    if (new Set(callers).size !== callers.length) {
      problems.push(`tool ${tool.name} lists a caller twice`)
    }
    for (const caller of callers) {
      if (caller !== "model" && caller !== "app") {
        problems.push(`tool ${tool.name} lists caller ${JSON.stringify(caller)}`)
      }
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

/**
 * A scheme and a host, optionally `*.`-prefixed, with an optional port, and
 * nothing else: the pattern refuses a path, query, fragment or credentials,
 * and `URL` refuses a host it cannot parse.
 */
function isOrigin(domain: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([^/?#@\\]+)$/i.exec(domain)
  if (!match) return false
  try {
    return new URL(`${match[1]}://${match[3]}`).host.length > 0
  } catch {
    return false
  }
}
