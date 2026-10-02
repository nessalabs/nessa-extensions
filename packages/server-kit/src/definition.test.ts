import { describe, expect, it } from "vitest"
import { z } from "zod/v4"

import {
  checkedOf,
  DefinitionError,
  defineExtension,
  defineTool,
  toolAnnotations,
  type ExtensionDefinition,
  type Tool,
  type ToolDefinition,
  type ViewDefinition,
} from "./definition.ts"

const view = (uri: string, ui?: ViewDefinition["ui"]): ViewDefinition => ({
  uri: uri as ViewDefinition["uri"],
  name: "view",
  html: () => "<!doctype html>",
  ...(ui === undefined ? {} : { ui }),
})

const tool = (overrides: Partial<ToolDefinition> = {}): Tool =>
  defineTool({
    name: "tool",
    description: "A tool",
    input: z.object({}),
    effects: "read-only",
    run: () => ({ text: "done" }),
    ...overrides,
  })

const extension = (
  views: readonly ViewDefinition[],
  tools: readonly Tool[],
): ExtensionDefinition => ({ name: "probe", version: "0.0.0", views, tools })

function problemsOf(definition: ExtensionDefinition): string[] {
  try {
    defineExtension(definition)
    return []
  } catch (error) {
    expect(error).toBeInstanceOf(DefinitionError)
    return (error as Error).message.split("\n- ").slice(1)
  }
}

const cspKeys = [
  "connectDomains",
  "resourceDomains",
  "frameDomains",
  "baseUriDomains",
] as const

describe("defineExtension", () => {
  it("makes a valid definition an extension, with each tool's input as JSON Schema", () => {
    const definition = extension(
      [view("ui://probe/a")],
      [
        tool({
          input: z.object({ rows: z.number().int().optional() }),
          view: "ui://probe/a",
        }),
      ],
    )
    const made = defineExtension(definition)
    expect(made).toMatchObject(definition)
    expect(checkedOf(made).inputSchemas.get("tool")).toMatchObject({
      type: "object",
      properties: { rows: { type: "integer" } },
    })
  })

  it.each([
    ["https://probe/a", 'view "https://probe/a" is not a ui:// URI with a host'],
    ["ui://", 'view "ui://" is not a ui:// URI with a host'],
    ["ui:///path-only", 'view "ui:///path-only" is not a ui:// URI with a host'],
  ])("refuses view URI %s", (uri, problem) => {
    expect(problemsOf(extension([view(uri)], []))).toEqual([problem])
  })

  it("refuses a view declared twice, or with an empty name", () => {
    expect(
      problemsOf(extension([view("ui://probe/a"), view("ui://probe/a")], [])),
    ).toEqual(["view ui://probe/a is declared twice"])
    expect(problemsOf(extension([{ ...view("ui://probe/a"), name: "" }], []))).toEqual([
      "view ui://probe/a has an empty name",
    ])
  })

  it.each([
    "https://api.example.com",
    "https://*.example.com",
    "wss://realtime.example.com:8443",
    "ws://localhost:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ])("takes CSP origin %s", (origin) => {
    const csp = Object.fromEntries(cspKeys.map((key) => [key, [origin]]))
    expect(problemsOf(extension([view("ui://probe/a", { csp })], []))).toEqual([])
  })

  it.each([
    "api.example.com",
    "https://api.example.com/path",
    "https://api.example.com/",
    "https://api.example.com?q=1",
    "https://api.example.com#x",
    "https://user@api.example.com",
    "https://user:secret@api.example.com",
    "https://api.example.com\\evil.example",
    "https://exa mple.com",
    "https://",
    "*",
    "https://*",
    "https://*.",
    "https://*.com",
    "https://a.com.",
    "https://API.example.com",
    "https://api.example.com:443",
    "http://a.com;script-src",
    "javascript://x",
    "data://x",
    "ftp://files.example.com",
    "https://*.1.2.3.4",
    "https://*.[::1]",
  ])("refuses CSP domain %s in every list", (domain) => {
    const csp = Object.fromEntries(cspKeys.map((key) => [key, [domain]]))
    expect(problemsOf(extension([view("ui://probe/a", { csp })], []))).toEqual(
      cspKeys.map(
        (key) =>
          `view ui://probe/a: csp.${key} ${JSON.stringify(domain)} is not an origin`,
      ),
    )
  })

  it.each(["", "has space", "slash/name", "a".repeat(129), "naïve"])(
    "refuses tool name %j",
    (name) => {
      expect(problemsOf(extension([], [tool({ name })]))).toEqual([
        `tool ${JSON.stringify(name)} is not 1 to 128 letters, digits, "_", "-" or "."`,
      ])
    },
  )

  it.each(["show_board", "ns.tool-1", "A".repeat(128)])("takes tool name %j", (name) => {
    expect(problemsOf(extension([], [tool({ name })]))).toEqual([])
  })

  it("refuses a tool declared twice", () => {
    expect(problemsOf(extension([], [tool(), tool()]))).toEqual([
      'tool "tool" is declared twice',
    ])
  })

  it("refuses a tool naming a view that is not declared", () => {
    expect(
      problemsOf(extension([view("ui://probe/a")], [tool({ view: "ui://probe/b" })])),
    ).toEqual(['tool "tool" names view ui://probe/b, which is not declared'])
  })

  it("refuses callers that are empty, repeated, or unknown", () => {
    expect(
      problemsOf(extension([view("ui://probe/a")], [tool({ callers: [] })])),
    ).toEqual(['tool "tool" has no callers'])
    expect(
      problemsOf(extension([view("ui://probe/a")], [tool({ callers: ["app", "app"] })])),
    ).toEqual(['tool "tool" lists a caller twice'])
    expect(
      problemsOf(
        extension([view("ui://probe/a")], [tool({ callers: ["user" as "app"] })]),
      ),
    ).toEqual(['tool "tool" lists caller "user"'])
  })

  it("refuses a tool only the app may call when there is no view to call it from", () => {
    expect(problemsOf(extension([], [tool({ callers: ["app"] })]))).toEqual([
      'tool "tool" is only for the app, and the extension has no view',
    ])
    expect(
      problemsOf(extension([view("ui://probe/a")], [tool({ callers: ["app"] })])),
    ).toEqual([])
  })

  it("refuses an input JSON Schema cannot describe", () => {
    expect(
      problemsOf(extension([], [tool({ input: z.object({ at: z.date() }) })])),
    ).toEqual([
      expect.stringMatching(/^tool "tool" has an input JSON Schema cannot describe: .+/),
    ])
  })

  it("names every problem at once, and the extension", () => {
    const broken = extension(
      [view("x")],
      [tool({ name: "" }), tool({ view: "ui://probe/z" })],
    )
    expect(() => defineExtension(broken)).toThrow(/^probe is not a valid extension:\n- /)
    expect(problemsOf(broken)).toHaveLength(3)
  })
})

describe("a definition of the wrong shape", () => {
  /** The problems `defineExtension` names for `definition`, as an untyped caller could write it. */
  const shapeProblems = (definition: unknown) =>
    problemsOf(definition as ExtensionDefinition)
  const base = { name: "probe", version: "0.0.0", views: [], tools: [] }

  it.each([
    [{ ...base, name: "" }, "name: is empty"],
    [{ ...base, version: "" }, "version: is empty"],
    [{ ...base, extra: true }, "the definition: Unrecognized key"],
    [
      { ...base, views: [{ ...view("ui://probe/a"), uri: 7 }] },
      "views[0].uri: is not a string",
    ],
    [
      { ...base, views: [{ uri: "ui://probe/a", html: (): string => "" }] },
      "views[0].name: Invalid input",
    ],
    [
      { ...base, views: [{ ...view("ui://probe/a"), html: "<p>" }] },
      "views[0].html: is not a function",
    ],
    [
      { ...base, views: [view("ui://probe/a", { prefersBorder: "yes" } as never)] },
      "views[0].ui.prefersBorder: Invalid input",
    ],
    [
      {
        ...base,
        views: [
          view("ui://probe/a", { csp: { scriptDomains: ["javascript:x"] } } as never),
        ],
      },
      "views[0].ui.csp: Unrecognized key",
    ],
    [
      {
        ...base,
        views: [
          view("ui://probe/a", { csp: { connectDomains: "https://a.com" } } as never),
        ],
      },
      "views[0].ui.csp.connectDomains: Invalid input",
    ],
    [
      {
        ...base,
        views: [view("ui://probe/a", { permissions: { camera: {}, usb: {} } } as never)],
      },
      "views[0].ui.permissions: Unrecognized key",
    ],
    [
      { ...base, views: [view("ui://probe/a", { open: () => 1 } as never)] },
      "views[0].ui: Unrecognized key",
    ],
    [
      { ...base, tools: [tool({ effects: "bogus" as "read-only" })] },
      "tools[0]: is not a valid tool",
    ],
  ])("is refused as a DefinitionError naming where: %#", (definition, problem) => {
    const problems = shapeProblems(definition)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(problem)
  })
})

describe("what defineExtension checked is what is served", () => {
  const made = () => tool({ name: "kept" })

  it("refuses a tool copied, rather than made, by defineTool", () => {
    const copied = { ...made(), input: z.object({ at: z.date() }) } as Tool
    expect(problemsOf(extension([], [copied]))).toEqual([
      'tool "kept" was not made by defineTool',
    ])
  })

  it("keeps its own copy, whatever the caller does to its arrays afterwards", () => {
    const tools = [made()]
    const views = [view("ui://probe/a")]
    const checked = defineExtension(extension(views, tools))
    tools.push({ ...made(), name: "pushed" } as Tool)
    views.push(view("ui://probe/b"))
    expect(checkedOf(checked).tools.map((each) => each.name)).toEqual(["kept"])
    expect(checkedOf(checked).views.map((each) => each.uri)).toEqual(["ui://probe/a"])
    expect(Object.isFrozen(checked.tools) && Object.isFrozen(checked.views)).toBe(true)
  })

  it("keeps its own copy of a view, so changing the caller's object changes nothing", () => {
    const mine = view("ui://probe/a")
    const checked = defineExtension(extension([mine], []))
    ;(mine as { name: string }).name = "changed"
    expect(checkedOf(checked).views[0]?.name).toBe("view")
    expect(Object.isFrozen(checkedOf(checked).views[0])).toBe(true)
  })

  it("keeps its own copy of a view's _meta.ui", () => {
    const ui = { csp: { connectDomains: ["https://api.example.com"] } }
    const checked = defineExtension(extension([view("ui://probe/a", ui)], []))
    ui.csp.connectDomains.push("https://evil.example")
    expect(checkedOf(checked).views[0]?.ui?.csp?.connectDomains).toEqual([
      "https://api.example.com",
    ])
  })

  it("refuses to serve an extension spread into another", () => {
    const checked = defineExtension(extension([], [made()]))
    const spread = { ...checked, tools: [] } as typeof checked
    expect(() => checkedOf(spread)).toThrow(
      new DefinitionError(
        "probe was not made by defineExtension, so it was never checked",
      ),
    )
  })

  it("copies a tool's callers, so changing the caller's array changes nothing", () => {
    const callers: Array<"model" | "app"> = ["model"]
    const kept = tool({ callers })
    callers.push("app")
    expect(kept.callers).toEqual(["model"])
  })

  it("freezes a tool, so it cannot be changed after it is checked", () => {
    const kept = made()
    expect(Object.isFrozen(kept)).toBe(true)
  })
})

describe("toolAnnotations", () => {
  it("derives the two hints from one effect, so they never disagree", () => {
    expect(toolAnnotations("read-only")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    })
    expect(toolAnnotations("additive")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
    })
    expect(toolAnnotations("destructive")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    })
  })
})
