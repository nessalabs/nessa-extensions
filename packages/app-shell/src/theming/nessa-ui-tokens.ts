/**
 * nessa_ui's tokens, each taken from the MCP Apps style variable that means
 * the same thing, so an app built on nessa_ui looks native in Nessa and
 * follows its host's theme anywhere else.
 *
 * The only place nessa_ui's token names are written in this repository. They
 * are read from nessa_ui's `packages/react/src/theme.css` at commit
 * e02b577a74ed99ba05c8bfba58c8984b881c3a69 (nessalabs/nessa_ui, 2026-09-30),
 * because `@nessalabs/ui` is not yet on npm
 * (https://github.com/nessalabs/nessa_ui/issues/115). When it publishes,
 * `NessaUiToken` becomes the token type the package exports, and the names
 * below are checked against it by the compiler instead of by this comment.
 * Tests read the names from here, never from a copy.
 */
import type { DesignTokens } from "./design-tokens.ts"

/** nessa_ui's semantic tokens that a host's style variables can supply. */
export type NessaUiToken =
  | "--background"
  | "--foreground"
  | "--card"
  | "--card-foreground"
  | "--popover"
  | "--popover-foreground"
  | "--primary"
  | "--primary-foreground"
  | "--secondary"
  | "--secondary-foreground"
  | "--muted"
  | "--muted-foreground"
  | "--accent"
  | "--accent-foreground"
  | "--destructive"
  | "--destructive-foreground"
  | "--border"
  | "--input"
  | "--ring"
  | "--radius"
  | "--nessa-font-sans"
  | "--nessa-font-mono"

/**
 * Which host variable each nessa_ui token is taken from. Total: every token
 * names its source, and the compiler refuses a token left out.
 *
 * nessa_ui's `primary` is the strong fill of a primary button (near-black on
 * light), which is the host's inverse background; its `destructive` is a
 * saturated fill, which is the host's danger text colour rather than its
 * danger background, a pale tint.
 */
export const nessaUiTokens: DesignTokens<NessaUiToken> = {
  themeAttribute: "data-nessa-mode",
  fromHost: {
    "--background": "--color-background-primary",
    "--foreground": "--color-text-primary",
    "--card": "--color-background-primary",
    "--card-foreground": "--color-text-primary",
    "--popover": "--color-background-primary",
    "--popover-foreground": "--color-text-primary",
    "--primary": "--color-background-inverse",
    "--primary-foreground": "--color-text-inverse",
    "--secondary": "--color-background-secondary",
    "--secondary-foreground": "--color-text-primary",
    "--muted": "--color-background-secondary",
    "--muted-foreground": "--color-text-secondary",
    "--accent": "--color-background-tertiary",
    "--accent-foreground": "--color-text-primary",
    "--destructive": "--color-text-danger",
    "--destructive-foreground": "--color-text-inverse",
    "--border": "--color-border-primary",
    "--input": "--color-border-primary",
    "--ring": "--color-ring-primary",
    "--radius": "--border-radius-lg",
    "--nessa-font-sans": "--font-sans",
    "--nessa-font-mono": "--font-mono",
  },
}
