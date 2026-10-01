/**
 * The host's theme on the app's document: its style variables, as given and
 * as the design system's tokens, and its light or dark theme.
 *
 * Host values are untrusted. Each is set with `style.setProperty(name,
 * value)` — never written into CSS text — under a name from the standard's
 * closed set (`narrowHostContext` keeps only those) or a token the design
 * system declared. A value is set only when it is built from what a theme
 * value needs and nothing that loads or escapes (`isSafeValue`); one the
 * browser will not take is left unset as well.
 *
 * What the host does not supply keeps the app's own default: a variable or
 * token is removed from the root's inline style when the host stops sending
 * it, so the stylesheet's value shows again.
 */
import {
  styleVariables,
  type HostContext,
  type StyleVariable,
  type Theme,
} from "../protocol/messages.ts"
import type { DesignTokens } from "./design-tokens.ts"

/**
 * The functions a theme value may call: colours, arithmetic, and references
 * to other variables. Nothing here fetches (`url`, `image-set`, `src`) or
 * evaluates.
 */
const allowedFunctions: ReadonlySet<string> = new Set([
  "light-dark",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "calc",
  "min",
  "max",
  "clamp",
  "var",
])

/**
 * Whether `value` is one a host may set: letters, digits, spaces, quotes and
 * the punctuation colours, lengths, font lists and shadows are written with —
 * no `;`, braces, backslash escapes, `:` or `<` — and every function it calls
 * is in `allowedFunctions`.
 */
export function isSafeValue(value: string): boolean {
  if (!/^[\w\s#%.,()+\-*/"']*$/.test(value)) return false
  for (const call of value.matchAll(/([A-Za-z_-][\w-]*)\s*\(/g)) {
    if (!allowedFunctions.has((call[1] ?? "").toLowerCase())) return false
  }
  return true
}

/** What the host's theme sets on the root, before it is applied. */
export interface ThemeDeclarations {
  /** Custom properties by name, each a safe value. */
  properties: Map<string, string>
  theme: Theme | undefined
}

/**
 * The declarations `context` asks for: each host variable it supplies, and
 * each token whose host variable it supplies, when the value is safe.
 */
export function themeDeclarations<Token extends `--${string}`>(
  context: HostContext,
  tokens: DesignTokens<Token>,
): ThemeDeclarations {
  const variables = context.styles?.variables ?? {}
  const properties = new Map<string, string>()
  const supplied = (name: StyleVariable): string | undefined => {
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined
    return value !== undefined && isSafeValue(value) ? value : undefined
  }
  for (const name of styleVariables) {
    const value = supplied(name)
    if (value !== undefined) properties.set(name, value)
  }
  for (const [token, source] of Object.entries<StyleVariable>(tokens.fromHost)) {
    const value = supplied(source)
    if (value !== undefined) properties.set(token, value)
  }
  return { properties, theme: context.theme }
}

/** The part of an element the theme writes to. */
export interface ThemeRoot {
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty" | "getPropertyValue">
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** Applies a host's theme to `root`, and each later one in its place. */
export interface ThemeApplier {
  apply(context: HostContext): void
  /** Removes everything this applier set, leaving the app's defaults. */
  clear(): void
}

export function createThemeApplier<Token extends `--${string}`>(
  root: ThemeRoot,
  tokens: DesignTokens<Token>,
): ThemeApplier {
  let applied = new Set<string>()
  const clear = () => {
    for (const name of applied) root.style.removeProperty(name)
    applied = new Set()
    root.style.removeProperty("color-scheme")
    root.removeAttribute(tokens.themeAttribute)
  }
  return {
    apply(context) {
      const { properties, theme } = themeDeclarations(context, tokens)
      const next = new Set<string>()
      for (const [name, value] of properties) {
        root.style.setProperty(name, value)
        // A value the browser will not take leaves the property unset.
        if (root.style.getPropertyValue(name) === "") root.style.removeProperty(name)
        else next.add(name)
      }
      for (const name of applied) if (!next.has(name)) root.style.removeProperty(name)
      applied = next
      if (theme === undefined) {
        root.style.removeProperty("color-scheme")
        root.removeAttribute(tokens.themeAttribute)
      } else {
        // `light-dark()` in a host's values resolves by the color scheme.
        root.style.setProperty("color-scheme", theme)
        root.setAttribute(tokens.themeAttribute, theme)
      }
    },
    clear,
  }
}
