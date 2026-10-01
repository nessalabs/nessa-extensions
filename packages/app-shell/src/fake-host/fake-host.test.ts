/**
 * The fake host holds the app to the standard and itself as a host. Driven
 * by a scripted app message by message, so each violation is played exactly.
 */
import { describe, expect, it } from "vitest"

import { createBridge } from "../bridge/bridge.ts"
import { BridgeError } from "../bridge/failures.ts"
import { errorCodes, readEnvelope, type JsonRpcMessage } from "../protocol/json-rpc.ts"
import { memoryChannel } from "../protocol/memory-channel.ts"
import { PROTOCOL_VERSION } from "../protocol/messages.ts"
import {
  createFakeHost,
  FakeHostMisuse,
  HostRefusal,
  type FakeHostOptions,
} from "./fake-host.ts"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "ui/initialize",
  params: {
    appInfo: { name: "app", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: PROTOCOL_VERSION,
  },
} as const

/** A fake host and an app that sends exactly what the test says. */
function scripted(options: Omit<FakeHostOptions, "transport"> = {}) {
  const channel = memoryChannel()
  const host = createFakeHost({ ...options, transport: channel.host })
  const received: ReturnType<typeof readEnvelope>[] = []
  channel.app.listen((data) => received.push(readEnvelope(data)))
  const send = (message: object) => channel.app.send(message as JsonRpcMessage)
  return { host, received, send }
}

async function initialized(options: Omit<FakeHostOptions, "transport"> = {}) {
  const context = scripted(options)
  context.send(initialize)
  context.send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} })
  await context.host.initialized
  return context
}

describe("the handshake", () => {
  it("answers ui/initialize with its version, host, capabilities and context, and waits for initialized", async () => {
    const { host, received, send } = scripted({ context: { theme: "dark" } })
    send(initialize)
    await flush()
    expect(received).toEqual([
      {
        kind: "result",
        id: 1,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: "nessa-fake-host", version: "0.0.0" },
          hostCapabilities: {
            openLinks: {},
            serverTools: {},
            serverResources: {},
            logging: {},
            updateModelContext: { text: {}, structuredContent: {} },
            message: { text: {} },
          },
          hostContext: {
            displayMode: "inline",
            availableDisplayModes: ["inline"],
            theme: "dark",
          },
        },
      },
    ])
    expect(host.stage).toBe("initializing")
    expect(host.app).toEqual({
      info: { name: "app", version: "1" },
      capabilities: { availableDisplayModes: ["inline"] },
    })
  })

  it("plays the tool call only after initialized: partials, input, then the outcome", async () => {
    const { received, send, host } = scripted({
      tool: {
        partials: [{ a: 1 }],
        input: { a: 12 },
        outcome: { cancelled: "the person stopped it" },
      },
    })
    send(initialize)
    await flush()
    expect(received).toHaveLength(1)
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" })
    await host.initialized
    await flush()
    expect(received.slice(1)).toEqual([
      {
        kind: "notification",
        method: "ui/notifications/tool-input-partial",
        params: { arguments: { a: 1 } },
      },
      {
        kind: "notification",
        method: "ui/notifications/tool-input",
        params: { arguments: { a: 12 } },
      },
      {
        kind: "notification",
        method: "ui/notifications/tool-cancelled",
        params: { reason: "the person stopped it" },
      },
    ])
  })

  it("refuses a malformed ui/initialize, and records it", async () => {
    const { host, received, send } = scripted()
    send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { appInfo: {} } })
    await flush()
    expect(received[0]).toMatchObject({
      kind: "error",
      error: { code: errorCodes.invalidParams },
    })
    expect(host.violations).toEqual([
      {
        kind: "malformed-params",
        method: "ui/initialize",
        reason: "appInfo has no name and version",
      },
    ])
    expect(host.stage).toBe("waiting")
  })

  it("records a second ui/initialize and refuses it", async () => {
    const { host, received, send } = await initialized()
    send({ ...initialize, id: 2 })
    await flush()
    expect(received.at(-1)).toMatchObject({ kind: "error", id: 2 })
    expect(host.violations).toEqual([{ kind: "repeated-initialize" }])
  })

  it("records initialized sent before ui/initialize was answered", async () => {
    const { host, send } = scripted()
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" })
    await flush()
    expect(host.violations).toEqual([
      { kind: "before-initialized", method: "ui/notifications/initialized" },
    ])
    expect(host.stage).toBe("waiting")
  })

  it("refuses a call before initialized, and records it", async () => {
    const { host, received, send } = scripted()
    send(initialize)
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x" } })
    send({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 1, height: 1 },
    })
    await flush()
    expect(received[1]).toMatchObject({
      kind: "error",
      id: 2,
      error: { code: errorCodes.refused },
    })
    expect(host.violations).toEqual([
      { kind: "before-initialized", method: "tools/call" },
      { kind: "before-initialized", method: "ui/notifications/size-changed" },
    ])
    expect(host.sizes).toEqual([])
  })

  it("refuses to send the app anything before initialized", async () => {
    const { host } = scripted()
    expect(() => host.sendToolInput({})).toThrow(FakeHostMisuse)
    expect(() => host.changeContext({ theme: "dark" })).toThrow(FakeHostMisuse)
    await expect(host.teardown()).rejects.toThrow(FakeHostMisuse)
    await expect(host.ping()).rejects.toThrow(FakeHostMisuse)
  })
})

describe("the app's requests", () => {
  it("records an unknown method and an invalid message", async () => {
    const { host, received, send } = await initialized()
    send({ jsonrpc: "2.0", id: 5, method: "sampling/createMessage", params: {} })
    send({ hello: 1 })
    await flush()
    expect(received.at(-1)).toMatchObject({
      kind: "error",
      error: { code: errorCodes.methodNotFound },
    })
    expect(host.violations).toEqual([
      { kind: "unknown-method", method: "sampling/createMessage" },
      { kind: "invalid-message", reason: 'jsonrpc is not "2.0"' },
    ])
  })

  it("refuses malformed params, each method its own way", async () => {
    const { host, send } = await initialized()
    const malformed: [string, unknown][] = [
      ["tools/call", { arguments: {} }],
      ["tools/call", { name: "x", arguments: [] }],
      ["resources/read", {}],
      ["ui/message", { role: "user" }],
      ["ui/update-model-context", "x"],
      ["ui/open-link", { url: 1 }],
      ["ui/request-display-mode", { mode: "tv" }],
    ]
    malformed.forEach(([method, params], index) =>
      send({ jsonrpc: "2.0", id: 10 + index, method, params }),
    )
    await flush()
    expect(host.violations.map((v) => v.kind)).toEqual(
      malformed.map(() => "malformed-params"),
    )
  })

  it("refuses tools/call and resources/read by default: it has no server", async () => {
    const { received, send } = await initialized()
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x" } })
    send({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "ui://x" } })
    await flush()
    expect(received.slice(-2)).toMatchObject([
      { kind: "error", id: 2, error: { code: errorCodes.methodNotFound } },
      { kind: "error", id: 3, error: { code: errorCodes.methodNotFound } },
    ])
  })

  it("records messages, model context, links, sizes and logs", async () => {
    const { host, send } = await initialized()
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/message",
      params: { role: "user", content: [{ type: "text", text: "hi" }] },
    })
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "ui/update-model-context",
      params: { structuredContent: { a: 1 } },
    })
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "ui/open-link",
      params: { url: "https://example.com" },
    })
    send({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 10, height: 20 },
    })
    send({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: "10" },
    })
    send({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: Number.NaN, height: Number.POSITIVE_INFINITY },
    })
    send({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: "x" },
    })
    send({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "shout", data: "x" },
    })
    send({ jsonrpc: "2.0", method: "ui/notifications/whatever" })
    await flush()
    expect(host.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ])
    expect(host.modelContext).toEqual({ structuredContent: { a: 1 } })
    expect(host.links).toEqual(["https://example.com"])
    expect(host.sizes).toEqual([{ width: 10, height: 20 }])
    expect(host.logs).toEqual([{ level: "info", data: "x" }])
    expect(host.violations.map((v) => v.kind)).toEqual([
      "malformed-params",
      "malformed-params",
      "malformed-params",
      "unknown-method",
    ])
  })

  it("a handler's HostRefusal becomes the error the app receives", async () => {
    const { received, send } = await initialized({
      handlers: {
        openLink: () => {
          throw new HostRefusal("Link opening denied by user")
        },
      },
    })
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/open-link",
      params: { url: "https://example.com" },
    })
    await flush()
    expect(received.at(-1)).toEqual({
      kind: "error",
      id: 2,
      error: { code: errorCodes.refused, message: "Link opening denied by user" },
    })
  })

  it("display mode: switches to a mode both sides declared and says so, otherwise keeps the current one", async () => {
    const channel = memoryChannel()
    const host = createFakeHost({
      transport: channel.host,
      context: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    const bridge = createBridge({
      transport: channel.app,
      app: { name: "a", version: "1" },
      displayModes: ["inline", "fullscreen", "pip"],
      onViolation: () => {},
    })
    await bridge.connect()
    await host.initialized
    await expect(bridge.requestDisplayMode("fullscreen")).resolves.toBe("fullscreen")
    expect(host.context.displayMode).toBe("fullscreen")
    expect(bridge.getState().hostContext.displayMode).toBe("fullscreen")
    // pip: declared by the app, not offered by the host; refused by the bridge before sending.
    await expect(bridge.requestDisplayMode("pip")).rejects.toBeInstanceOf(BridgeError)
  })

  it("records a display mode the app did not declare, and keeps the current mode", async () => {
    const { host, received, send } = await initialized({
      context: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/request-display-mode",
      params: { mode: "fullscreen" },
    })
    await flush()
    expect(host.violations).toEqual([
      { kind: "undeclared-display-mode", mode: "fullscreen" },
    ])
    expect(received.at(-1)).toEqual({ kind: "result", id: 2, result: { mode: "inline" } })
  })
})

describe("what the host sends", () => {
  it("changeContext merges into its context and sends the change alone", async () => {
    const { host, received } = await initialized({
      context: { theme: "light", locale: "en" },
    })
    host.changeContext({ theme: "dark" })
    await flush()
    expect(host.context).toMatchObject({ theme: "dark", locale: "en" })
    expect(received.at(-1)).toEqual({
      kind: "notification",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    })
  })

  it("teardown resolves with the app's answer, then records what comes after", async () => {
    const { host, received, send } = await initialized()
    const teardown = host.teardown("done")
    await flush()
    const request = received.at(-1)
    expect(request).toMatchObject({
      kind: "request",
      method: "ui/resource-teardown",
      params: { reason: "done" },
    })
    if (request?.kind !== "request") throw new Error("no teardown request")
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: "Teardown error" },
    })
    await expect(teardown).resolves.toEqual({
      ok: false,
      code: -32000,
      message: "Teardown error",
    })
    expect(host.stage).toBe("torn-down")
    send({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 1, height: 1 },
    })
    await flush()
    expect(host.violations).toEqual([
      { kind: "after-teardown", method: "ui/notifications/size-changed" },
    ])
  })

  it("ping resolves when the app answers", async () => {
    const channel = memoryChannel()
    const host = createFakeHost({ transport: channel.host })
    const bridge = createBridge({
      transport: channel.app,
      app: { name: "a", version: "1" },
    })
    await bridge.connect()
    await host.initialized
    await expect(host.ping()).resolves.toBeUndefined()
  })

  it("close stops it hearing the app", async () => {
    const { host, send } = scripted()
    host.close()
    send(initialize)
    await flush()
    expect(host.log).toEqual([])
  })
})
