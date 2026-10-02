import { describe, expect, it } from "vitest"
import { z } from "zod/v4"

import {
  DefinitionError,
  defineExtension,
  defineTool,
  toolAnnotations,
  type ExtensionDefinition,
  type ToolDefinition,
  type ViewDefinition,
} from "./definition.ts"

const view = (uri: string, ui?: ViewDefinition["ui"]): ViewDefinition => ({
  uri: uri as ViewDefinition["uri"],
  name: "view",
  html: () => "<!doctype html>",
  ...(ui === undefined ? {} : { ui }),
})

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition =>
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
  tools: readonly ToolDefinition[],
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

describe("defineExtension", () => {
  it("returns a valid definition unchanged", () => {
    const valid = extension(
      [view("ui://probe/a")],
      [tool({ view: "ui://probe/a", callers: ["app"] })],
    )
    expect(defineExtension(valid)).toBe(valid)
  })

  it.each([
    ["https://probe/a", 'view "https://probe/a" is not a ui:// URI with a host'],
    ["ui://", 'view "ui://" is not a ui:// URI with a host'],
    ["ui:///path-only", 'view "ui:///path-only" is not a ui:// URI with a host'],
  ])("refuses view URI %s", (uri, problem) => {
    expect(problemsOf(extension([view(uri)], []))).toEqual([problem])
  })

  it("refuses a view declared twice", () => {
    expect(
      problemsOf(extension([view("ui://probe/a"), view("ui://probe/a")], [])),
    ).toEqual(["view ui://probe/a is declared twice"])
  })

  it.each([
    "https://api.example.com",
    "https://*.example.com",
    "wss://realtime.example.com:8443",
    "http://localhost:3000",
  ])("takes CSP origin %s", (origin) => {
    const csp = {
      connectDomains: [origin],
      resourceDomains: [origin],
      frameDomains: [origin],
      baseUriDomains: [origin],
    }
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
  ])("refuses CSP domain %s in every list", (domain) => {
    const csp = {
      connectDomains: [domain],
      resourceDomains: [domain],
      frameDomains: [domain],
      baseUriDomains: [domain],
    }
    expect(problemsOf(extension([view("ui://probe/a", { csp })], []))).toEqual(
      ["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"].map(
        (key) =>
          `view ui://probe/a: csp.${key} ${JSON.stringify(domain)} is not an origin`,
      ),
    )
  })

  it("refuses a tool with an empty name, or declared twice", () => {
    expect(problemsOf(extension([], [tool({ name: "" })]))).toEqual([
      "a tool has an empty name",
    ])
    expect(problemsOf(extension([], [tool(), tool()]))).toEqual([
      "tool tool is declared twice",
    ])
  })

  it("refuses a tool naming a view that is not declared", () => {
    expect(
      problemsOf(extension([view("ui://probe/a")], [tool({ view: "ui://probe/b" })])),
    ).toEqual(["tool tool names view ui://probe/b, which is not declared"])
  })

  it("refuses callers that are empty, repeated, or unknown", () => {
    expect(problemsOf(extension([], [tool({ callers: [] })]))).toEqual([
      "tool tool has no callers",
    ])
    expect(problemsOf(extension([], [tool({ callers: ["app", "app"] })]))).toEqual([
      "tool tool lists a caller twice",
    ])
    expect(problemsOf(extension([], [tool({ callers: ["user" as "app"] })]))).toEqual([
      'tool tool lists caller "user"',
    ])
  })

  it("names every problem at once, and the extension", () => {
    expect(() =>
      defineExtension(
        extension([view("x")], [tool({ name: "" }), tool({ view: "ui://probe/z" })]),
      ),
    ).toThrow(/^probe is not a valid extension:\n- /)
    expect(
      problemsOf(
        extension([view("x")], [tool({ name: "" }), tool({ view: "ui://probe/z" })]),
      ),
    ).toHaveLength(3)
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
