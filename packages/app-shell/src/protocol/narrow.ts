/**
 * Reading the other side's params into the types of `messages.ts`. Whatever
 * crosses `postMessage` is untrusted: a field is kept only when it has the
 * shape the standard gives it, read only if the object holds it itself
 * (`own`), and a closed set (a theme, a display mode, a style variable) is
 * narrowed by membership (`member`).
 *
 * A message whose required fields are missing or malformed is refused
 * (`Narrowed` with `ok: false`). Otherwise what is malformed is left out and
 * the rest kept (gate 7: degrade honestly). What is left out is listed by
 * path in `dropped`, so the receiver can report it, for:
 *
 * - a field read through `optional`: each field of a message, of the host
 *   context, of the host's capabilities, and of `styles`;
 * - an entry of a content array or a display-mode list, and a style variable.
 *
 * A member inside the other nested objects — a container dimension, a device
 * capability, a capability's own flags or domains, a content block's or a
 * tool's optional text, `hostInfo.title`, `toolInfo.id` — is left out
 * without being listed. `narrow.test.ts` holds both halves.
 */
import {
  displayModes,
  logLevels,
  platforms,
  styleVariables,
  themes,
  type CallToolResult,
  type ContentBlock,
  type DisplayMode,
  type HostCapabilities,
  type HostContext,
  type Implementation,
  type InitializeParams,
  type InitializeResult,
  type LogParams,
  type MessageParams,
  type ModelContextParams,
  type OpenAiMessageOptions,
  type OpenAiModelContext,
  type ReadResourceResult,
  type ResourceContents,
  type StyleVariable,
  type Tool,
} from "./messages.ts"

export type Narrowed<T> =
  { ok: true; value: T; dropped: string[] } | { ok: false; reason: string }

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * `record[key]`, only when `record` itself holds it: the one reader of a
 * field from the other side, so an inherited field is never read.
 */
export const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined

/** `value` narrowed into the closed set `set`, or undefined. */
export const member = <T extends string>(
  set: readonly T[],
  value: unknown,
): T | undefined => set.find((entry) => entry === value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const styleVariableSet: ReadonlySet<string> = new Set(styleVariables)
const isStyleVariable = (name: string): name is StyleVariable =>
  styleVariableSet.has(name)

/**
 * Copies the optional fields of `from` that pass `check` into `to`, and lists
 * the ones present but malformed in `dropped`, under `path`.
 */
function optional<T extends object, K extends keyof T & string>(
  to: T,
  from: Record<string, unknown>,
  key: K,
  read: (value: unknown, dropped: string[], path: string) => T[K] | undefined,
  dropped: string[],
  path: string,
): void {
  if (!Object.hasOwn(from, key)) return
  const value = read(from[key], dropped, `${path}${key}`)
  if (value === undefined) dropped.push(`${path}${key}`)
  else to[key] = value
}

const readString = (value: unknown) => (typeof value === "string" ? value : undefined)
const readBoolean = (value: unknown) => (typeof value === "boolean" ? value : undefined)
const readRecord = (value: unknown) => (isRecord(value) ? value : undefined)

function readImplementation(value: unknown): Implementation | undefined {
  if (!isRecord(value)) return undefined
  const name = own(value, "name")
  const version = own(value, "version")
  if (typeof name !== "string" || typeof version !== "string") return undefined
  const read: Implementation = { name, version }
  const title = own(value, "title")
  if (typeof title === "string") read.title = title
  return read
}

function readResourceContents(value: unknown): ResourceContents | undefined {
  if (!isRecord(value)) return undefined
  const uri = own(value, "uri")
  if (typeof uri !== "string") return undefined
  const text = own(value, "text")
  const blob = own(value, "blob")
  let read: ResourceContents
  if (typeof text === "string" && blob === undefined) read = { uri, text }
  else if (typeof blob === "string" && text === undefined) read = { uri, blob }
  else return undefined
  const mimeType = own(value, "mimeType")
  if (typeof mimeType === "string") read.mimeType = mimeType
  const meta = own(value, "_meta")
  if (isRecord(meta)) read._meta = meta
  return read
}

/** One content block, or undefined if it is not one of MCP's five. */
function readContentBlock(value: unknown): ContentBlock | undefined {
  if (!isRecord(value)) return undefined
  const meta = own(value, "_meta")
  const withMeta = <B extends ContentBlock>(block: B): B =>
    isRecord(meta) ? { ...block, _meta: meta } : block
  const type = own(value, "type")
  if (type === "text") {
    const text = own(value, "text")
    return typeof text === "string" ? withMeta({ type, text }) : undefined
  }
  if (type === "image" || type === "audio") {
    const data = own(value, "data")
    const mimeType = own(value, "mimeType")
    return typeof data === "string" && typeof mimeType === "string"
      ? withMeta({ type, data, mimeType })
      : undefined
  }
  if (type === "resource_link") {
    const uri = own(value, "uri")
    const name = own(value, "name")
    if (typeof uri !== "string" || typeof name !== "string") return undefined
    const block: ContentBlock = { type, uri, name }
    for (const key of ["title", "description", "mimeType"] as const) {
      const field = own(value, key)
      if (typeof field === "string") block[key] = field
    }
    return withMeta(block)
  }
  if (type === "resource") {
    const resource = readResourceContents(own(value, "resource"))
    return resource === undefined ? undefined : withMeta({ type, resource })
  }
  return undefined
}

/** A content array: the blocks that are well formed, the rest dropped. */
function readContent(value: unknown, dropped: string[], path: string) {
  if (!Array.isArray(value)) return undefined
  const blocks: ContentBlock[] = []
  value.forEach((entry, index) => {
    const block = readContentBlock(entry)
    if (block === undefined) dropped.push(`${path}[${index}]`)
    else blocks.push(block)
  })
  return blocks
}

function readDisplayModes(value: unknown, dropped: string[], path: string) {
  if (!Array.isArray(value)) return undefined
  const modes: DisplayMode[] = []
  value.forEach((entry, index) => {
    const mode = member(displayModes, entry)
    if (mode === undefined) dropped.push(`${path}[${index}]`)
    else if (!modes.includes(mode)) modes.push(mode)
  })
  return modes
}

function readStyleVariables(value: unknown, dropped: string[], path: string) {
  if (!isRecord(value)) return undefined
  const variables: Partial<Record<StyleVariable, string>> = {}
  for (const [name, entry] of Object.entries(value)) {
    if (isStyleVariable(name) && typeof entry === "string") variables[name] = entry
    else dropped.push(`${path}.${name}`)
  }
  return variables
}

function readStyles(value: unknown, dropped: string[], path: string) {
  if (!isRecord(value)) return undefined
  const styles: NonNullable<HostContext["styles"]> = {}
  optional(styles, value, "variables", readStyleVariables, dropped, `${path}.`)
  optional(
    styles,
    value,
    "css",
    (css, inner, at) => {
      if (!isRecord(css)) return undefined
      const read: { fonts?: string } = {}
      optional(read, css, "fonts", readString, inner, `${at}.`)
      return read
    },
    dropped,
    `${path}.`,
  )
  return styles
}

function readContainerDimensions(value: unknown) {
  if (!isRecord(value)) return undefined
  const height = own(value, "height")
  const maxHeight = own(value, "maxHeight")
  const width = own(value, "width")
  const maxWidth = own(value, "maxWidth")
  const vertical = isFiniteNumber(height)
    ? { height }
    : isFiniteNumber(maxHeight)
      ? { maxHeight }
      : {}
  const horizontal = isFiniteNumber(width)
    ? { width }
    : isFiniteNumber(maxWidth)
      ? { maxWidth }
      : {}
  return { ...vertical, ...horizontal }
}

function readTool(value: unknown): Tool | undefined {
  if (!isRecord(value)) return undefined
  const name = own(value, "name")
  const schema = own(value, "inputSchema")
  if (typeof name !== "string" || !isRecord(schema) || own(schema, "type") !== "object") {
    return undefined
  }
  const tool: Tool = { name, inputSchema: { ...schema, type: "object" } }
  for (const key of ["title", "description"] as const) {
    const field = own(value, key)
    if (typeof field === "string") tool[key] = field
  }
  const meta = own(value, "_meta")
  if (isRecord(meta)) tool._meta = meta
  return tool
}

function readToolInfo(value: unknown) {
  if (!isRecord(value)) return undefined
  const tool = readTool(own(value, "tool"))
  if (tool === undefined) return undefined
  const id = own(value, "id")
  return typeof id === "string" || isFiniteNumber(id) ? { id, tool } : { tool }
}

function readModelContext(
  value: unknown,
  dropped: string[],
  path: string,
): OpenAiModelContext | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const updateId = own(value, "updateId")
  if (typeof updateId !== "string" || updateId === "") return undefined
  const read: NonNullable<OpenAiModelContext> = { updateId }
  optional(read, value, "content", readContent, dropped, `${path}.`)
  optional(read, value, "structuredContent", readRecord, dropped, `${path}.`)
  return read
}

function readFlags(value: unknown) {
  if (!isRecord(value)) return undefined
  const read: { touch?: boolean; hover?: boolean } = {}
  for (const key of ["touch", "hover"] as const) {
    const flag = own(value, key)
    if (typeof flag === "boolean") read[key] = flag
  }
  return read
}

function readInsets(value: unknown) {
  if (!isRecord(value)) return undefined
  const top = own(value, "top")
  const right = own(value, "right")
  const bottom = own(value, "bottom")
  const left = own(value, "left")
  return isFiniteNumber(top) &&
    isFiniteNumber(right) &&
    isFiniteNumber(bottom) &&
    isFiniteNumber(left)
    ? { top, right, bottom, left }
    : undefined
}

/**
 * A host context, full (`ui/initialize`) or partial
 * (`ui/notifications/host-context-changed`). Fields outside the standard and
 * the typed `openai/*` ones are not kept.
 */
export function narrowHostContext(
  value: unknown,
  path = "hostContext",
): Narrowed<HostContext> {
  if (!isRecord(value)) return { ok: false, reason: `${path} is not an object` }
  const dropped: string[] = []
  const context: HostContext = {}
  const at = `${path}.`
  optional(context, value, "toolInfo", readToolInfo, dropped, at)
  optional(context, value, "theme", (v) => member(themes, v), dropped, at)
  optional(context, value, "styles", readStyles, dropped, at)
  optional(context, value, "displayMode", (v) => member(displayModes, v), dropped, at)
  optional(context, value, "availableDisplayModes", readDisplayModes, dropped, at)
  optional(context, value, "containerDimensions", readContainerDimensions, dropped, at)
  optional(context, value, "locale", readString, dropped, at)
  optional(context, value, "timeZone", readString, dropped, at)
  optional(context, value, "userAgent", readString, dropped, at)
  optional(context, value, "platform", (v) => member(platforms, v), dropped, at)
  optional(context, value, "deviceCapabilities", readFlags, dropped, at)
  optional(context, value, "safeAreaInsets", readInsets, dropped, at)
  optional(context, value, "openai/modelContext", readModelContext, dropped, at)
  return { ok: true, value: context, dropped }
}

const presence = (value: unknown) => (isRecord(value) ? {} : undefined)

function readListChanged(value: unknown) {
  if (!isRecord(value)) return undefined
  const listChanged = own(value, "listChanged")
  return typeof listChanged === "boolean" ? { listChanged } : {}
}

const permissionNames = ["camera", "microphone", "geolocation", "clipboardWrite"] as const
const cspNames = [
  "connectDomains",
  "resourceDomains",
  "frameDomains",
  "baseUriDomains",
] as const
const modalityNames = [
  "text",
  "image",
  "audio",
  "resource",
  "resourceLink",
  "structuredContent",
] as const

/** The names in `names` that `value` holds as objects: a set of flags. */
function readFlagSet<K extends string>(names: readonly K[], value: unknown) {
  if (!isRecord(value)) return undefined
  const read: Partial<Record<K, object>> = {}
  for (const name of names) if (isRecord(own(value, name))) read[name] = {}
  return read
}

function readDomains(value: unknown) {
  if (!isRecord(value)) return undefined
  const read: Partial<Record<(typeof cspNames)[number], string[]>> = {}
  for (const name of cspNames) {
    const domains = own(value, name)
    if (Array.isArray(domains)) {
      read[name] = domains.filter(
        (domain): domain is string => typeof domain === "string",
      )
    }
  }
  return read
}

function readSandbox(value: unknown) {
  if (!isRecord(value)) return undefined
  const read: NonNullable<HostCapabilities["sandbox"]> = {}
  const permissions = readFlagSet(permissionNames, own(value, "permissions"))
  if (permissions !== undefined) read.permissions = permissions
  const csp = readDomains(own(value, "csp"))
  if (csp !== undefined) read.csp = csp
  return read
}

function readExperimental(value: unknown) {
  if (!isRecord(value)) return undefined
  // Built from entries, not by assignment: a key the host names `__proto__`
  // stays an own key rather than setting the object's prototype.
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    ),
  )
}

const readModalities = (value: unknown) => readFlagSet(modalityNames, value)

/** Host capabilities: each known one kept when it has its shape. */
function narrowHostCapabilities(value: unknown, dropped: string[]): HostCapabilities {
  if (!isRecord(value)) {
    dropped.push("hostCapabilities")
    return {}
  }
  const capabilities: HostCapabilities = {}
  const at = "hostCapabilities."
  optional(capabilities, value, "experimental", readExperimental, dropped, at)
  optional(capabilities, value, "openLinks", presence, dropped, at)
  optional(capabilities, value, "serverTools", readListChanged, dropped, at)
  optional(capabilities, value, "serverResources", readListChanged, dropped, at)
  optional(capabilities, value, "logging", presence, dropped, at)
  optional(capabilities, value, "sandbox", readSandbox, dropped, at)
  optional(capabilities, value, "updateModelContext", readModalities, dropped, at)
  optional(capabilities, value, "message", readModalities, dropped, at)
  return capabilities
}

/** `ui/initialize`'s result. */
export function narrowInitializeResult(value: unknown): Narrowed<InitializeResult> {
  if (!isRecord(value)) return { ok: false, reason: "the result is not an object" }
  const protocolVersion = own(value, "protocolVersion")
  if (typeof protocolVersion !== "string") {
    return { ok: false, reason: "protocolVersion is not a string" }
  }
  const hostInfo = readImplementation(own(value, "hostInfo"))
  if (hostInfo === undefined) {
    return { ok: false, reason: "hostInfo has no name and version" }
  }
  const dropped: string[] = []
  const hostCapabilities = narrowHostCapabilities(own(value, "hostCapabilities"), dropped)
  let hostContext: HostContext = {}
  if (Object.hasOwn(value, "hostContext")) {
    const context = narrowHostContext(own(value, "hostContext"))
    if (context.ok) {
      hostContext = context.value
      dropped.push(...context.dropped)
    } else dropped.push("hostContext")
  }
  return {
    ok: true,
    value: { protocolVersion, hostInfo, hostCapabilities, hostContext },
    dropped,
  }
}

/** A tool's result: `tools/call`'s, and `ui/notifications/tool-result`'s params. */
export function narrowCallToolResult(value: unknown): Narrowed<CallToolResult> {
  if (!isRecord(value)) return { ok: false, reason: "the result is not an object" }
  const dropped: string[] = []
  const content = readContent(own(value, "content"), dropped, "content")
  if (content === undefined) return { ok: false, reason: "content is not an array" }
  const result: CallToolResult = { content }
  optional(result, value, "structuredContent", readRecord, dropped, "")
  optional(result, value, "isError", readBoolean, dropped, "")
  optional(result, value, "_meta", readRecord, dropped, "")
  return { ok: true, value: result, dropped }
}

/** `resources/read`'s result. */
export function narrowReadResourceResult(value: unknown): Narrowed<ReadResourceResult> {
  if (!isRecord(value)) return { ok: false, reason: "the result is not an object" }
  const contents = own(value, "contents")
  if (!Array.isArray(contents)) return { ok: false, reason: "contents is not an array" }
  const dropped: string[] = []
  const read: ResourceContents[] = []
  contents.forEach((entry, index) => {
    const item = readResourceContents(entry)
    if (item === undefined) dropped.push(`contents[${index}]`)
    else read.push(item)
  })
  const result: ReadResourceResult = { contents: read }
  optional(result, value, "_meta", readRecord, dropped, "")
  return { ok: true, value: result, dropped }
}

/** Tool arguments, full or partial. Absent arguments are none: `{}`. */
export function narrowToolArguments(
  value: unknown,
): Narrowed<{ arguments: Record<string, unknown> }> {
  if (value === undefined) return { ok: true, value: { arguments: {} }, dropped: [] }
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  const args = own(value, "arguments")
  if (args === undefined) return { ok: true, value: { arguments: {} }, dropped: [] }
  if (!isRecord(args)) return { ok: false, reason: "arguments is not an object" }
  return { ok: true, value: { arguments: args }, dropped: [] }
}

/** A reason, optional: `tool-cancelled`'s and `resource-teardown`'s params. */
export function narrowReason(value: unknown): Narrowed<{ reason?: string }> {
  if (value === undefined) return { ok: true, value: {}, dropped: [] }
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  const reason = own(value, "reason")
  if (reason === undefined) return { ok: true, value: {}, dropped: [] }
  if (typeof reason !== "string") return { ok: true, value: {}, dropped: ["reason"] }
  return { ok: true, value: { reason }, dropped: [] }
}

/** `ui/request-display-mode`'s result. */
export function narrowDisplayModeResult(value: unknown): Narrowed<{ mode: DisplayMode }> {
  if (!isRecord(value)) return { ok: false, reason: "the result is not an object" }
  const mode = member(displayModes, own(value, "mode"))
  if (mode === undefined) return { ok: false, reason: "mode is not a display mode" }
  return { ok: true, value: { mode }, dropped: [] }
}

/**
 * Whether a `ui/message` or `ui/open-link` result says the host refused:
 * the reference SDK answers a refusal with `isError: true` as well as with an
 * error response.
 */
export function narrowAcknowledgement(value: unknown): Narrowed<{ refused: boolean }> {
  if (!isRecord(value)) return { ok: false, reason: "the result is not an object" }
  return { ok: true, value: { refused: own(value, "isError") === true }, dropped: [] }
}

// ---------------------------------------------------------------------------
// What the app sends, read by a host (the fake host)

/** `ui/initialize`'s params. */
export function narrowInitializeParams(value: unknown): Narrowed<InitializeParams> {
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  const appInfo = readImplementation(own(value, "appInfo"))
  if (appInfo === undefined)
    return { ok: false, reason: "appInfo has no name and version" }
  const protocolVersion = own(value, "protocolVersion")
  if (typeof protocolVersion !== "string") {
    return { ok: false, reason: "protocolVersion is not a string" }
  }
  const capabilities = own(value, "appCapabilities")
  if (!isRecord(capabilities))
    return { ok: false, reason: "appCapabilities is not an object" }
  const dropped: string[] = []
  const appCapabilities: InitializeParams["appCapabilities"] = {}
  optional(
    appCapabilities,
    capabilities,
    "availableDisplayModes",
    readDisplayModes,
    dropped,
    "appCapabilities.",
  )
  return { ok: true, value: { appInfo, appCapabilities, protocolVersion }, dropped }
}

function readOpenAiMessageOptions(value: unknown): OpenAiMessageOptions | undefined {
  if (!isRecord(value)) return undefined
  const target = own(value, "target")
  const send = own(value, "send")
  if (send !== undefined && send !== true) return undefined
  const sending: { send?: true } = send === true ? { send } : {}
  if (target === "new") return { target, ...sending }
  if (target === "active") return { target, ...sending }
  if (target === undefined) return sending
  return undefined
}

/** `ui/message`'s params. */
export function narrowMessageParams(value: unknown): Narrowed<MessageParams> {
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  if (own(value, "role") !== "user") return { ok: false, reason: 'role is not "user"' }
  const dropped: string[] = []
  const content = readContent(own(value, "content"), dropped, "content")
  if (content === undefined) return { ok: false, reason: "content is not an array" }
  const params: MessageParams = { role: "user", content }
  const meta = own(value, "_meta")
  if (isRecord(meta) && Object.hasOwn(meta, "openai/message")) {
    const options = readOpenAiMessageOptions(own(meta, "openai/message"))
    if (options === undefined) dropped.push("_meta.openai/message")
    else params._meta = { "openai/message": options }
  }
  return { ok: true, value: params, dropped }
}

/** `notifications/message`'s params. */
export function narrowLogParams(value: unknown): Narrowed<LogParams> {
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  const level = member(logLevels, own(value, "level"))
  if (level === undefined) return { ok: false, reason: "level is not a log level" }
  if (!Object.hasOwn(value, "data")) return { ok: false, reason: "a log has no data" }
  const params: LogParams = { level, data: value.data }
  const logger = own(value, "logger")
  if (typeof logger === "string") params.logger = logger
  return { ok: true, value: params, dropped: [] }
}

/** `ui/update-model-context`'s params. */
export function narrowModelContextParams(value: unknown): Narrowed<ModelContextParams> {
  if (!isRecord(value)) return { ok: false, reason: "params is not an object" }
  const dropped: string[] = []
  const params: ModelContextParams = {}
  optional(params, value, "content", readContent, dropped, "")
  optional(params, value, "structuredContent", readRecord, dropped, "")
  return { ok: true, value: params, dropped }
}
