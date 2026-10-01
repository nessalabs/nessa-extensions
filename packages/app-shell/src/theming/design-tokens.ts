/**
 * The token interface: what a design system tells the app shell so a host's
 * theme can reach it. The host speaks MCP Apps' style variables
 * (`--color-background-primary`, …); a design system has tokens of its own
 * (`--background`, …). A `DesignTokens` says, for each token, which host
 * variable supplies it, and how the design system is told light from dark.
 *
 * nessa_ui's is `nessaUiTokens`. Another design system, or an app's own
 * tokens, is another `DesignTokens`; nothing else in the shell changes.
 */
import type { StyleVariable } from "../protocol/messages.ts"

export interface DesignTokens<Token extends `--${string}`> {
  /** Each token, and the host style variable its value is taken from. */
  readonly fromHost: Readonly<Record<Token, StyleVariable>>
  /**
   * The attribute on the theme's scope element that tells the design system
   * the theme, set to `light` or `dark`; removed when the host says neither.
   */
  readonly themeAttribute: string
}
