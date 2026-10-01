/**
 * The app's side of the MCP Apps bridge: one connection to the host that
 * renders it, over a `Transport`.
 *
 * It owns the connection's lifecycle — the table "The connection" in this
 * package's README, one test per row in `bridge.test.ts` — and the state an
 * app renders from: the connection, the host context, and the tool call. It
 * publishes that state as an immutable snapshot (`getState`, `subscribe`), the
 * shape `useSyncExternalStore` reads.
 *
 * ```
 *   app code ──calls──▶ Bridge ──send──▶ Transport ──postMessage──▶ host
 *   app code ◀─state──  Bridge ◀─listen─ Transport ◀──────────────  host
 * ```
 *
 * The host decides what it allows. The bridge refuses a call itself only where
 * the standard makes the app check first: a display mode the app did not
 * declare or the host does not offer. Every other refusal is the host's, and
 * reaches the caller as a `BridgeError`.
 */
import {
  errorCodes,
  readEnvelope,
  type JsonRpcMessage,
  type RequestId,
} from "../protocol/json-rpc.ts"
import {
  PROTOCOL_VERSION,
  type CallToolResult,
  type ContentBlock,
  type DisplayMode,
  type HostCapabilities,
  type HostContext,
  type Implementation,
  type LogParams,
  type ModelContextParams,
  type OpenAiMessageOptions,
  type ReadResourceResult,
  type SizeParams,
} from "../protocol/messages.ts"
import {
  narrowAcknowledgement,
  narrowCallToolResult,
  narrowDisplayModeResult,
  narrowHostContext,
  narrowInitializeResult,
  narrowReadResourceResult,
  narrowReason,
  narrowToolArguments,
  type Narrowed,
} from "../protocol/narrow.ts"
import type { Transport } from "../protocol/transport.ts"
import {
  BridgeError,
  type BridgeFailure,
  type ConnectionStatus,
  type HostViolation,
} from "./failures.ts"
import { nextToolCall, type ToolCall, type ToolEvent } from "./tool-call.ts"

/** Where the connection stands, with what each stage knows. */
export type Connection =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected"; host: Implementation; capabilities: HostCapabilities }
  /**
   * The host asked to tear the app down and its teardown handlers are
   * running. `opened` is the connection it was in, when it had connected;
   * absent when the host tore it down before (while idle or connecting).
   */
  | {
      status: "tearing-down"
      opened?: { host: Implementation; capabilities: HostCapabilities }
      reason?: string
    }
  | { status: "torn-down"; reason?: string }
  | { status: "failed"; failure: BridgeFailure }
  | { status: "closed" }

/**
 * Whether a connection carries the app's calls: connected, or tearing down
 * one that had connected (when the app may still save through the host
 * before it goes).
 */
export const isOpen = (connection: Connection): boolean =>
  connection.status === "connected" ||
  (connection.status === "tearing-down" && connection.opened !== undefined)

/** Everything an app renders from. Replaced, never changed in place. */
export interface BridgeState {
  readonly connection: Connection
  /** The host context so far: `{}` until connected, then merged with each change. */
  readonly hostContext: HostContext
  readonly toolCall: ToolCall
}

export interface BridgeOptions {
  transport: Transport
  /** The app's name and version, sent in `ui/initialize`. */
  app: Implementation
  /**
   * The display modes the app supports, declared in `ui/initialize`. The
   * standard has the app declare every mode it supports; `inline` alone if
   * not given.
   */
  displayModes?: DisplayMode[]
  /** Where host violations are reported. By default, `console.warn`. */
  onViolation?: (violation: HostViolation) => void
}

/**
 * A call's options: a signal that abandons waiting for the host's answer.
 * Aborting is the app's alone: the host is not told — the standard gives an
 * app no cancellation to send — so a `tools/call` it already forwarded may
 * still run. The id is kept, so a late answer to it is not reported.
 */
export interface CallOptions {
  signal?: AbortSignal
}

export interface Bridge {
  /** The current state. */
  getState(): BridgeState
  /** Calls `listener` after each change of state; returns what unsubscribes it. */
  subscribe(listener: () => void): () => void
  /**
   * Opens the connection: `ui/initialize`, then
   * `ui/notifications/initialized`. Resolves when connected; rejects with the
   * failure the connection ended in. Called again, it returns the same
   * promise: a bridge connects once.
   */
  connect(options?: CallOptions): Promise<void>
  /** `tools/call` on the app's own server, through the host. */
  callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<CallToolResult>
  /** `resources/read` on the app's own server, through the host. */
  readResource(uri: string, options?: CallOptions): Promise<ReadResourceResult>
  /** `ui/message`: adds a user message to the conversation. */
  sendMessage(
    content: ContentBlock[],
    options?: CallOptions & { openai?: OpenAiMessageOptions },
  ): Promise<void>
  /** `ui/update-model-context`: replaces what the app has told the model. */
  updateModelContext(context: ModelContextParams, options?: CallOptions): Promise<void>
  /** `ui/request-display-mode`: resolves to the mode the host chose, which may differ. */
  requestDisplayMode(mode: DisplayMode, options?: CallOptions): Promise<DisplayMode>
  /** `ui/open-link`: asks the host to open `url`. */
  openLink(url: string, options?: CallOptions): Promise<void>
  /** `notifications/message`: a log line for the host. */
  log(params: LogParams): void
  /** `ui/notifications/size-changed`, when the size differs from the last one sent. */
  reportSize(size: SizeParams): void
  /**
   * Runs `handler` when the host tears the app down, before the bridge
   * answers it; the app may still call the host meanwhile. Returns what
   * removes it.
   */
  onTeardown(handler: (reason: string | undefined) => void | Promise<void>): () => void
  /** Stops listening, and rejects every unanswered call with `closed`. */
  close(): void
}

interface Pending {
  method: string
  resolve: (result: unknown) => void
  reject: (failure: BridgeFailure) => void
}

const warn = (violation: HostViolation) =>
  console.warn("[app-shell] the host broke MCP Apps:", violation)

/** The notifications the bridge reads, and the tool event each one is. */
const toolNotifications = {
  "ui/notifications/tool-input-partial": "input-partial",
  "ui/notifications/tool-input": "input",
  "ui/notifications/tool-result": "result",
  "ui/notifications/tool-cancelled": "cancelled",
} as const
type ToolNotification = keyof typeof toolNotifications
const isToolNotification = (method: string): method is ToolNotification =>
  Object.hasOwn(toolNotifications, method)

export function createBridge(options: BridgeOptions): Bridge {
  const { transport } = options
  const declaredModes: DisplayMode[] = options.displayModes ?? ["inline"]
  const report = options.onViolation ?? warn

  let state: BridgeState = {
    connection: { status: "idle" },
    hostContext: {},
    toolCall: { phase: "awaiting-input" },
  }
  const listeners = new Set<() => void>()
  const pending = new Map<RequestId, Pending>()
  const teardownHandlers = new Set<(reason: string | undefined) => void | Promise<void>>()
  let nextId = 1
  /**
   * What `connect()` returned, and how to settle it. The connection's state
   * is the one owner of how connecting ended: `settleConnect` reads it after
   * every change, and nothing else settles the promise.
   */
  let connecting: {
    promise: Promise<void>
    resolve: () => void
    reject: (failure: BridgeFailure) => void
  } | null = null
  const settleConnect = () => {
    if (connecting === null) return
    const connection = state.connection
    const method = "ui/initialize"
    switch (connection.status) {
      case "connected":
        return connecting.resolve()
      case "failed":
        return connecting.reject(connection.failure)
      case "closed":
        return connecting.reject({ kind: "closed", method })
      case "torn-down":
        return connecting.reject({ kind: "torn-down", method })
      case "tearing-down":
        // Torn down from connected: connect had resolved; from before, it
        // settles when the teardown ends, as `torn-down`.
        return
      case "idle":
      case "connecting":
        return
    }
  }
  let teardown: Promise<void> | null = null
  let lastSize: SizeParams | null = null

  /**
   * Replaces the state. Subscribers are told after the transition, not
   * during it: once, on a microtask, however many updates it made. So a
   * subscriber that calls back into the bridge — `close()` on hearing
   * "connecting", `connect()` again — finds every transition complete, and
   * one that throws is logged without stopping the others or the bridge.
   */
  let telling = false
  const update = (next: Partial<BridgeState>) => {
    state = { ...state, ...next }
    settleConnect()
    if (telling) return
    telling = true
    queueMicrotask(() => {
      telling = false
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          console.error("[app-shell] a bridge subscriber threw:", error)
        }
      }
    })
  }
  const status = (): ConnectionStatus => state.connection.status
  const open = () => isOpen(state.connection)

  /**
   * Ids whose calls were settled here before the host answered — aborted,
   * closed, torn down — so a late answer to one is expected and not reported.
   */
  const abandoned = new Set<RequestId>()

  const settleAll = (failure: (method: string) => BridgeFailure) => {
    const unanswered = [...pending.entries()]
    pending.clear()
    for (const [id, call] of unanswered) {
      abandoned.add(id)
      call.reject(failure(call.method))
    }
  }

  /** Sends, or says why it could not as the typed failure `not-sent`. */
  const send = (message: JsonRpcMessage, method: string): BridgeFailure | null => {
    try {
      transport.send(message)
      return null
    } catch (error) {
      return {
        kind: "not-sent",
        method,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
  /** Sends an answer to the host; if it cannot be sent there is no one to tell. */
  const answer = (message: JsonRpcMessage) => {
    const failure = send(message, "answer")
    if (failure !== null) console.error("[app-shell] could not answer the host:", failure)
  }

  /**
   * Sends a request and resolves with its result, read by `narrow`. Refused
   * at once unless `allowed`, which is whether the connection carries it.
   */
  function request<T>(
    method: string,
    params: object,
    narrow: (result: unknown) => Narrowed<T>,
    { signal }: CallOptions = {},
    allowed = open(),
  ): Promise<T> {
    if (!allowed) {
      return Promise.reject(
        new BridgeError({ kind: "not-connected", method, status: status() }),
      )
    }
    if (signal?.aborted)
      return Promise.reject(new BridgeError({ kind: "aborted", method }))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (pending.delete(id)) {
          abandoned.add(id)
          reject(new BridgeError({ kind: "aborted", method }))
        }
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      pending.set(id, {
        method,
        resolve: (result) => {
          signal?.removeEventListener("abort", onAbort)
          const read = narrow(result)
          if (!read.ok) {
            reject(
              new BridgeError({ kind: "malformed-result", method, reason: read.reason }),
            )
            return
          }
          if (read.dropped.length > 0) {
            report({ kind: "dropped-fields", method, fields: read.dropped })
          }
          resolve(read.value)
        },
        reject: (failure) => {
          signal?.removeEventListener("abort", onAbort)
          reject(new BridgeError(failure))
        },
      })
      const failure = send({ jsonrpc: "2.0", id, method, params }, method)
      if (failure !== null) {
        pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        reject(new BridgeError(failure))
      }
    })
  }

  /** A `ui/*` call whose result is an acknowledgement, possibly a refusal. */
  async function acknowledged(method: string, params: object, options?: CallOptions) {
    const { refused } = await request(method, params, narrowAcknowledgement, options)
    if (refused) throw new BridgeError({ kind: "refused", method })
  }

  function notify(method: string, params: object) {
    if (!open())
      throw new BridgeError({ kind: "not-connected", method, status: status() })
    const failure = send({ jsonrpc: "2.0", method, params }, method)
    if (failure !== null) throw new BridgeError(failure)
  }

  // ---- what the host sends

  function onNotification(method: string, params: unknown) {
    if (!open()) {
      const now = status()
      report(
        now === "idle" || now === "connecting"
          ? { kind: "before-initialized", method }
          : { kind: "not-open", method, status: now },
      )
      return
    }
    if (method === "ui/notifications/host-context-changed") {
      const read = narrowHostContext(params, "params")
      if (!read.ok) {
        report({ kind: "malformed-params", method, reason: read.reason })
        return
      }
      if (read.dropped.length > 0)
        report({ kind: "dropped-fields", method, fields: read.dropped })
      // A partial update: each field it carries replaces the one held; the
      // rest stay ("the View SHOULD merge received fields with its current
      // context state", SEP-1865, `ui/notifications/host-context-changed`).
      update({ hostContext: { ...state.hostContext, ...read.value } })
      return
    }
    if (!isToolNotification(method)) return // not one the app reads
    const event = toolEvent(toolNotifications[method], method, params)
    if (event === null) return
    const next = nextToolCall(state.toolCall, event)
    if (next.outOfOrder)
      report({ kind: "tool-order", method, phase: state.toolCall.phase })
    if (next.call !== state.toolCall) update({ toolCall: next.call })
  }

  function toolEvent(
    type: (typeof toolNotifications)[ToolNotification],
    method: string,
    params: unknown,
  ): ToolEvent | null {
    const malformed = (reason: string) => {
      report({ kind: "malformed-params", method, reason })
      return null
    }
    if (type === "result") {
      const read = narrowCallToolResult(params)
      if (!read.ok) return malformed(read.reason)
      if (read.dropped.length > 0)
        report({ kind: "dropped-fields", method, fields: read.dropped })
      return { type, result: read.value }
    }
    if (type === "cancelled") {
      const read = narrowReason(params)
      if (!read.ok) return malformed(read.reason)
      if (read.dropped.length > 0)
        report({ kind: "dropped-fields", method, fields: read.dropped })
      return read.value.reason === undefined
        ? { type }
        : { type, reason: read.value.reason }
    }
    const read = narrowToolArguments(params)
    if (!read.ok) return malformed(read.reason)
    return { type, arguments: read.value.arguments }
  }

  function onRequest(id: RequestId, method: string, params: unknown) {
    if (method === "ping") {
      answer({ jsonrpc: "2.0", id, result: {} })
      return
    }
    if (method !== "ui/resource-teardown") {
      answer({
        jsonrpc: "2.0",
        id,
        error: {
          code: errorCodes.methodNotFound,
          message: `the app does not answer ${method}`,
        },
      })
      return
    }
    const read = narrowReason(params)
    const reason = read.ok ? read.value.reason : undefined
    if (!read.ok) report({ kind: "malformed-params", method, reason: read.reason })
    tearDown(reason).then(
      () => answer({ jsonrpc: "2.0", id, result: {} }),
      () =>
        answer({
          jsonrpc: "2.0",
          id,
          error: { code: errorCodes.refused, message: "Teardown error" },
        }),
    )
  }

  /**
   * Runs the teardown handlers once, however many times the host asks; then
   * the connection is torn down and every unanswered call rejected. Rejects
   * if a handler failed, which the host is told; torn down all the same.
   */
  function tearDown(reason: string | undefined): Promise<void> {
    if (teardown !== null) return teardown
    const connection = state.connection
    const because = reason === undefined ? {} : { reason }
    if (connection.status === "connected") {
      const { host, capabilities } = connection
      update({
        connection: {
          status: "tearing-down",
          opened: { host, capabilities },
          ...because,
        },
      })
    } else if (connection.status === "idle" || connection.status === "connecting") {
      update({ connection: { status: "tearing-down", ...because } })
    }
    const handlers = [...teardownHandlers]
    teardown = Promise.allSettled(handlers.map(async (handler) => handler(reason))).then(
      (outcomes) => {
        // A closed bridge stays closed, and a failed one keeps its failure;
        // either way nothing is left pending to reject but by teardown.
        if (status() === "failed") settleAll((method) => ({ kind: "torn-down", method }))
        else if (status() !== "closed") {
          update({
            connection:
              reason === undefined
                ? { status: "torn-down" }
                : { status: "torn-down", reason },
          })
          settleAll((method) => ({ kind: "torn-down", method }))
        }
        if (outcomes.some((outcome) => outcome.status === "rejected")) {
          throw new Error("a teardown handler failed")
        }
      },
    )
    return teardown
  }

  function onResponse(
    id: RequestId,
    outcome:
      { result: unknown } | { error: { code: number; message: string; data?: unknown } },
  ) {
    const call = pending.get(id)
    if (call === undefined) {
      // A late answer to a call settled here is expected; any other — to an
      // id never sent, or a second answer to one — is not.
      if (!abandoned.delete(id)) report({ kind: "unknown-response", id })
      return
    }
    pending.delete(id)
    if ("result" in outcome) call.resolve(outcome.result)
    else {
      const { code, message, data } = outcome.error
      call.reject({
        kind: "host-error",
        method: call.method,
        code,
        message,
        ...(data === undefined ? {} : { data }),
      })
    }
  }

  const stopListening = transport.listen((data) => {
    const envelope = readEnvelope(data)
    switch (envelope.kind) {
      case "invalid":
        report({ kind: "invalid-message", reason: envelope.reason })
        return
      case "notification":
        onNotification(envelope.method, envelope.params)
        return
      case "request":
        onRequest(envelope.id, envelope.method, envelope.params)
        return
      case "result":
        onResponse(envelope.id, { result: envelope.result })
        return
      case "error":
        onResponse(envelope.id, { error: envelope.error })
        return
    }
  })

  // ---- the app's calls

  function connect({ signal }: CallOptions = {}): Promise<void> {
    // Called again, it answers from the state as it is now: the first call's
    // promise while that is still deciding, or once it connected and the
    // connection holds; otherwise the connection is not one to connect.
    const connection = state.connection
    const deciding =
      connection.status === "connecting" ||
      (connection.status === "tearing-down" && connection.opened === undefined)
    if (connecting !== null && (deciding || connection.status === "connected")) {
      return connecting.promise
    }
    if (status() !== "idle") {
      return Promise.reject(
        new BridgeError({
          kind: "not-connected",
          method: "ui/initialize",
          status: status(),
        }),
      )
    }
    let resolve: () => void = () => {}
    let reject: (failure: BridgeFailure) => void = () => {}
    const promise = new Promise<void>((resolved, rejected) => {
      resolve = resolved
      reject = (failure) => rejected(new BridgeError(failure))
    })
    connecting = { promise, resolve, reject }
    update({ connection: { status: "connecting" } })
    // The request only moves the state; `settleConnect` settles the promise
    // from the state, whatever moved it — this, a close, or a teardown.
    request(
      "ui/initialize",
      {
        appInfo: options.app,
        appCapabilities: { availableDisplayModes: declaredModes },
        protocolVersion: PROTOCOL_VERSION,
      },
      narrowInitializeResult,
      signal === undefined ? {} : { signal },
      true,
    ).then(
      (result) => {
        // Closed, or being torn down, after the host's answer arrived and
        // before this ran: the connection never opens, and that state stands.
        if (status() !== "connecting") return
        if (result.protocolVersion !== PROTOCOL_VERSION) {
          const failure: BridgeFailure = {
            kind: "protocol-version",
            offered: result.protocolVersion,
            spoken: PROTOCOL_VERSION,
          }
          update({ connection: { status: "failed", failure } })
          return
        }
        // `initialized` goes before anything else the app sends: subscribers
        // that hear "connected" may send at once (a first size, a call).
        const failure = send(
          { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
          "ui/notifications/initialized",
        )
        if (failure !== null) {
          update({ connection: { status: "failed", failure } })
          return
        }
        update({
          connection: {
            status: "connected",
            host: result.hostInfo,
            capabilities: result.hostCapabilities,
          },
          hostContext: result.hostContext,
        })
      },
      (error: unknown) => {
        // Closed or being torn down already says where the connection ended.
        if (status() !== "connecting" || !(error instanceof BridgeError)) return
        update({ connection: { status: "failed", failure: error.failure } })
      },
    )
    return promise
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    connect,
    callTool: (name, args, callOptions) =>
      request(
        "tools/call",
        args === undefined ? { name } : { name, arguments: args },
        narrowCallToolResult,
        callOptions,
      ),
    readResource: (uri, callOptions) =>
      request("resources/read", { uri }, narrowReadResourceResult, callOptions),
    sendMessage(content, { openai, ...callOptions } = {}) {
      const params =
        openai === undefined
          ? { role: "user", content }
          : { role: "user", content, _meta: { "openai/message": openai } }
      return acknowledged("ui/message", params, callOptions)
    },
    updateModelContext: (context, callOptions) =>
      acknowledged("ui/update-model-context", context, callOptions),
    async requestDisplayMode(mode, callOptions) {
      const method = "ui/request-display-mode"
      if (!declaredModes.includes(mode)) {
        throw new BridgeError({
          kind: "display-mode-undeclared",
          mode,
          declared: declaredModes,
        })
      }
      const available = state.hostContext.availableDisplayModes
      if (open() && available !== undefined && !available.includes(mode)) {
        throw new BridgeError({ kind: "display-mode-unavailable", mode, available })
      }
      const { mode: chosen } = await request(
        method,
        { mode },
        narrowDisplayModeResult,
        callOptions,
      )
      if (open() && state.hostContext.displayMode !== chosen) {
        update({ hostContext: { ...state.hostContext, displayMode: chosen } })
      }
      return chosen
    },
    openLink: (url, callOptions) => acknowledged("ui/open-link", { url }, callOptions),
    log: (params) => notify("notifications/message", params),
    reportSize(size) {
      if (
        lastSize !== null &&
        lastSize.width === size.width &&
        lastSize.height === size.height
      ) {
        return
      }
      notify("ui/notifications/size-changed", size)
      lastSize = { ...size }
    },
    onTeardown(handler) {
      teardownHandlers.add(handler)
      return () => teardownHandlers.delete(handler)
    },
    close() {
      if (status() === "closed") return
      stopListening()
      update({ connection: { status: "closed" } })
      settleAll((method) => ({ kind: "closed", method }))
    },
  }
}
