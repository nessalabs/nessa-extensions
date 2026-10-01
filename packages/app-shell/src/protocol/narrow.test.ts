import { describe, expect, it } from "vitest"

import { styleVariables } from "./messages.ts"
import {
  narrowAcknowledgement,
  narrowCallToolResult,
  narrowDisplayModeResult,
  narrowHostContext,
  narrowInitializeParams,
  narrowInitializeResult,
  narrowLogParams,
  narrowMessageParams,
  narrowModelContextParams,
  narrowReadResourceResult,
  narrowReason,
  narrowToolArguments,
} from "./narrow.ts"

describe("narrowHostContext", () => {
  it("keeps every standard field in its shape", () => {
    const context = {
      toolInfo: {
        id: 3,
        tool: { name: "weather", description: "d", inputSchema: { type: "object" } },
      },
      theme: "dark",
      styles: {
        variables: { "--color-text-primary": "#fff", "--font-sans": "Inter" },
        css: { fonts: "@font-face {}" },
      },
      displayMode: "fullscreen",
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: { width: 400, maxHeight: 600 },
      locale: "en-US",
      timeZone: "Europe/Oslo",
      userAgent: "host/1",
      platform: "desktop",
      deviceCapabilities: { touch: false, hover: true },
      safeAreaInsets: { top: 1, right: 2, bottom: 3, left: 4 },
      "openai/modelContext": { updateId: "u1", content: [{ type: "text", text: "x" }] },
    }
    expect(narrowHostContext(context)).toEqual({ ok: true, value: context, dropped: [] })
  })

  it("drops malformed fields by path and keeps the rest", () => {
    const read = narrowHostContext({
      theme: "sepia",
      displayMode: "sideways",
      availableDisplayModes: ["inline", "pip", 7, "inline"],
      locale: 5,
      platform: "watch",
      toolInfo: { tool: {} },
      safeAreaInsets: { top: 1 },
      styles: {
        variables: { "--color-text-primary": 1, "--unknown": "x", "--font-mono": "m" },
      },
      "openai/modelContext": { updateId: "" },
      somethingElse: true,
    })
    expect(read).toEqual({
      ok: true,
      value: {
        availableDisplayModes: ["inline", "pip"],
        styles: { variables: { "--font-mono": "m" } },
      },
      dropped: [
        "hostContext.toolInfo",
        "hostContext.theme",
        "hostContext.styles.variables.--color-text-primary",
        "hostContext.styles.variables.--unknown",
        "hostContext.displayMode",
        "hostContext.availableDisplayModes[2]",
        "hostContext.locale",
        "hostContext.platform",
        "hostContext.safeAreaInsets",
        "hostContext.openai/modelContext",
      ],
    })
  })

  it("leaves out a malformed member of a nested object without listing it", () => {
    expect(
      narrowHostContext({
        containerDimensions: { height: "big" },
        deviceCapabilities: { touch: "yes", hover: true },
      }),
    ).toEqual({
      ok: true,
      value: { containerDimensions: {}, deviceCapabilities: { hover: true } },
      dropped: [],
    })
  })

  it("keeps an openai model context of null: cleared", () => {
    expect(narrowHostContext({ "openai/modelContext": null })).toMatchObject({
      value: { "openai/modelContext": null },
    })
  })

  it("takes the fixed and flexible container dimensions the standard allows", () => {
    expect(
      narrowHostContext({ containerDimensions: { height: 5, maxWidth: 9 } }),
    ).toMatchObject({
      value: { containerDimensions: { height: 5, maxWidth: 9 } },
    })
    expect(narrowHostContext({ containerDimensions: {} })).toMatchObject({
      value: { containerDimensions: {} },
    })
  })

  it("takes every standardized style variable", () => {
    const variables = Object.fromEntries(styleVariables.map((name) => [name, "v"]))
    expect(narrowHostContext({ styles: { variables } })).toMatchObject({
      value: { styles: { variables } },
      dropped: [],
    })
  })

  it("does not read an inherited field", () => {
    const context = Object.create({ theme: "dark" }) as object
    expect(narrowHostContext(context)).toEqual({ ok: true, value: {}, dropped: [] })
  })

  it("an own __proto__ key, as postMessage delivers one, never becomes a prototype", () => {
    // JSON.parse and structured clone both keep "__proto__" as an own key.
    const result = structuredClone(
      JSON.parse(
        '{"protocolVersion":"v","hostInfo":{"name":"h","version":"1"},' +
          '"hostCapabilities":{"experimental":{"__proto__":{"polluted":{}}}},' +
          '"hostContext":{"__proto__":{"theme":"dark"}}}',
      ),
    )
    const read = narrowInitializeResult(result)
    if (!read.ok) throw new Error(read.reason)
    const experimental = read.value.hostCapabilities.experimental ?? {}
    expect(Object.getPrototypeOf(experimental)).toBe(Object.prototype)
    expect("polluted" in experimental).toBe(false)
    expect(read.value.hostContext.theme).toBeUndefined()
  })

  it("refuses a context that is not an object", () => {
    expect(narrowHostContext([])).toEqual({
      ok: false,
      reason: "hostContext is not an object",
    })
  })
})

describe("narrowInitializeResult", () => {
  const result = {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "h", version: "1" },
    hostCapabilities: {
      experimental: { "openai/message": {}, bad: 1 },
      openLinks: {},
      serverTools: { listChanged: true },
      serverResources: {},
      logging: {},
      sandbox: {
        permissions: { camera: {}, microphone: true },
        csp: { connectDomains: ["https://a.example", 3] },
      },
      updateModelContext: { text: {}, image: {} },
      message: { text: {} },
    },
    hostContext: { theme: "light" },
  }

  it("keeps the host, each capability in its shape, and the context", () => {
    expect(narrowInitializeResult(result)).toEqual({
      ok: true,
      value: {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "h", version: "1" },
        hostCapabilities: {
          experimental: { "openai/message": {} },
          openLinks: {},
          serverTools: { listChanged: true },
          serverResources: {},
          logging: {},
          sandbox: {
            permissions: { camera: {} },
            csp: { connectDomains: ["https://a.example"] },
          },
          updateModelContext: { text: {}, image: {} },
          message: { text: {} },
        },
        hostContext: { theme: "light" },
      },
      dropped: [],
    })
  })

  it("is connected with an empty context and capabilities when the host sends none", () => {
    expect(
      narrowInitializeResult({
        protocolVersion: "v",
        hostInfo: { name: "h", version: "1" },
      }),
    ).toEqual({
      ok: true,
      value: {
        protocolVersion: "v",
        hostInfo: { name: "h", version: "1" },
        hostCapabilities: {},
        hostContext: {},
      },
      dropped: ["hostCapabilities"],
    })
  })

  it("reports a malformed capability or context and keeps going", () => {
    const read = narrowInitializeResult({
      ...result,
      hostCapabilities: { openLinks: true },
      hostContext: "dark",
    })
    expect(read).toMatchObject({
      ok: true,
      dropped: ["hostCapabilities.openLinks", "hostContext"],
    })
  })

  it("refuses a result without a version or host", () => {
    expect(narrowInitializeResult({ hostInfo: { name: "h", version: "1" } })).toEqual({
      ok: false,
      reason: "protocolVersion is not a string",
    })
    expect(
      narrowInitializeResult({ protocolVersion: "v", hostInfo: { name: "h" } }),
    ).toEqual({
      ok: false,
      reason: "hostInfo has no name and version",
    })
    expect(narrowInitializeResult(null)).toEqual({
      ok: false,
      reason: "the result is not an object",
    })
  })
})

describe("narrowCallToolResult", () => {
  it("keeps each of MCP's content blocks, structured content, isError and _meta", () => {
    const result = {
      content: [
        { type: "text", text: "t", _meta: { m: 1 } },
        { type: "image", data: "aGk=", mimeType: "image/png" },
        { type: "audio", data: "aGk=", mimeType: "audio/wav" },
        {
          type: "resource_link",
          uri: "file:///a",
          name: "a",
          title: "A",
          mimeType: "text/plain",
        },
        {
          type: "resource",
          resource: { uri: "file:///b", text: "b", mimeType: "text/plain" },
        },
        { type: "resource", resource: { uri: "file:///c", blob: "Yw==" } },
      ],
      structuredContent: { temperature: 72 },
      isError: false,
      _meta: { source: "api" },
    }
    expect(narrowCallToolResult(result)).toEqual({ ok: true, value: result, dropped: [] })
  })

  it("drops a malformed block or field and keeps the rest", () => {
    expect(
      narrowCallToolResult({
        content: [
          { type: "text" },
          { type: "video", src: "x" },
          { type: "resource", resource: { uri: "u", text: "t", blob: "b" } },
          "text",
          { type: "text", text: "ok" },
        ],
        structuredContent: [1],
        isError: "yes",
      }),
    ).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: "ok" }] },
      dropped: [
        "content[0]",
        "content[1]",
        "content[2]",
        "content[3]",
        "structuredContent",
        "isError",
      ],
    })
  })

  it("refuses a result whose content is not an array", () => {
    expect(narrowCallToolResult({})).toEqual({
      ok: false,
      reason: "content is not an array",
    })
  })
})

describe("the rest of the host's params and results", () => {
  it("narrowReadResourceResult", () => {
    expect(
      narrowReadResourceResult({ contents: [{ uri: "ui://a", text: "x" }, { uri: 1 }] }),
    ).toEqual({
      ok: true,
      value: { contents: [{ uri: "ui://a", text: "x" }] },
      dropped: ["contents[1]"],
    })
    expect(narrowReadResourceResult({ contents: {} })).toEqual({
      ok: false,
      reason: "contents is not an array",
    })
  })

  it("narrowToolArguments: absent params or arguments are none", () => {
    expect(narrowToolArguments(undefined)).toMatchObject({ value: { arguments: {} } })
    expect(narrowToolArguments({})).toMatchObject({ value: { arguments: {} } })
    expect(narrowToolArguments({ arguments: { a: 1 } })).toMatchObject({
      value: { arguments: { a: 1 } },
    })
    expect(narrowToolArguments({ arguments: [1] })).toEqual({
      ok: false,
      reason: "arguments is not an object",
    })
    expect(narrowToolArguments("x")).toEqual({
      ok: false,
      reason: "params is not an object",
    })
  })

  it("narrowReason: optional, a non-string one dropped", () => {
    expect(narrowReason(undefined)).toMatchObject({ value: {} })
    expect(narrowReason({ reason: "r" })).toMatchObject({ value: { reason: "r" } })
    expect(narrowReason({ reason: 1 })).toEqual({
      ok: true,
      value: {},
      dropped: ["reason"],
    })
    expect(narrowReason(1)).toEqual({ ok: false, reason: "params is not an object" })
  })

  it("narrowDisplayModeResult", () => {
    expect(narrowDisplayModeResult({ mode: "pip" })).toMatchObject({
      value: { mode: "pip" },
    })
    expect(narrowDisplayModeResult({ mode: "huge" })).toEqual({
      ok: false,
      reason: "mode is not a display mode",
    })
  })

  it("narrowAcknowledgement: refused only on isError true", () => {
    expect(narrowAcknowledgement({})).toMatchObject({ value: { refused: false } })
    expect(narrowAcknowledgement({ isError: true })).toMatchObject({
      value: { refused: true },
    })
    expect(narrowAcknowledgement({ isError: "true" })).toMatchObject({
      value: { refused: false },
    })
    expect(narrowAcknowledgement(null)).toEqual({
      ok: false,
      reason: "the result is not an object",
    })
  })
})

describe("what the app sends, as a host reads it", () => {
  it("narrowInitializeParams", () => {
    expect(
      narrowInitializeParams({
        appInfo: { name: "a", version: "1" },
        appCapabilities: { availableDisplayModes: ["inline", "tv"] },
        protocolVersion: "2026-01-26",
      }),
    ).toEqual({
      ok: true,
      value: {
        appInfo: { name: "a", version: "1" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: "2026-01-26",
      },
      dropped: ["appCapabilities.availableDisplayModes[1]"],
    })
    expect(narrowInitializeParams({ appInfo: { name: "a", version: "1" } })).toEqual({
      ok: false,
      reason: "protocolVersion is not a string",
    })
    expect(
      narrowInitializeParams({
        appInfo: { name: "a", version: "1" },
        protocolVersion: "v",
      }),
    ).toEqual({ ok: false, reason: "appCapabilities is not an object" })
  })

  it("narrowMessageParams, with OpenAI's options typed and checked", () => {
    const content = [{ type: "text", text: "hi" }]
    expect(narrowMessageParams({ role: "user", content })).toEqual({
      ok: true,
      value: { role: "user", content },
      dropped: [],
    })
    expect(
      narrowMessageParams({
        role: "user",
        content,
        _meta: { "openai/message": { target: "new", send: true } },
      }),
    ).toMatchObject({
      value: { _meta: { "openai/message": { target: "new", send: true } } },
    })
    expect(
      narrowMessageParams({
        role: "user",
        content,
        _meta: { "openai/message": { target: "x" } },
      }),
    ).toEqual({
      ok: true,
      value: { role: "user", content },
      dropped: ["_meta.openai/message"],
    })
    expect(narrowMessageParams({ role: "assistant", content })).toEqual({
      ok: false,
      reason: 'role is not "user"',
    })
  })

  it("narrowModelContextParams", () => {
    expect(narrowModelContextParams({ structuredContent: { a: 1 } })).toMatchObject({
      value: { structuredContent: { a: 1 } },
    })
    expect(narrowModelContextParams({ content: "x" })).toEqual({
      ok: true,
      value: {},
      dropped: ["content"],
    })
  })

  it("narrowLogParams", () => {
    expect(narrowLogParams({ level: "info", data: 1, logger: "l" })).toMatchObject({
      value: { level: "info", data: 1, logger: "l" },
    })
    expect(narrowLogParams({ level: "loud", data: 1 })).toEqual({
      ok: false,
      reason: "level is not a log level",
    })
    expect(narrowLogParams({ level: "info" })).toEqual({
      ok: false,
      reason: "a log has no data",
    })
  })
})
