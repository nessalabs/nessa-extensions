// @vitest-environment happy-dom
/**
 * The host's theme on a real element's style. nessa_ui's token names are read
 * from `nessaUiTokens`, never written here.
 */
import { beforeEach, describe, expect, it } from "vitest"

import type { HostContext, StyleVariable } from "../protocol/messages.ts"
import { narrowHostContext } from "../protocol/narrow.ts"
import type { DesignTokens } from "./design-tokens.ts"
import {
  createThemeApplier,
  isSafeValue,
  themeDeclarations,
  type ThemeRoot,
} from "./host-theme.ts"
import { nessaUiTokens } from "./nessa-ui-tokens.ts"

/** The nessa_ui tokens taken from `variable`, read from the map. */
const tokensFrom = (variable: StyleVariable) =>
  Object.entries(nessaUiTokens.fromHost)
    .filter(([, source]) => source === variable)
    .map(([token]) => token)

const tokens: DesignTokens<"--surface" | "--ink"> = {
  themeAttribute: "data-mode",
  fromHost: {
    "--surface": "--color-background-primary",
    "--ink": "--color-text-primary",
  },
}

/** A context as the bridge holds it: read from the wire. */
function context(value: unknown): HostContext {
  const read = narrowHostContext(value)
  if (!read.ok) throw new Error(read.reason)
  return read.value
}

let root: HTMLElement
beforeEach(() => {
  root = document.createElement("div")
})

const inline = (name: string) => root.style.getPropertyValue(name)

describe("isSafeValue", () => {
  const safe = [
    "#171717",
    "light-dark(#ffffff, #171717)",
    "oklch(0.145 0 0)",
    "rgba(0, 0, 0, 0.1)",
    '"Anthropic Sans", ui-sans-serif, sans-serif',
    "0 1px 2px rgba(0,0,0,.05)",
    "calc(0.625rem * 1.5)",
    "var(--color-text-primary)",
    "1.25rem",
    "600",
  ]
  const unsafe = [
    "red; background: url(https://evil.example)",
    "red }",
    "url(https://evil.example/x.png)",
    "URL(https://evil.example/x.png)",
    "image-set('x.png' 1x)",
    "\\75 rl(x)",
    "red{",
    "expression(alert(1))",
    "a:b",
    "<script>",
    "red\n;",
    "url(x.png)",
    "url(data)",
    "src(x.woff)",
  ]
  for (const value of safe)
    it(`takes ${value}`, () => expect(isSafeValue(value)).toBe(true))
  for (const value of unsafe) {
    it(`refuses ${JSON.stringify(value)}`, () => expect(isSafeValue(value)).toBe(false))
  }
})

describe("themeDeclarations", () => {
  it("takes each supplied variable as itself and as each token it supplies", () => {
    const declarations = themeDeclarations(
      context({
        theme: "dark",
        styles: { variables: { "--color-text-primary": "#fafafa" } },
      }),
      nessaUiTokens,
    )
    expect(declarations.theme).toBe("dark")
    const expected = new Map([["--color-text-primary", "#fafafa"]])
    for (const token of tokensFrom("--color-text-primary")) expected.set(token, "#fafafa")
    expect(declarations.properties).toEqual(expected)
  })

  it("supplies every nessa_ui token when the host sends every variable", () => {
    const variables = Object.fromEntries(
      Object.values(nessaUiTokens.fromHost).map((name) => [name, "#123456"]),
    )
    const { properties } = themeDeclarations(
      context({ styles: { variables } }),
      nessaUiTokens,
    )
    for (const token of Object.keys(nessaUiTokens.fromHost)) {
      expect(properties.get(token)).toBe("#123456")
    }
  })
})

describe("createThemeApplier", () => {
  it("sets nothing when the host sends no styles or theme, so the defaults stay", () => {
    createThemeApplier(root, tokens).apply(context({}))
    expect(root.getAttribute("style") ?? "").toBe("")
    expect(root.hasAttribute("data-mode")).toBe(false)
  })

  it("sets only what the host sends; the rest keep their defaults", () => {
    createThemeApplier(root, tokens).apply(
      context({ styles: { variables: { "--color-text-primary": "#111111" } } }),
    )
    expect(inline("--ink")).toBe("#111111")
    expect(inline("--color-text-primary")).toBe("#111111")
    expect(inline("--surface")).toBe("")
    expect(inline("--color-background-primary")).toBe("")
  })

  it("ignores a variable outside the standard's set", () => {
    createThemeApplier(root, tokens).apply(
      context({
        styles: { variables: { "--evil": "red", "--color-text-primary": "#111111" } },
      }),
    )
    expect(inline("--evil")).toBe("")
    expect(inline("--ink")).toBe("#111111")
  })

  it("ignores a value with ;, } or url(, and keeps the default for it and its tokens", () => {
    for (const value of ["red; color: blue", "red }", "url(https://evil.example)"]) {
      const element = document.createElement("div")
      createThemeApplier(element, tokens).apply(
        context({ styles: { variables: { "--color-text-primary": value } } }),
      )
      expect(element.style.getPropertyValue("--color-text-primary")).toBe("")
      expect(element.style.getPropertyValue("--ink")).toBe("")
    }
  })

  it("leaves the default for a value the browser will not take, even over an earlier one", () => {
    // As a browser does: an unparsable value is ignored, and what was set stays.
    const set = new Map<string, string>()
    const refusing: ThemeRoot = {
      style: {
        setProperty: (name: string, value: string | null) => {
          if (value !== "rgb(") set.set(name, value ?? "")
        },
        removeProperty: (name: string) => {
          set.delete(name)
          return ""
        },
        getPropertyValue: (name: string) => set.get(name) ?? "",
      },
      setAttribute: () => {},
      removeAttribute: () => {},
    }
    const applier = createThemeApplier(refusing, tokens)
    applier.apply(
      context({ styles: { variables: { "--color-text-primary": "#111111" } } }),
    )
    expect(set.get("--ink")).toBe("#111111")
    applier.apply(context({ styles: { variables: { "--color-text-primary": "rgb(" } } }))
    expect([...set.keys()]).toEqual([])
  })

  it("sets the theme as the token set's attribute and the color scheme, so light-dark() resolves", () => {
    createThemeApplier(root, nessaUiTokens).apply(context({ theme: "dark" }))
    expect(root.getAttribute(nessaUiTokens.themeAttribute)).toBe("dark")
    expect(inline("color-scheme")).toBe("dark")
  })

  it("a later context with the variable left out reverts it to its default", () => {
    const applier = createThemeApplier(root, tokens)
    applier.apply(
      context({
        styles: {
          variables: {
            "--color-text-primary": "#111111",
            "--color-background-primary": "#eeeeee",
          },
        },
      }),
    )
    applier.apply(
      context({ styles: { variables: { "--color-text-primary": "#222222" } } }),
    )
    expect(inline("--ink")).toBe("#222222")
    expect(inline("--surface")).toBe("")
    expect(inline("--color-background-primary")).toBe("")
  })

  it("a theme change re-applies the variables it still holds", () => {
    const applier = createThemeApplier(root, tokens)
    const variables = { "--color-text-primary": "light-dark(#111111, #eeeeee)" }
    applier.apply(context({ theme: "light", styles: { variables } }))
    applier.apply(context({ theme: "dark", styles: { variables } }))
    expect(root.getAttribute("data-mode")).toBe("dark")
    expect(inline("--ink")).toBe("light-dark(#111111, #eeeeee)")
  })

  it("a later context without a theme removes it", () => {
    const applier = createThemeApplier(root, tokens)
    applier.apply(context({ theme: "dark" }))
    applier.apply(context({}))
    expect(root.hasAttribute("data-mode")).toBe(false)
    expect(inline("color-scheme")).toBe("")
  })

  it("clear removes everything it set", () => {
    const applier = createThemeApplier(root, tokens)
    applier.apply(
      context({
        theme: "dark",
        styles: { variables: { "--color-text-primary": "#111" } },
      }),
    )
    applier.clear()
    expect(root.getAttribute("style") ?? "").toBe("")
    expect(root.hasAttribute("data-mode")).toBe(false)
  })
})
