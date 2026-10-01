/**
 * Conformance against the standard's lifecycle (SEP-1865, "Lifecycle"):
 * initialization, the tool's input and result, the interactive phase, and
 * cleanup, in that order.
 *
 * Three pairings, so neither half of this package only agrees with itself:
 * this package's bridge with its fake host; its bridge with the standard's
 * reference host (`AppBridge`); and the standard's reference app (`App`) with
 * its fake host. Every message the bridge sends is also read by the
 * reference SDK's schema for its method.
 */
import {
  App,
  McpUiInitializeRequestSchema,
  McpUiInitializedNotificationSchema,
  McpUiMessageRequestSchema,
  McpUiOpenLinkRequestSchema,
  McpUiRequestDisplayModeRequestSchema,
  McpUiSizeChangedNotificationSchema,
  McpUiUpdateModelContextRequestSchema,
} from "@modelcontextprotocol/ext-apps"
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge"
import { describe, expect, it } from "vitest"

import { createBridge } from "../bridge/bridge.ts"
import { createFakeHost } from "../fake-host/fake-host.ts"
import { memoryChannel } from "../protocol/memory-channel.ts"
import { isRecord } from "../protocol/narrow.ts"
import { referenceTransport } from "./reference-transport.ts"

const app = { name: "fixture", version: "1.0.0" }
const result = {
  content: [{ type: "text" as const, text: "72°F and sunny" }],
  structuredContent: { temperature: 72 },
}

/** Lets every message in flight arrive. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Each logged message as `direction method` or `direction (answer)`. */
function sequence(log: readonly { direction: string; message: unknown }[]) {
  return log.map(({ direction, message }) => {
    const arrow = direction === "app-to-host" ? "app→host" : "host→app"
    if (isRecord(message) && typeof message.method === "string") {
      return `${arrow} ${message.method}`
    }
    return `${arrow} ${isRecord(message) && "error" in message ? "(error)" : "(result)"}`
  })
}

describe("the lifecycle, bridge and fake host", () => {
  it("plays initialization, tool input, result, the interactive phase, and teardown in order", async () => {
    const channel = memoryChannel()
    const host = createFakeHost({
      transport: channel.host,
      context: { theme: "dark", availableDisplayModes: ["inline", "fullscreen"] },
      tool: {
        partials: [{ city: "San" }],
        input: { city: "San Francisco" },
        outcome: { result },
      },
    })
    const bridge = createBridge({
      transport: channel.app,
      app,
      displayModes: ["inline", "fullscreen"],
    })
    let tornDownWith: string | undefined
    bridge.onTeardown((reason) => {
      tornDownWith = reason
    })

    await bridge.connect()
    await settle()
    expect(bridge.getState().toolCall).toEqual({
      phase: "complete",
      input: { city: "San Francisco" },
      result,
    })

    await bridge.sendMessage([{ type: "text", text: "Tell me more" }])
    await bridge.updateModelContext({ structuredContent: { city: "San Francisco" } })
    await expect(bridge.requestDisplayMode("fullscreen")).resolves.toBe("fullscreen")
    await bridge.openLink("https://example.com/forecast")
    bridge.reportSize({ width: 400, height: 300 })
    await settle()
    expect(host.sizes).toEqual([{ width: 400, height: 300 }])
    await expect(host.teardown("closed by the person")).resolves.toEqual({ ok: true })

    expect(tornDownWith).toBe("closed by the person")
    expect(host.violations).toEqual([])
    expect(sequence(host.log)).toEqual([
      "app→host ui/initialize",
      "host→app (result)",
      "app→host ui/notifications/initialized",
      "host→app ui/notifications/tool-input-partial",
      "host→app ui/notifications/tool-input",
      "host→app ui/notifications/tool-result",
      "app→host ui/message",
      "host→app (result)",
      "app→host ui/update-model-context",
      "host→app (result)",
      "app→host ui/request-display-mode",
      "host→app ui/notifications/host-context-changed",
      "host→app (result)",
      "app→host ui/open-link",
      "host→app (result)",
      "app→host ui/notifications/size-changed",
      "host→app ui/resource-teardown",
      "app→host (result)",
    ])
  })

  it("sends each message in the shape the reference SDK's schema reads", async () => {
    const channel = memoryChannel()
    const host = createFakeHost({
      transport: channel.host,
      context: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    const bridge = createBridge({
      transport: channel.app,
      app,
      displayModes: ["inline", "fullscreen"],
    })
    await bridge.connect()
    await settle()
    await bridge.sendMessage([{ type: "text", text: "hi" }], {
      openai: { target: "new" },
    })
    await bridge.updateModelContext({ content: [{ type: "text", text: "context" }] })
    await bridge.requestDisplayMode("fullscreen")
    await bridge.openLink("https://example.com")
    bridge.reportSize({ width: 1, height: 2 })
    await settle()

    const schemas = {
      "ui/initialize": McpUiInitializeRequestSchema,
      "ui/notifications/initialized": McpUiInitializedNotificationSchema,
      "ui/message": McpUiMessageRequestSchema,
      "ui/update-model-context": McpUiUpdateModelContextRequestSchema,
      "ui/request-display-mode": McpUiRequestDisplayModeRequestSchema,
      "ui/open-link": McpUiOpenLinkRequestSchema,
      "ui/notifications/size-changed": McpUiSizeChangedNotificationSchema,
    }
    const sent = host.log.filter((entry) => entry.direction === "app-to-host")
    expect(sent).toHaveLength(Object.keys(schemas).length)
    for (const { message } of sent) {
      const method = isRecord(message) ? message.method : undefined
      expect(typeof method === "string" && Object.hasOwn(schemas, method)).toBe(true)
      const schema = schemas[method as keyof typeof schemas]
      expect(schema.safeParse(message).success, String(method)).toBe(true)
    }
  })
})

describe("the bridge with the reference host (AppBridge)", () => {
  it("connects, receives the tool call and context changes, calls through, and is torn down", async () => {
    const channel = memoryChannel()
    const reference = new AppBridge(
      null,
      { name: "reference-host", version: "1.0.0" },
      { serverTools: {}, openLinks: {} },
      {
        hostContext: {
          theme: "light",
          displayMode: "inline",
          availableDisplayModes: ["inline"],
        },
      },
    )
    const calls: unknown[] = []
    reference.oncalltool = async (params) => {
      calls.push(params)
      return { content: [{ type: "text", text: "done" }] }
    }
    let initialized = false
    reference.oninitialized = () => {
      initialized = true
    }
    await reference.connect(referenceTransport(channel.host))

    const bridge = createBridge({ transport: channel.app, app })
    await bridge.connect()
    await settle()
    expect(initialized).toBe(true)
    const connection = bridge.getState().connection
    expect(connection.status === "connected" && connection.host.name).toBe(
      "reference-host",
    )
    expect(bridge.getState().hostContext.theme).toBe("light")

    await reference.sendToolInput({ arguments: { city: "Oslo" } })
    await reference.sendToolResult(result)
    await reference.sendHostContextChange({ theme: "dark" })
    await settle()
    expect(bridge.getState().toolCall).toEqual({
      phase: "complete",
      input: { city: "Oslo" },
      result,
    })
    expect(bridge.getState().hostContext).toMatchObject({
      theme: "dark",
      displayMode: "inline",
    })

    await expect(bridge.callTool("refresh", { city: "Oslo" })).resolves.toEqual({
      content: [{ type: "text", text: "done" }],
    })
    expect(calls).toEqual([{ name: "refresh", arguments: { city: "Oslo" } }])

    let tornDown = false
    bridge.onTeardown(() => {
      tornDown = true
    })
    await reference.teardownResource({})
    expect(tornDown).toBe(true)
    expect(bridge.getState().connection.status).toBe("torn-down")
  })
})

describe("the reference app (App) with the fake host", () => {
  it("is initialized, receives the tool call, calls through, and is torn down", async () => {
    const channel = memoryChannel()
    const host = createFakeHost({
      transport: channel.host,
      context: { theme: "dark" },
      tool: { input: { city: "Lima" }, outcome: { result } },
      handlers: {
        callTool: ({ name }) => ({ content: [{ type: "text", text: `called ${name}` }] }),
      },
    })
    const reference = new App(
      app,
      { availableDisplayModes: ["inline"] },
      { autoResize: false },
    )
    const inputs: unknown[] = []
    const results: unknown[] = []
    reference.ontoolinput = (params) => inputs.push(params)
    reference.ontoolresult = (params) => results.push(params)
    let tornDown = false
    reference.onteardown = async () => {
      tornDown = true
      return {}
    }
    await reference.connect(referenceTransport(channel.app))
    await host.initialized
    await settle()

    expect(host.app?.info).toEqual(app)
    expect(reference.getHostContext()?.theme).toBe("dark")
    expect(inputs).toEqual([{ arguments: { city: "Lima" } }])
    expect(results).toEqual([result])
    await expect(
      reference.callServerTool({ name: "refresh", arguments: {} }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "called refresh" }],
    })
    await expect(host.teardown("done")).resolves.toEqual({ ok: true })
    expect(tornDown).toBe(true)
    expect(host.violations).toEqual([])
  })
})
