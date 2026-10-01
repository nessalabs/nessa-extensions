/**
 * The MCP Apps messages an app and its host exchange, as this package reads
 * and writes them: the `ui/*` bridge of SEP-1865, protocol version
 * `2026-01-26`, and the subset of MCP an app may send through it.
 *
 * The standard owns these shapes. Where its prose and its reference SDK
 * (`@modelcontextprotocol/ext-apps`) differ, the SDK's wire is followed — it is
 * what hosts run — and the difference is noted. `wire.test.ts` checks every
 * type here against the reference SDK's own, so a change there fails a test
 * here rather than drifting.
 *
 * `openai/*` fields are typed where they are optional additions; nothing here
 * requires one.
 */

/** The protocol version this package speaks, and the only one it accepts. */
export const PROTOCOL_VERSION = "2026-01-26"

/** The MIME type of an app's HTML resource. */
export const APP_MIME_TYPE = "text/html;profile=mcp-app"

export const displayModes = ["inline", "fullscreen", "pip"] as const
/** Where a host shows the app. */
export type DisplayMode = (typeof displayModes)[number]

export const themes = ["light", "dark"] as const
export type Theme = (typeof themes)[number]

export const platforms = ["web", "desktop", "mobile"] as const
export type Platform = (typeof platforms)[number]

/**
 * The standardized CSS variables a host may pass in
 * `hostContext.styles.variables`. A host passes any subset.
 */
export const styleVariables = [
  "--color-background-primary",
  "--color-background-secondary",
  "--color-background-tertiary",
  "--color-background-inverse",
  "--color-background-ghost",
  "--color-background-info",
  "--color-background-danger",
  "--color-background-success",
  "--color-background-warning",
  "--color-background-disabled",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-inverse",
  "--color-text-ghost",
  "--color-text-info",
  "--color-text-danger",
  "--color-text-success",
  "--color-text-warning",
  "--color-text-disabled",
  "--color-border-primary",
  "--color-border-secondary",
  "--color-border-tertiary",
  "--color-border-inverse",
  "--color-border-ghost",
  "--color-border-info",
  "--color-border-danger",
  "--color-border-success",
  "--color-border-warning",
  "--color-border-disabled",
  "--color-ring-primary",
  "--color-ring-secondary",
  "--color-ring-inverse",
  "--color-ring-info",
  "--color-ring-danger",
  "--color-ring-success",
  "--color-ring-warning",
  "--font-sans",
  "--font-mono",
  "--font-weight-normal",
  "--font-weight-medium",
  "--font-weight-semibold",
  "--font-weight-bold",
  "--font-text-xs-size",
  "--font-text-sm-size",
  "--font-text-md-size",
  "--font-text-lg-size",
  "--font-heading-xs-size",
  "--font-heading-sm-size",
  "--font-heading-md-size",
  "--font-heading-lg-size",
  "--font-heading-xl-size",
  "--font-heading-2xl-size",
  "--font-heading-3xl-size",
  "--font-text-xs-line-height",
  "--font-text-sm-line-height",
  "--font-text-md-line-height",
  "--font-text-lg-line-height",
  "--font-heading-xs-line-height",
  "--font-heading-sm-line-height",
  "--font-heading-md-line-height",
  "--font-heading-lg-line-height",
  "--font-heading-xl-line-height",
  "--font-heading-2xl-line-height",
  "--font-heading-3xl-line-height",
  "--border-radius-xs",
  "--border-radius-sm",
  "--border-radius-md",
  "--border-radius-lg",
  "--border-radius-xl",
  "--border-radius-full",
  "--border-width-regular",
  "--shadow-hairline",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
] as const
export type StyleVariable = (typeof styleVariables)[number]

/** A program's name and version: the app's `appInfo`, the host's `hostInfo`. */
export interface Implementation {
  name: string
  version: string
  title?: string
}

// ---------------------------------------------------------------------------
// MCP content, as tool results and messages carry it

export interface TextContent {
  type: "text"
  text: string
  _meta?: Record<string, unknown>
}
export interface ImageContent {
  type: "image"
  data: string
  mimeType: string
  _meta?: Record<string, unknown>
}
export interface AudioContent {
  type: "audio"
  data: string
  mimeType: string
  _meta?: Record<string, unknown>
}
export interface ResourceLink {
  type: "resource_link"
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  _meta?: Record<string, unknown>
}
export type ResourceContents =
  | { uri: string; mimeType?: string; text: string; _meta?: Record<string, unknown> }
  | { uri: string; mimeType?: string; blob: string; _meta?: Record<string, unknown> }
export interface EmbeddedResource {
  type: "resource"
  resource: ResourceContents
  _meta?: Record<string, unknown>
}
export type ContentBlock =
  TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource

/** What a tool returns: `tools/call`'s result, and `ui/notifications/tool-result`. */
export interface CallToolResult {
  content: ContentBlock[]
  structuredContent?: Record<string, unknown>
  /** The tool failed. Still a result: the tool ran and said so. */
  isError?: boolean
  _meta?: Record<string, unknown>
}

/** `resources/read`'s result. */
export interface ReadResourceResult {
  contents: ResourceContents[]
  _meta?: Record<string, unknown>
}

/** A tool as `tools/list` describes it; the host context's `toolInfo.tool`. */
export interface Tool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// The host context

export type ContainerDimensions = ({ height: number } | { maxHeight?: number }) &
  ({ width: number } | { maxWidth?: number })

/** `hostContext["openai/modelContext"]`: what the host holds of the app's model context. */
export type OpenAiModelContext = {
  updateId: string
  content?: ContentBlock[]
  structuredContent?: Record<string, unknown>
} | null

/**
 * What the host tells the app about where it is shown. Every field is
 * optional: a host passes what it has, and an app keeps its own default for
 * the rest.
 */
export interface HostContext {
  toolInfo?: { id?: string | number; tool: Tool }
  theme?: Theme
  styles?: {
    variables?: Partial<Record<StyleVariable, string>>
    css?: { fonts?: string }
  }
  displayMode?: DisplayMode
  availableDisplayModes?: DisplayMode[]
  containerDimensions?: ContainerDimensions
  locale?: string
  timeZone?: string
  userAgent?: string
  platform?: Platform
  deviceCapabilities?: { touch?: boolean; hover?: boolean }
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
  "openai/modelContext"?: OpenAiModelContext
}

// ---------------------------------------------------------------------------
// Capabilities

type Permissions = {
  camera?: object
  microphone?: object
  geolocation?: object
  clipboardWrite?: object
}
type Csp = {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}
type ContentModalities = {
  text?: object
  image?: object
  audio?: object
  resource?: object
  resourceLink?: object
  structuredContent?: object
}

/** What the host says it supports, in `ui/initialize`'s result. */
export interface HostCapabilities {
  experimental?: Record<string, object>
  openLinks?: object
  serverTools?: { listChanged?: boolean }
  serverResources?: { listChanged?: boolean }
  logging?: object
  sandbox?: { permissions?: Permissions; csp?: Csp }
  updateModelContext?: ContentModalities
  message?: ContentModalities
}

/** What the app says it supports, in `ui/initialize`. */
export interface AppCapabilities {
  availableDisplayModes?: DisplayMode[]
}

// ---------------------------------------------------------------------------
// Requests and notifications, by method

/** `ui/initialize`'s params. */
export interface InitializeParams {
  appInfo: Implementation
  appCapabilities: AppCapabilities
  protocolVersion: string
}

/** `ui/initialize`'s result. */
export interface InitializeResult {
  protocolVersion: string
  hostInfo: Implementation
  hostCapabilities: HostCapabilities
  hostContext: HostContext
}

/** `_meta["openai/message"]` on `ui/message`: where ChatGPT puts it. */
export type OpenAiMessageOptions =
  { target: "new"; send?: true } | { target?: "active"; send?: true }

/**
 * `ui/message`'s params. The standard's prose shows one content block; its
 * reference SDK and OpenAI's extension send an array, which is what hosts read.
 */
export interface MessageParams {
  role: "user"
  content: ContentBlock[]
  _meta?: { "openai/message"?: OpenAiMessageOptions }
}

/** `ui/update-model-context`'s params. */
export interface ModelContextParams {
  content?: ContentBlock[]
  structuredContent?: Record<string, unknown>
}

export const logLevels = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const

/** `notifications/message`'s params: a log line for the host. */
export interface LogParams {
  level: (typeof logLevels)[number]
  logger?: string
  data: unknown
}

/** `ui/notifications/size-changed`'s params. */
export interface SizeParams {
  width: number
  height: number
}

/** The requests an app sends, each with its params and the result it expects. */
export interface AppRequests {
  "ui/initialize": { params: InitializeParams; result: InitializeResult }
  "tools/call": {
    params: { name: string; arguments?: Record<string, unknown> }
    result: CallToolResult
  }
  "resources/read": { params: { uri: string }; result: ReadResourceResult }
  "ui/message": { params: MessageParams; result: { isError?: boolean } }
  "ui/update-model-context": { params: ModelContextParams; result: object }
  "ui/request-display-mode": {
    params: { mode: DisplayMode }
    result: { mode: DisplayMode }
  }
  "ui/open-link": { params: { url: string }; result: { isError?: boolean } }
  ping: { params: object; result: object }
}

/** The notifications an app sends. */
export interface AppNotifications {
  "ui/notifications/initialized": object
  "ui/notifications/size-changed": SizeParams
  "notifications/message": LogParams
}

/** The notifications a host sends, as the app reads them once checked. */
export interface HostNotifications {
  "ui/notifications/tool-input-partial": { arguments: Record<string, unknown> }
  "ui/notifications/tool-input": { arguments: Record<string, unknown> }
  "ui/notifications/tool-result": CallToolResult
  "ui/notifications/tool-cancelled": { reason?: string }
  "ui/notifications/host-context-changed": HostContext
}

/** The requests a host sends, which the app answers. */
export interface HostRequests {
  "ui/resource-teardown": { params: { reason?: string }; result: object }
  ping: { params: object; result: object }
}
