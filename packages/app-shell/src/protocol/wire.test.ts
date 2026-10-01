/**
 * The types of `messages.ts` against the reference SDK's
 * (`@modelcontextprotocol/ext-apps`), checked by the compiler: `pnpm
 * typecheck` fails here when the standard's shapes move. What the app sends
 * must be something the reference reads; what the app reads must accept what
 * the reference sends, once checked (`narrow.ts` keeps only the standard's
 * fields, so the direction is ours ⊆ theirs for both).
 */
import type {
  McpUiAppCapabilities,
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostStyles,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiMessageRequest,
  McpUiRequestDisplayModeRequest,
  McpUiSizeChangedNotification,
  McpUiStyleVariableKey,
  McpUiStyles,
  McpUiTheme,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps"
import type { CallToolResult as ReferenceCallToolResult } from "@modelcontextprotocol/client"
import { describe, expectTypeOf, it } from "vitest"

import type {
  AppCapabilities,
  CallToolResult,
  DisplayMode,
  HostCapabilities,
  HostContext,
  InitializeParams,
  InitializeResult,
  MessageParams,
  ModelContextParams,
  SizeParams,
  StyleVariable,
  Theme,
} from "./messages.ts"

/** Whether every `A` is a `B`. */
type Extends<A, B> = [A] extends [B] ? true : false

/**
 * Whether each field of `A` is the same field of `B`, but for `except`. The
 * reference's context and result carry an index signature, which `Omit`
 * would flatten into nothing but the signature, so they are compared field by
 * field instead.
 */
type FieldsExtend<A, B, except extends PropertyKey = never> = false extends {
  [K in Exclude<keyof A, except>]-?: K extends keyof B ? Extends<A[K], B[K]> : false
}[Exclude<keyof A, except>]
  ? false
  : true

/**
 * The reference types `styles.variables` as every key present, each possibly
 * `undefined`; the standard says a host passes "any subset". Ours is the
 * subset, so `styles` is compared with the reference's read that way.
 */
type ReferenceStyles = Omit<McpUiHostStyles, "variables"> & {
  variables?: Partial<McpUiStyles>
}
type ContextExtends =
  FieldsExtend<HostContext, McpUiHostContext, "styles"> extends true
    ? Extends<HostContext["styles"], ReferenceStyles | undefined>
    : false

describe("the wire types, against the reference SDK's", () => {
  it("names the same closed sets", () => {
    expectTypeOf<DisplayMode>().toEqualTypeOf<McpUiDisplayMode>()
    expectTypeOf<Theme>().toEqualTypeOf<McpUiTheme>()
    expectTypeOf<StyleVariable>().toEqualTypeOf<McpUiStyleVariableKey>()
  })

  it("sends what the reference reads", () => {
    expectTypeOf<
      Extends<InitializeParams, McpUiInitializeRequest["params"]>
    >().toEqualTypeOf<true>()
    expectTypeOf<Extends<AppCapabilities, McpUiAppCapabilities>>().toEqualTypeOf<true>()
    expectTypeOf<
      Extends<MessageParams, McpUiMessageRequest["params"]>
    >().toEqualTypeOf<true>()
    expectTypeOf<
      Extends<ModelContextParams, McpUiUpdateModelContextRequest["params"]>
    >().toEqualTypeOf<true>()
    expectTypeOf<
      Extends<{ mode: DisplayMode }, McpUiRequestDisplayModeRequest["params"]>
    >().toEqualTypeOf<true>()
    expectTypeOf<
      Extends<SizeParams, McpUiSizeChangedNotification["params"]>
    >().toEqualTypeOf<true>()
  })

  it("reads, once checked, a subset of what the reference sends", () => {
    expectTypeOf<
      FieldsExtend<InitializeResult, McpUiInitializeResult, "hostContext">
    >().toEqualTypeOf<true>()
    expectTypeOf<Extends<HostCapabilities, McpUiHostCapabilities>>().toEqualTypeOf<true>()
    expectTypeOf<ContextExtends>().toEqualTypeOf<true>()
    expectTypeOf<Extends<CallToolResult, ReferenceCallToolResult>>().toEqualTypeOf<true>()
  })
})
