/**
 * The bridge against a host scripted message by message, so every ordering
 * the README's table "The connection" names is played exactly. Tests are
 * named for their row.
 */
import { describe, expect, it, vi } from "vitest"

import {
  errorCodes,
  readEnvelope,
  type JsonRpcMessage,
  type RequestId,
} from "../protocol/json-rpc.ts"
import { memoryChannel } from "../protocol/memory-channel.ts"
import { PROTOCOL_VERSION } from "../protocol/messages.ts"
import { windowTransport, type Transport } from "../protocol/transport.ts"
import { createBridge, type BridgeOptions } from "./bridge.ts"
import { BridgeError, type BridgeFailure, type HostViolation } from "./failures.ts"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

type Read = ReturnType<typeof readEnvelope>

/** A host the test drives by hand: what the app sent, and what to send back. */
function scriptedHost(end: Transport) {
  const received: Read[] = []
  end.listen((data) => received.push(readEnvelope(data)))
  const find = (method: string) =>
    received.find(
      (message): message is Extract<Read, { kind: "request" | "notification" }> =>
        (message.kind === "request" || message.kind === "notification") &&
        message.method === method,
    )
  return {
    received,
    find,
    methods: () =>
      received.map((message) =>
        message.kind === "request" || message.kind === "notification"
          ? message.method
          : message.kind,
      ),
    /** The id of the app's request for `method`. */
    idOf(method: string): RequestId {
      const message = find(method)
      if (message?.kind !== "request") throw new Error(`no ${method} request`)
      return message.id
    },
    send: (message: JsonRpcMessage) => end.send(message),
    /** Answers the app's `method` request with `result`. */
    answer(method: string, result: unknown) {
      end.send({ jsonrpc: "2.0", id: this.idOf(method), result })
    },
    refuse(method: string, code = errorCodes.refused, message = "no") {
      end.send({ jsonrpc: "2.0", id: this.idOf(method), error: { code, message } })
    },
    notify: (method: string, params?: unknown) =>
      end.send({ jsonrpc: "2.0", method, params } as JsonRpcMessage),
  }
}

const initializeResult = (overrides: Record<string, unknown> = {}) => ({
  protocolVersion: PROTOCOL_VERSION,
  hostInfo: { name: "host", version: "1.0.0" },
  hostCapabilities: { openLinks: {} },
  hostContext: {
    theme: "light",
    displayMode: "inline",
    availableDisplayModes: ["inline"],
  },
  ...overrides,
})

function setup(options: Partial<BridgeOptions> = {}) {
  const channel = memoryChannel()
  const host = scriptedHost(channel.host)
  const violations: HostViolation[] = []
  const bridge = createBridge({
    transport: channel.app,
    app: { name: "app", version: "1.0.0" },
    onViolation: (violation) => violations.push(violation),
    ...options,
  })
  return { bridge, host, violations }
}

async function connected(
  options: Partial<BridgeOptions> = {},
  result = initializeResult(),
) {
  const context = setup(options)
  const connecting = context.bridge.connect()
  await flush()
  context.host.answer("ui/initialize", result)
  await connecting
  await flush()
  return context
}

/** The failure a promise rejected with. */
async function failure(promise: Promise<unknown>): Promise<BridgeFailure> {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection")
    },
    (reason: unknown) => reason,
  )
  if (!(error instanceof BridgeError)) throw error
  return error.failure
}

describe("the connection", () => {
  it("idle + connect: connecting, and sends ui/initialize with the app, its modes, and the protocol version", async () => {
    const { bridge, host } = setup({ displayModes: ["inline", "fullscreen"] })
    bridge.connect().catch(() => {})
    expect(bridge.getState().connection).toEqual({ status: "connecting" })
    await flush()
    const request = host.find("ui/initialize")
    expect(request?.kind).toBe("request")
    expect(request?.params).toEqual({
      appInfo: { name: "app", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
      protocolVersion: PROTOCOL_VERSION,
    })
  })

  it("declares inline alone when the app names no display modes", async () => {
    const { bridge, host } = setup()
    bridge.connect().catch(() => {})
    await flush()
    expect(host.find("ui/initialize")?.params).toMatchObject({
      appCapabilities: { availableDisplayModes: ["inline"] },
    })
  })

  it("connecting + result: connected with the host, its capabilities and context, then sends initialized", async () => {
    const { bridge, host } = await connected()
    expect(bridge.getState().connection).toEqual({
      status: "connected",
      host: { name: "host", version: "1.0.0" },
      capabilities: { openLinks: {} },
    })
    expect(bridge.getState().hostContext).toEqual({
      theme: "light",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
    })
    expect(host.methods()).toEqual(["ui/initialize", "ui/notifications/initialized"])
  })

  it("connecting + error: failed with the host's error", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    host.refuse("ui/initialize", -32000, "not today")
    const expected: BridgeFailure = {
      kind: "host-error",
      method: "ui/initialize",
      code: -32000,
      message: "not today",
    }
    expect(await failure(connecting)).toEqual(expected)
    expect(bridge.getState().connection).toEqual({ status: "failed", failure: expected })
    expect(host.methods()).toEqual(["ui/initialize"])
  })

  it("connecting + malformed result: failed, malformed-result", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", { protocolVersion: PROTOCOL_VERSION })
    expect(await failure(connecting)).toEqual({
      kind: "malformed-result",
      method: "ui/initialize",
      reason: "hostInfo has no name and version",
    })
    expect(bridge.getState().connection.status).toBe("failed")
  })

  it("connecting + another protocol version: failed, protocol-version, and never initialized", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", initializeResult({ protocolVersion: "2025-11-21" }))
    expect(await failure(connecting)).toEqual({
      kind: "protocol-version",
      offered: "2025-11-21",
      spoken: PROTOCOL_VERSION,
    })
    await flush()
    expect(host.methods()).toEqual(["ui/initialize"])
    expect(bridge.getState().hostContext).toEqual({})
  })

  it("connecting + abort: failed, aborted; the late answer is ignored without a violation", async () => {
    const { bridge, host, violations } = setup()
    const abort = new AbortController()
    const connecting = bridge.connect({ signal: abort.signal })
    await flush()
    abort.abort()
    expect(await failure(connecting)).toEqual({
      kind: "aborted",
      method: "ui/initialize",
    })
    host.answer("ui/initialize", initializeResult())
    await flush()
    expect(bridge.getState().connection).toEqual({
      status: "failed",
      failure: { kind: "aborted", method: "ui/initialize" },
    })
    expect(violations).toEqual([])
  })

  it("connecting + close: closed, and connect rejects closed", async () => {
    const { bridge } = setup()
    const connecting = bridge.connect()
    await flush()
    bridge.close()
    expect(await failure(connecting)).toEqual({ kind: "closed", method: "ui/initialize" })
    expect(bridge.getState().connection).toEqual({ status: "closed" })
  })

  it("connecting + teardown: torn down, connect rejects torn-down, and a late result does not connect", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    let release: () => void = () => {}
    bridge.onTeardown(() => new Promise<void>((resolve) => (release = resolve)))
    host.send({ jsonrpc: "2.0", id: "t1", method: "ui/resource-teardown", params: {} })
    await flush()
    host.answer("ui/initialize", initializeResult())
    expect(await failure(connecting)).toEqual({
      kind: "torn-down",
      method: "ui/initialize",
    })
    release()
    await flush()
    expect(bridge.getState().connection).toEqual({ status: "torn-down" })
    expect(host.methods()).not.toContain("ui/notifications/initialized")
  })

  it("connect twice: the same promise", async () => {
    const { bridge } = setup()
    expect(bridge.connect()).toBe(bridge.connect())
  })

  it("failed or closed + connect: not-connected", async () => {
    const { bridge } = setup()
    bridge.close()
    expect(await failure(bridge.connect())).toEqual({
      kind: "not-connected",
      method: "ui/initialize",
      status: "closed",
    })
  })

  it("idle + a call: not-connected, and nothing is sent", async () => {
    const { bridge, host } = setup()
    expect(await failure(bridge.callTool("x"))).toEqual({
      kind: "not-connected",
      method: "tools/call",
      status: "idle",
    })
    expect(() => bridge.reportSize({ width: 1, height: 1 })).toThrow(BridgeError)
    await flush()
    expect(host.received).toEqual([])
  })

  it("connecting + a call: not-connected", async () => {
    const { bridge } = setup()
    bridge.connect().catch(() => {})
    expect(await failure(bridge.openLink("https://example.com"))).toMatchObject({
      kind: "not-connected",
      status: "connecting",
    })
  })

  it("connected + teardown: tearing down while the handlers run, calls still carried; then torn down, the rest rejected, and answered", async () => {
    const { bridge, host } = await connected()
    let release: () => void = () => {}
    const reasons: (string | undefined)[] = []
    bridge.onTeardown((reason) => {
      reasons.push(reason)
      return new Promise<void>((resolve) => (release = resolve))
    })
    const unanswered = bridge.callTool("left-hanging")
    host.send({
      jsonrpc: "2.0",
      id: "t1",
      method: "ui/resource-teardown",
      params: { reason: "closed" },
    })
    await flush()
    expect(bridge.getState().connection).toMatchObject({
      status: "tearing-down",
      reason: "closed",
    })
    // The app may save its state through the host before it goes.
    const saving = bridge.callTool("save")
    await flush()
    // ui/initialize was 1, the unanswered call 2, this one 3.
    host.send({ jsonrpc: "2.0", id: 3, result: { content: [] } })
    await expect(saving).resolves.toEqual({ content: [] })
    release()
    await flush()
    expect(reasons).toEqual(["closed"])
    expect(bridge.getState().connection).toEqual({
      status: "torn-down",
      reason: "closed",
    })
    expect(await failure(unanswered)).toEqual({ kind: "torn-down", method: "tools/call" })
    expect(host.received.at(-1)).toEqual({ kind: "result", id: "t1", result: {} })
    expect(await failure(bridge.callTool("after"))).toMatchObject({
      kind: "not-connected",
      status: "torn-down",
    })
  })

  it("teardown + a handler fails: answered with an error, and torn down all the same", async () => {
    const { bridge, host } = await connected()
    bridge.onTeardown(() => {
      throw new Error("could not save")
    })
    host.send({ jsonrpc: "2.0", id: 9, method: "ui/resource-teardown", params: {} })
    await flush()
    expect(host.received.at(-1)).toEqual({
      kind: "error",
      id: 9,
      error: { code: errorCodes.refused, message: "Teardown error" },
    })
    expect(bridge.getState().connection.status).toBe("torn-down")
  })

  it("tearing down + teardown again: the handlers run once, and both are answered", async () => {
    const { bridge, host } = await connected()
    const handler = vi.fn()
    bridge.onTeardown(handler)
    host.send({ jsonrpc: "2.0", id: "a", method: "ui/resource-teardown", params: {} })
    host.send({ jsonrpc: "2.0", id: "b", method: "ui/resource-teardown", params: {} })
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    const answers = host.received.filter((message) => message.kind === "result")
    expect(answers).toEqual([
      { kind: "result", id: "a", result: {} },
      { kind: "result", id: "b", result: {} },
    ])
  })

  it("a removed teardown handler is not run", async () => {
    const { bridge, host } = await connected()
    const handler = vi.fn()
    const remove = bridge.onTeardown(handler)
    remove()
    host.send({ jsonrpc: "2.0", id: 1, method: "ui/resource-teardown", params: {} })
    await flush()
    expect(handler).not.toHaveBeenCalled()
  })

  it("connected + close: closed, unanswered calls rejected closed, and the host no longer heard", async () => {
    const { bridge, host, violations } = await connected()
    const unanswered = bridge.readResource("ui://x")
    bridge.close()
    expect(await failure(unanswered)).toEqual({
      kind: "closed",
      method: "resources/read",
    })
    host.notify("ui/notifications/tool-input", { arguments: {} })
    host.notify("nonsense")
    await flush()
    expect(bridge.getState().toolCall.phase).toBe("awaiting-input")
    expect(violations).toEqual([])
    bridge.close()
    expect(bridge.getState().connection.status).toBe("closed")
  })

  it("a notification before initialized: reported and ignored", async () => {
    const { bridge, host, violations } = setup()
    bridge.connect().catch(() => {})
    host.notify("ui/notifications/tool-input", { arguments: { a: 1 } })
    await flush()
    expect(violations).toEqual([
      { kind: "before-initialized", method: "ui/notifications/tool-input" },
    ])
    expect(bridge.getState().toolCall).toEqual({ phase: "awaiting-input" })
  })

  it("subscribers hear after the transition, once per turn, and stop when unsubscribed", async () => {
    const { bridge } = setup()
    const heard: string[] = []
    const unsubscribe = bridge.subscribe(() =>
      heard.push(bridge.getState().connection.status),
    )
    bridge.connect().catch(() => {})
    expect(heard).toEqual([])
    await flush()
    expect(heard).toEqual(["connecting"])
    bridge.close()
    unsubscribe()
    await flush()
    expect(heard).toEqual(["connecting"])
  })

  it("a subscriber that closes on hearing connecting: connect rejects closed, nothing hangs", async () => {
    const { bridge } = setup()
    bridge.subscribe(() => {
      if (bridge.getState().connection.status === "connecting") bridge.close()
    })
    expect(await failure(bridge.connect())).toEqual({
      kind: "closed",
      method: "ui/initialize",
    })
    expect(bridge.getState().connection).toEqual({ status: "closed" })
  })

  it("a subscriber that connects again on hearing connecting gets the same promise", async () => {
    const { bridge, host } = setup()
    let again: Promise<void> | null = null
    bridge.subscribe(() => {
      if (again === null) again = bridge.connect()
    })
    const first = bridge.connect()
    await flush()
    expect(again).toBe(first)
    host.answer("ui/initialize", initializeResult())
    await expect(first).resolves.toBeUndefined()
  })

  it("a subscriber that closes on hearing connected: connect has resolved, and the bridge is closed", async () => {
    const { bridge, host } = setup()
    bridge.subscribe(() => {
      if (bridge.getState().connection.status === "connected") bridge.close()
    })
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", initializeResult())
    await expect(connecting).resolves.toBeUndefined()
    await flush()
    expect(bridge.getState().connection).toEqual({ status: "closed" })
  })
})

describe("races and faults", () => {
  it("connecting + close after the answer arrived but before it was read: closed, nothing more sent", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    // The answer's delivery is queued first; the close runs after it is
    // delivered and before the bridge reads it.
    host.answer("ui/initialize", initializeResult())
    queueMicrotask(() => bridge.close())
    expect(await failure(connecting)).toEqual({ kind: "closed", method: "ui/initialize" })
    expect(bridge.getState().connection).toEqual({ status: "closed" })
    await flush()
    expect(host.methods()).toEqual(["ui/initialize"])
  })

  it("the same race with another protocol version: still closed", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", initializeResult({ protocolVersion: "1999-01-01" }))
    queueMicrotask(() => bridge.close())
    expect(await failure(connecting)).toMatchObject({ kind: "closed" })
    expect(bridge.getState().connection).toEqual({ status: "closed" })
  })

  /** A transport whose `send` throws once `failing` is set. */
  function breakable() {
    const channel = memoryChannel()
    let failing = false
    const transport: Transport = {
      send(message) {
        if (failing) throw new Error("DataCloneError: could not be cloned")
        channel.app.send(message)
      },
      listen: (receive) => channel.app.listen(receive),
    }
    return { channel, transport, fail: () => (failing = true) }
  }

  it("a send that throws: the call rejects not-sent, typed, and leaves nothing pending", async () => {
    const { channel, transport, fail } = breakable()
    const host = scriptedHost(channel.host)
    const violations: HostViolation[] = []
    const bridge = createBridge({
      transport,
      app: { name: "a", version: "1" },
      onViolation: (v) => violations.push(v),
    })
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", initializeResult())
    await connecting
    fail()
    expect(await failure(bridge.callTool("x", { fn: "not cloneable" }))).toEqual({
      kind: "not-sent",
      method: "tools/call",
      reason: "DataCloneError: could not be cloned",
    })
    expect(() => bridge.reportSize({ width: 1, height: 1 })).toThrow(
      expect.objectContaining({ failure: expect.objectContaining({ kind: "not-sent" }) }),
    )
    // Nothing was left pending: an answer to that id is one to no call.
    host.send({ jsonrpc: "2.0", id: 2, result: { content: [] } })
    await flush()
    expect(violations).toEqual([{ kind: "unknown-response", id: 2 }])
  })

  it("outside a host window, connect fails not-sent instead of waiting forever", async () => {
    const own = { addEventListener() {}, removeEventListener() {} } as unknown as Window
    Object.assign(own, { parent: own })
    const bridge = createBridge({
      transport: windowTransport(own),
      app: { name: "a", version: "1" },
    })
    expect(await failure(bridge.connect())).toEqual({
      kind: "not-sent",
      method: "ui/initialize",
      reason: "there is no host window to send to",
    })
    expect(bridge.getState().connection.status).toBe("failed")
  })

  it("a subscriber that throws is logged, and the others and the transition go on", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
    const { bridge, host } = setup()
    const heard = vi.fn()
    bridge.subscribe(() => {
      throw new Error("a broken view")
    })
    bridge.subscribe(heard)
    const connecting = bridge.connect()
    await flush()
    host.answer("ui/initialize", initializeResult())
    await expect(connecting).resolves.toBeUndefined()
    expect(bridge.getState().connection.status).toBe("connected")
    const unanswered = bridge.callTool("x")
    host.send({ jsonrpc: "2.0", id: "t", method: "ui/resource-teardown", params: {} })
    await flush()
    expect(await failure(unanswered)).toEqual({ kind: "torn-down", method: "tools/call" })
    expect(host.received.at(-1)).toEqual({ kind: "result", id: "t", result: {} })
    expect(heard).toHaveBeenCalled()
    expect(quiet).toHaveBeenCalledWith(
      "[app-shell] a bridge subscriber threw:",
      expect.any(Error),
    )
    quiet.mockRestore()
  })

  it("failed + teardown: keeps the failure, and the host is answered", async () => {
    const { bridge, host } = setup()
    const connecting = bridge.connect()
    await flush()
    host.refuse("ui/initialize")
    await connecting.catch(() => {})
    host.send({ jsonrpc: "2.0", id: "t", method: "ui/resource-teardown", params: {} })
    await flush()
    expect(bridge.getState().connection.status).toBe("failed")
    expect(host.received.at(-1)).toEqual({ kind: "result", id: "t", result: {} })
  })
})

describe("what the host sends", () => {
  it("ping: answered with an empty result", async () => {
    const { host } = await connected()
    host.send({ jsonrpc: "2.0", id: 5, method: "ping" })
    await flush()
    expect(host.received.at(-1)).toEqual({ kind: "result", id: 5, result: {} })
  })

  it("a request the app does not answer: method not found", async () => {
    const { host } = await connected()
    host.send({ jsonrpc: "2.0", id: 6, method: "tools/list" })
    await flush()
    expect(host.received.at(-1)).toMatchObject({
      kind: "error",
      id: 6,
      error: { code: errorCodes.methodNotFound },
    })
  })

  it("a message that is not JSON-RPC: reported", async () => {
    const channel = memoryChannel()
    const violations: HostViolation[] = []
    createBridge({
      transport: channel.app,
      app: { name: "app", version: "1" },
      onViolation: (v) => violations.push(v),
    })
    channel.host.send({ hello: "world" } as unknown as JsonRpcMessage)
    await flush()
    expect(violations).toEqual([
      { kind: "invalid-message", reason: 'jsonrpc is not "2.0"' },
    ])
  })

  it("a response to no request: reported", async () => {
    const { host, violations } = await connected()
    host.send({ jsonrpc: "2.0", id: 999, result: {} })
    host.send({ jsonrpc: "2.0", id: "theirs", result: {} })
    await flush()
    expect(violations).toEqual([
      { kind: "unknown-response", id: 999 },
      { kind: "unknown-response", id: "theirs" },
    ])
  })

  it("a second answer to an answered call: reported; a late answer to an aborted one: not", async () => {
    const { bridge, host, violations } = await connected()
    const call = bridge.callTool("x")
    await flush()
    const id = host.idOf("tools/call")
    host.send({ jsonrpc: "2.0", id, result: { content: [] } })
    await call
    host.send({ jsonrpc: "2.0", id, result: { content: [] } })
    const abort = new AbortController()
    const aborted = bridge.callTool("y", {}, { signal: abort.signal })
    abort.abort()
    await aborted.catch(() => {})
    host.send({ jsonrpc: "2.0", id: Number(id) + 1, result: { content: [] } })
    await flush()
    expect(violations).toEqual([{ kind: "unknown-response", id }])
  })

  it("host-context-changed: merged by field, so a theme change keeps the styles", async () => {
    const { bridge, host } = await connected(
      {},
      initializeResult({
        hostContext: {
          theme: "light",
          styles: { variables: { "--color-text-primary": "black" } },
        },
      }),
    )
    host.notify("ui/notifications/host-context-changed", { theme: "dark" })
    await flush()
    expect(bridge.getState().hostContext).toEqual({
      theme: "dark",
      styles: { variables: { "--color-text-primary": "black" } },
    })
  })

  it("host-context-changed with styles: replaces the styles whole, so a variable left out is gone", async () => {
    const { bridge, host } = await connected(
      {},
      initializeResult({
        hostContext: {
          styles: {
            variables: { "--color-text-primary": "black", "--font-sans": "Inter" },
          },
        },
      }),
    )
    host.notify("ui/notifications/host-context-changed", {
      styles: { variables: { "--color-text-primary": "white" } },
    })
    await flush()
    expect(bridge.getState().hostContext.styles).toEqual({
      variables: { "--color-text-primary": "white" },
    })
  })

  it("host-context-changed malformed: reported, the context unchanged", async () => {
    const { bridge, host, violations } = await connected()
    const before = bridge.getState().hostContext
    host.notify("ui/notifications/host-context-changed", "dark")
    await flush()
    expect(bridge.getState().hostContext).toBe(before)
    expect(violations).toEqual([
      {
        kind: "malformed-params",
        method: "ui/notifications/host-context-changed",
        reason: "params is not an object",
      },
    ])
  })

  it("host-context-changed with malformed fields: the rest applied, the fields reported", async () => {
    const { bridge, host, violations } = await connected()
    host.notify("ui/notifications/host-context-changed", {
      theme: "purple",
      locale: "fr-FR",
    })
    await flush()
    expect(bridge.getState().hostContext).toMatchObject({
      theme: "light",
      locale: "fr-FR",
    })
    expect(violations).toEqual([
      {
        kind: "dropped-fields",
        method: "ui/notifications/host-context-changed",
        fields: ["params.theme"],
      },
    ])
  })

  it("the tool's notifications move the tool call", async () => {
    const { bridge, host } = await connected()
    host.notify("ui/notifications/tool-input-partial", { arguments: { q: "w" } })
    await flush()
    expect(bridge.getState().toolCall).toEqual({
      phase: "streaming-input",
      partial: { q: "w" },
    })
    host.notify("ui/notifications/tool-input", { arguments: { q: "weather" } })
    await flush()
    expect(bridge.getState().toolCall).toEqual({
      phase: "running",
      input: { q: "weather" },
    })
    host.notify("ui/notifications/tool-cancelled", { reason: "stopped" })
    await flush()
    expect(bridge.getState().toolCall).toEqual({
      phase: "cancelled",
      input: { q: "weather" },
      reason: "stopped",
    })
  })

  it("tool-input without arguments is an empty input", async () => {
    const { bridge, host } = await connected()
    host.notify("ui/notifications/tool-input", {})
    await flush()
    expect(bridge.getState().toolCall).toEqual({ phase: "running", input: {} })
  })

  it("a tool notification out of order: reported", async () => {
    const { host, violations } = await connected()
    host.notify("ui/notifications/tool-result", { content: [] })
    await flush()
    expect(violations).toEqual([
      {
        kind: "tool-order",
        method: "ui/notifications/tool-result",
        phase: "awaiting-input",
      },
    ])
  })

  it("a malformed tool result: reported, and the call does not move", async () => {
    const { bridge, host, violations } = await connected()
    host.notify("ui/notifications/tool-input", { arguments: {} })
    host.notify("ui/notifications/tool-result", { content: "not an array" })
    host.notify("ui/notifications/tool-input-partial", { arguments: [] })
    await flush()
    expect(bridge.getState().toolCall.phase).toBe("running")
    expect(violations).toEqual([
      {
        kind: "malformed-params",
        method: "ui/notifications/tool-result",
        reason: "content is not an array",
      },
      {
        kind: "malformed-params",
        method: "ui/notifications/tool-input-partial",
        reason: "arguments is not an object",
      },
    ])
  })

  it("a notification the app does not read: ignored, not reported", async () => {
    const { violations, host } = await connected()
    host.notify("notifications/tools/list_changed", {})
    await flush()
    expect(violations).toEqual([])
  })

  it("reports to console.warn when no onViolation is given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const channel = memoryChannel()
    createBridge({ transport: channel.app, app: { name: "a", version: "1" } })
    channel.host.send({ jsonrpc: "1.0" } as unknown as JsonRpcMessage)
    await flush()
    expect(warn).toHaveBeenCalledWith("[app-shell] the host broke MCP Apps:", {
      kind: "invalid-message",
      reason: 'jsonrpc is not "2.0"',
    })
    warn.mockRestore()
  })
})

describe("the app's calls", () => {
  it("tools/call: sends the name and arguments, resolves with the result, a tool error included", async () => {
    const { bridge, host } = await connected()
    const call = bridge.callTool("weather", { city: "Oslo" })
    await flush()
    expect(host.find("tools/call")?.params).toEqual({
      name: "weather",
      arguments: { city: "Oslo" },
    })
    const result = { content: [{ type: "text", text: "no such city" }], isError: true }
    host.answer("tools/call", result)
    await expect(call).resolves.toEqual(result)
  })

  it("tools/call without arguments sends none", async () => {
    const { bridge, host } = await connected()
    void bridge.callTool("refresh").catch(() => {})
    await flush()
    expect(host.find("tools/call")?.params).toEqual({ name: "refresh" })
  })

  it("tools/call refused: host-error with the host's code and message", async () => {
    const { bridge, host } = await connected()
    const call = bridge.callTool("delete")
    await flush()
    host.send({
      jsonrpc: "2.0",
      id: host.idOf("tools/call"),
      error: { code: -32000, message: "denied", data: { why: "policy" } },
    })
    expect(await failure(call)).toEqual({
      kind: "host-error",
      method: "tools/call",
      code: -32000,
      message: "denied",
      data: { why: "policy" },
    })
  })

  it("tools/call with a malformed result: malformed-result", async () => {
    const { bridge, host } = await connected()
    const call = bridge.callTool("x")
    await flush()
    host.answer("tools/call", { content: 1 })
    expect(await failure(call)).toEqual({
      kind: "malformed-result",
      method: "tools/call",
      reason: "content is not an array",
    })
  })

  it("tools/call with malformed blocks: the rest kept, the blocks reported", async () => {
    const { bridge, host, violations } = await connected()
    const call = bridge.callTool("x")
    await flush()
    host.answer("tools/call", {
      content: [{ type: "text", text: "ok" }, { type: "video" }],
    })
    await expect(call).resolves.toEqual({ content: [{ type: "text", text: "ok" }] })
    expect(violations).toEqual([
      { kind: "dropped-fields", method: "tools/call", fields: ["content[1]"] },
    ])
  })

  it("a call aborted: rejects aborted, and an already-aborted signal sends nothing", async () => {
    const { bridge, host } = await connected()
    const abort = new AbortController()
    const call = bridge.callTool("slow", {}, { signal: abort.signal })
    abort.abort()
    expect(await failure(call)).toEqual({ kind: "aborted", method: "tools/call" })
    await flush()
    const sent = host.received.length
    expect(await failure(bridge.callTool("x", {}, { signal: abort.signal }))).toEqual({
      kind: "aborted",
      method: "tools/call",
    })
    await flush()
    expect(host.received.length).toBe(sent)
  })

  it("resources/read: resolves with the contents", async () => {
    const { bridge, host } = await connected()
    const read = bridge.readResource("ui://app/data")
    await flush()
    expect(host.find("resources/read")?.params).toEqual({ uri: "ui://app/data" })
    host.answer("resources/read", { contents: [{ uri: "ui://app/data", text: "{}" }] })
    await expect(read).resolves.toEqual({
      contents: [{ uri: "ui://app/data", text: "{}" }],
    })
  })

  it("resources/read malformed: malformed-result", async () => {
    const { bridge, host } = await connected()
    const read = bridge.readResource("ui://x")
    await flush()
    host.answer("resources/read", {})
    expect(await failure(read)).toMatchObject({
      kind: "malformed-result",
      method: "resources/read",
    })
  })

  it("ui/message: a user message with content blocks, and openai options under _meta", async () => {
    const { bridge, host } = await connected()
    const sent = bridge.sendMessage([{ type: "text", text: "hi" }], {
      openai: { target: "new" },
    })
    await flush()
    expect(host.find("ui/message")?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "hi" }],
      _meta: { "openai/message": { target: "new" } },
    })
    host.answer("ui/message", {})
    await expect(sent).resolves.toBeUndefined()
  })

  it("ui/message answered isError: refused", async () => {
    const { bridge, host } = await connected()
    const sent = bridge.sendMessage([{ type: "text", text: "hi" }])
    await flush()
    expect(host.find("ui/message")?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    })
    host.answer("ui/message", { isError: true })
    expect(await failure(sent)).toEqual({ kind: "refused", method: "ui/message" })
  })

  it("ui/update-model-context: sends the context; refused by error", async () => {
    const { bridge, host } = await connected()
    const update = bridge.updateModelContext({ structuredContent: { a: 1 } })
    await flush()
    expect(host.find("ui/update-model-context")?.params).toEqual({
      structuredContent: { a: 1 },
    })
    host.refuse("ui/update-model-context")
    expect(await failure(update)).toMatchObject({ kind: "host-error", code: -32000 })
  })

  it("ui/open-link: sends the URL; refused by error or isError", async () => {
    const { bridge, host } = await connected()
    const open = bridge.openLink("https://example.com")
    await flush()
    expect(host.find("ui/open-link")?.params).toEqual({ url: "https://example.com" })
    host.answer("ui/open-link", { isError: true })
    expect(await failure(open)).toEqual({ kind: "refused", method: "ui/open-link" })
  })

  it("ui/request-display-mode for a mode the app did not declare: refused here, nothing sent", async () => {
    const { bridge, host } = await connected()
    expect(await failure(bridge.requestDisplayMode("pip"))).toEqual({
      kind: "display-mode-undeclared",
      mode: "pip",
      declared: ["inline"],
    })
    await flush()
    expect(host.find("ui/request-display-mode")).toBeUndefined()
  })

  it("ui/request-display-mode for a mode the host does not offer: refused here, nothing sent", async () => {
    const { bridge, host } = await connected({ displayModes: ["inline", "fullscreen"] })
    expect(await failure(bridge.requestDisplayMode("fullscreen"))).toEqual({
      kind: "display-mode-unavailable",
      mode: "fullscreen",
      available: ["inline"],
    })
    await flush()
    expect(host.find("ui/request-display-mode")).toBeUndefined()
  })

  it("ui/request-display-mode when the host lists no modes: asked, and the host's choice kept", async () => {
    const { bridge, host } = await connected(
      { displayModes: ["inline", "fullscreen"] },
      initializeResult({ hostContext: { displayMode: "inline" } }),
    )
    const request = bridge.requestDisplayMode("fullscreen")
    await flush()
    expect(host.find("ui/request-display-mode")?.params).toEqual({ mode: "fullscreen" })
    host.answer("ui/request-display-mode", { mode: "inline" })
    await expect(request).resolves.toBe("inline")
    expect(bridge.getState().hostContext.displayMode).toBe("inline")
  })

  it("ui/request-display-mode granted: the context follows the answer", async () => {
    const { bridge, host } = await connected(
      { displayModes: ["inline", "fullscreen"] },
      initializeResult({
        hostContext: {
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
        },
      }),
    )
    const request = bridge.requestDisplayMode("fullscreen")
    await flush()
    host.answer("ui/request-display-mode", { mode: "fullscreen" })
    await expect(request).resolves.toBe("fullscreen")
    expect(bridge.getState().hostContext.displayMode).toBe("fullscreen")
  })

  it("ui/request-display-mode answered with no mode: malformed-result", async () => {
    const { bridge, host } = await connected({ displayModes: ["inline"] })
    const request = bridge.requestDisplayMode("inline")
    await flush()
    host.answer("ui/request-display-mode", { mode: "sideways" })
    expect(await failure(request)).toMatchObject({ kind: "malformed-result" })
  })

  it("notifications/message: a log line", async () => {
    const { bridge, host } = await connected()
    bridge.log({ level: "info", data: { loaded: true } })
    await flush()
    expect(host.find("notifications/message")).toEqual({
      kind: "notification",
      method: "notifications/message",
      params: { level: "info", data: { loaded: true } },
    })
  })

  it("size-changed: sent when the size differs from the last one sent", async () => {
    const { bridge, host } = await connected()
    bridge.reportSize({ width: 100, height: 50 })
    bridge.reportSize({ width: 100, height: 50 })
    bridge.reportSize({ width: 100, height: 60 })
    await flush()
    expect(
      host.received.filter(
        (m) => m.kind === "notification" && m.method === "ui/notifications/size-changed",
      ),
    ).toEqual([
      {
        kind: "notification",
        method: "ui/notifications/size-changed",
        params: { width: 100, height: 50 },
      },
      {
        kind: "notification",
        method: "ui/notifications/size-changed",
        params: { width: 100, height: 60 },
      },
    ])
  })
})
