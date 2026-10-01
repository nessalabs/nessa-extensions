/**
 * A host that plays MCP Apps' message sequence and nothing more, so an app is
 * tested without a real one: in unit tests over a `memoryChannel`, and in a
 * browser, Storybook, or Playwright through `mountFakeHostFrame`.
 *
 * It answers `ui/initialize` with the context and capabilities it was given;
 * once the app sends `ui/notifications/initialized` it plays the tool call
 * (partial inputs, the input, then the result or cancellation, if given); and
 * it answers the app's requests through handlers a test replaces, any of
 * which may refuse by throwing a `HostRefusal`. It records every message both
 * ways, and every way the app breaks the standard, for a test to assert on.
 *
 * It holds itself to the standard as a host: it sends the app nothing before
 * `initialized` (`FakeHostMisuse` if a test tries), and it refuses a
 * `tools/call` or `resources/read` before then.
 */
import {
  errorCodes,
  readEnvelope,
  type JsonRpcMessage,
  type RequestId,
} from "../protocol/json-rpc.ts"
import {
  PROTOCOL_VERSION,
  type AppCapabilities,
  type CallToolResult,
  type DisplayMode,
  type HostCapabilities,
  type HostContext,
  type Implementation,
  type InitializeParams,
  type LogParams,
  type MessageParams,
  type ModelContextParams,
  type ReadResourceResult,
  type SizeParams,
} from "../protocol/messages.ts"
import {
  isRecord,
  narrowInitializeParams,
  narrowLogParams,
  narrowMessageParams,
  narrowModelContextParams,
} from "../protocol/narrow.ts"
import type { Transport } from "../protocol/transport.ts"
import { displayModes } from "../protocol/messages.ts"

/** Thrown by a handler to refuse the app's request with a JSON-RPC error. */
export class HostRefusal extends Error {
  readonly code: number
  constructor(message: string, code: number = errorCodes.refused) {
    super(message)
    this.name = "HostRefusal"
    this.code = code
  }
}

/** Thrown when a test asks the fake host to do what a host must not. */
export class FakeHostMisuse extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FakeHostMisuse"
  }
}

type Answer<T> = T | Promise<T>

/** How the fake host answers the app's requests. Each may throw a `HostRefusal`. */
export interface FakeHostHandlers {
  callTool(params: {
    name: string
    arguments?: Record<string, unknown>
  }): Answer<CallToolResult>
  readResource(params: { uri: string }): Answer<ReadResourceResult>
  message(params: MessageParams): Answer<void>
  updateModelContext(params: ModelContextParams): Answer<void>
  openLink(params: { url: string }): Answer<void>
  /** The mode the host shows the app in after the request: the one asked for, or not. */
  requestDisplayMode(params: { mode: DisplayMode }): Answer<DisplayMode>
}

/** The tool call the fake host plays once the app is initialized. */
export interface FakeToolCall {
  partials?: Record<string, unknown>[]
  input: Record<string, unknown>
  /** How it ends; left out, the test ends it with `sendToolResult` or `cancelTool`. */
  outcome?: { result: CallToolResult } | { cancelled: string | undefined }
}

export interface FakeHostOptions {
  transport: Transport
  hostInfo?: Implementation
  capabilities?: HostCapabilities
  context?: HostContext
  tool?: FakeToolCall
  handlers?: Partial<FakeHostHandlers>
  /** The protocol version it answers with; the standard's unless a test says otherwise. */
  protocolVersion?: string
  /** Called with each size the app reports, as a host resizes its iframe. */
  onSize?: (size: SizeParams) => void
}

/** A way the app broke the standard, as the fake host saw it. */
export type AppViolation =
  | { kind: "invalid-message"; reason: string }
  | { kind: "before-initialized"; method: string }
  | { kind: "malformed-params"; method: string; reason: string }
  | { kind: "unknown-method"; method: string }
  | { kind: "undeclared-display-mode"; mode: DisplayMode }
  | { kind: "after-teardown"; method: string }
  | { kind: "repeated-initialize" }

export interface LoggedMessage {
  direction: "app-to-host" | "host-to-app"
  message: unknown
}

export type FakeHostStage = "waiting" | "initializing" | "initialized" | "torn-down"

export interface FakeHost {
  readonly stage: FakeHostStage
  /** Resolves when the app sends `ui/notifications/initialized`. */
  readonly initialized: Promise<void>
  /** What the app said of itself in `ui/initialize`. */
  readonly app: { info: Implementation; capabilities: AppCapabilities } | undefined
  /** The context as the host holds it, with every change it sent. */
  readonly context: HostContext
  readonly log: readonly LoggedMessage[]
  readonly violations: readonly AppViolation[]
  readonly sizes: readonly SizeParams[]
  readonly logs: readonly LogParams[]
  readonly messages: readonly MessageParams[]
  readonly links: readonly string[]
  /** The model context the app last set, if any. */
  readonly modelContext: ModelContextParams | undefined
  sendToolInputPartial(args: Record<string, unknown>): void
  sendToolInput(args: Record<string, unknown>): void
  sendToolResult(result: CallToolResult): void
  cancelTool(reason?: string): void
  /** Merges `change` into the context and sends it (`host-context-changed`). */
  changeContext(change: HostContext): void
  /** `ui/resource-teardown`; resolves with the app's answer. */
  teardown(
    reason?: string,
  ): Promise<{ ok: true } | { ok: false; code: number; message: string }>
  /** `ping`; resolves when the app answers. */
  ping(): Promise<void>
  close(): void
}

const defaultCapabilities: HostCapabilities = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  updateModelContext: { text: {}, structuredContent: {} },
  message: { text: {} },
}

const appRequestMethods = [
  "ui/initialize",
  "tools/call",
  "resources/read",
  "ui/message",
  "ui/update-model-context",
  "ui/request-display-mode",
  "ui/open-link",
  "ping",
] as const

export function createFakeHost(options: FakeHostOptions): FakeHost {
  const { transport } = options
  const capabilities = options.capabilities ?? defaultCapabilities
  let context: HostContext = {
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    ...options.context,
  }
  let stage: FakeHostStage = "waiting"
  let app: FakeHost["app"]
  let modelContext: ModelContextParams | undefined
  const log: LoggedMessage[] = []
  const violations: AppViolation[] = []
  const sizes: SizeParams[] = []
  const logs: LogParams[] = []
  const messages: MessageParams[] = []
  const links: string[] = []
  const answers = new Map<
    RequestId,
    (outcome: { result: unknown } | { error: { code: number; message: string } }) => void
  >()
  let nextId = 1
  let markInitialized: () => void = () => {}
  const initialized = new Promise<void>((resolve) => {
    markInitialized = resolve
  })

  const handlers: FakeHostHandlers = {
    callTool: () => {
      throw new HostRefusal(
        "the fake host has no server to call",
        errorCodes.methodNotFound,
      )
    },
    readResource: () => {
      throw new HostRefusal(
        "the fake host has no server to read",
        errorCodes.methodNotFound,
      )
    },
    message: (params) => {
      messages.push(params)
    },
    updateModelContext: (params) => {
      modelContext = params
    },
    openLink: ({ url }) => {
      links.push(url)
    },
    requestDisplayMode: ({ mode }) => {
      const offered = context.availableDisplayModes ?? []
      const declared = app?.capabilities.availableDisplayModes ?? []
      if (!offered.includes(mode) || !declared.includes(mode)) {
        return context.displayMode ?? "inline"
      }
      if (context.displayMode !== mode) changeContext({ displayMode: mode })
      return mode
    },
    ...options.handlers,
  }

  const send = (message: JsonRpcMessage) => {
    log.push({ direction: "host-to-app", message })
    transport.send(message)
  }

  const requireInitialized = (what: string) => {
    if (stage !== "initialized") {
      throw new FakeHostMisuse(`${what} before the app is initialized (stage: ${stage})`)
    }
  }

  const notify = (method: string, params: object) => {
    requireInitialized(method)
    send({ jsonrpc: "2.0", method, params })
  }

  function changeContext(change: HostContext) {
    context = { ...context, ...change }
    notify("ui/notifications/host-context-changed", change)
  }

  function playTool(tool: FakeToolCall) {
    for (const partial of tool.partials ?? []) {
      notify("ui/notifications/tool-input-partial", { arguments: partial })
    }
    notify("ui/notifications/tool-input", { arguments: tool.input })
    if (tool.outcome === undefined) return
    if ("result" in tool.outcome)
      notify("ui/notifications/tool-result", tool.outcome.result)
    else {
      const reason = tool.outcome.cancelled
      notify("ui/notifications/tool-cancelled", reason === undefined ? {} : { reason })
    }
  }

  const answer = (id: RequestId, run: () => Answer<unknown>) => {
    Promise.resolve()
      .then(run)
      .then(
        (result) => send({ jsonrpc: "2.0", id, result: result ?? {} }),
        (error: unknown) => {
          const refusal =
            error instanceof HostRefusal
              ? { code: error.code, message: error.message }
              : { code: errorCodes.refused, message: String(error) }
          send({ jsonrpc: "2.0", id, error: refusal })
        },
      )
  }

  const refuse = (id: RequestId, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } })

  function onInitialize(id: RequestId, params: unknown) {
    if (stage !== "waiting") {
      violations.push({ kind: "repeated-initialize" })
      refuse(id, errorCodes.refused, "ui/initialize was already answered")
      return
    }
    const read = narrowInitializeParams(params)
    if (!read.ok) {
      violations.push({
        kind: "malformed-params",
        method: "ui/initialize",
        reason: read.reason,
      })
      refuse(id, errorCodes.invalidParams, read.reason)
      return
    }
    const value: InitializeParams = read.value
    app = { info: value.appInfo, capabilities: value.appCapabilities }
    stage = "initializing"
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
        hostInfo: options.hostInfo ?? { name: "nessa-fake-host", version: "0.0.0" },
        hostCapabilities: capabilities,
        hostContext: context,
      },
    })
  }

  function stringField(params: unknown, key: string): string | undefined {
    if (!isRecord(params) || !Object.hasOwn(params, key)) return undefined
    const value = params[key]
    return typeof value === "string" ? value : undefined
  }

  function onRequest(id: RequestId, method: string, params: unknown) {
    if (stage === "torn-down") violations.push({ kind: "after-teardown", method })
    if (method === "ui/initialize") return onInitialize(id, params)
    if (method === "ping") return answer(id, () => ({}))
    if (!appRequestMethods.some((known) => known === method)) {
      violations.push({ kind: "unknown-method", method })
      return refuse(
        id,
        errorCodes.methodNotFound,
        `the fake host does not answer ${method}`,
      )
    }
    if (stage === "waiting" || stage === "initializing") {
      violations.push({ kind: "before-initialized", method })
      return refuse(
        id,
        errorCodes.refused,
        `${method} before ui/notifications/initialized`,
      )
    }
    const malformed = (reason: string) => {
      violations.push({ kind: "malformed-params", method, reason })
      refuse(id, errorCodes.invalidParams, reason)
    }
    switch (method) {
      case "tools/call": {
        const name = stringField(params, "name")
        if (name === undefined) return malformed("name is not a string")
        const args =
          isRecord(params) && isRecord(params.arguments) ? params.arguments : undefined
        return answer(id, () =>
          handlers.callTool(args === undefined ? { name } : { name, arguments: args }),
        )
      }
      case "resources/read": {
        const uri = stringField(params, "uri")
        if (uri === undefined) return malformed("uri is not a string")
        return answer(id, () => handlers.readResource({ uri }))
      }
      case "ui/message": {
        const read = narrowMessageParams(params)
        if (!read.ok) return malformed(read.reason)
        return answer(id, () => handlers.message(read.value))
      }
      case "ui/update-model-context": {
        const read = narrowModelContextParams(params)
        if (!read.ok) return malformed(read.reason)
        return answer(id, () => handlers.updateModelContext(read.value))
      }
      case "ui/open-link": {
        const url = stringField(params, "url")
        if (url === undefined) return malformed("url is not a string")
        return answer(id, () => handlers.openLink({ url }))
      }
      case "ui/request-display-mode": {
        const mode = displayModes.find((entry) => entry === stringField(params, "mode"))
        if (mode === undefined) return malformed("mode is not a display mode")
        if (!(app?.capabilities.availableDisplayModes ?? []).includes(mode)) {
          violations.push({ kind: "undeclared-display-mode", mode })
        }
        return answer(id, async () => ({
          mode: await handlers.requestDisplayMode({ mode }),
        }))
      }
    }
  }

  function onNotification(method: string, params: unknown) {
    if (stage === "torn-down") violations.push({ kind: "after-teardown", method })
    if (method === "ui/notifications/initialized") {
      if (stage !== "initializing") {
        violations.push({ kind: "before-initialized", method })
        return
      }
      stage = "initialized"
      markInitialized()
      if (options.tool !== undefined) playTool(options.tool)
      return
    }
    if (stage === "waiting" || stage === "initializing") {
      violations.push({ kind: "before-initialized", method })
      return
    }
    if (method === "ui/notifications/size-changed") {
      const width = isRecord(params) ? params.width : undefined
      const height = isRecord(params) ? params.height : undefined
      if (typeof width !== "number" || typeof height !== "number") {
        violations.push({
          kind: "malformed-params",
          method,
          reason: "width and height are not numbers",
        })
        return
      }
      sizes.push({ width, height })
      options.onSize?.({ width, height })
      return
    }
    if (method === "notifications/message") {
      const read = narrowLogParams(params)
      if (!read.ok) {
        violations.push({ kind: "malformed-params", method, reason: read.reason })
        return
      }
      logs.push(read.value)
      return
    }
    violations.push({ kind: "unknown-method", method })
  }

  const stopListening = transport.listen((data) => {
    log.push({ direction: "app-to-host", message: data })
    const envelope = readEnvelope(data)
    switch (envelope.kind) {
      case "invalid":
        violations.push({ kind: "invalid-message", reason: envelope.reason })
        return
      case "request":
        onRequest(envelope.id, envelope.method, envelope.params)
        return
      case "notification":
        onNotification(envelope.method, envelope.params)
        return
      case "result":
      case "error": {
        const settle = answers.get(envelope.id)
        answers.delete(envelope.id)
        settle?.(
          envelope.kind === "result"
            ? { result: envelope.result }
            : { error: envelope.error },
        )
        return
      }
    }
  })

  function hostRequest(method: string, params: object) {
    requireInitialized(method)
    const id = `host-${nextId++}`
    return new Promise<
      { result: unknown } | { error: { code: number; message: string } }
    >((resolve) => {
      answers.set(id, resolve)
      send({ jsonrpc: "2.0", id, method, params })
    })
  }

  return {
    get stage() {
      return stage
    },
    initialized,
    get app() {
      return app
    },
    get context() {
      return context
    },
    log,
    violations,
    sizes,
    logs,
    messages,
    links,
    get modelContext() {
      return modelContext
    },
    sendToolInputPartial: (args) =>
      notify("ui/notifications/tool-input-partial", { arguments: args }),
    sendToolInput: (args) => notify("ui/notifications/tool-input", { arguments: args }),
    sendToolResult: (result) => notify("ui/notifications/tool-result", result),
    cancelTool: (reason) =>
      notify("ui/notifications/tool-cancelled", reason === undefined ? {} : { reason }),
    changeContext,
    async teardown(reason) {
      const outcome = await hostRequest(
        "ui/resource-teardown",
        reason === undefined ? {} : { reason },
      )
      stage = "torn-down"
      return "result" in outcome
        ? { ok: true }
        : { ok: false, code: outcome.error.code, message: outcome.error.message }
    },
    async ping() {
      await hostRequest("ping", {})
    },
    close: () => stopListening(),
  }
}
