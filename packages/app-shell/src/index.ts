/**
 * The app shell: what an extension's MCP App is built on in the browser.
 * See this package's README for the module map and the bridge's design.
 *
 * - The bridge client (`createBridge`, `windowTransport`, `autoResize`) and
 *   its typed failures.
 * - The wire types of MCP Apps' `ui/*` bridge.
 * - Host theming through a design system's tokens (`createThemeApplier`,
 *   `nessaUiTokens`).
 *
 * React bindings are `@nessalabs/app-shell/react`; the fake host is
 * `@nessalabs/app-shell/fake-host`; the build plugin is
 * `@nessalabs/app-shell/build`.
 */
export { autoResize, type ObserveSize } from "./bridge/auto-resize.ts"
export {
  createBridge,
  type Bridge,
  type BridgeOptions,
  type BridgeState,
  type CallOptions,
  type Connection,
} from "./bridge/bridge.ts"
export {
  BridgeError,
  describeFailure,
  type BridgeFailure,
  type ConnectionStatus,
  type HostViolation,
} from "./bridge/failures.ts"
export type { ToolArguments, ToolCall } from "./bridge/tool-call.ts"
export type { JsonRpcMessage } from "./protocol/json-rpc.ts"
export * from "./protocol/messages.ts"
export {
  windowPairTransport,
  windowTransport,
  type MessageSource,
  type MessageTarget,
  type Transport,
} from "./protocol/transport.ts"
export type { DesignTokens } from "./theming/design-tokens.ts"
export {
  createThemeApplier,
  isSafeValue,
  themeDeclarations,
  type ThemeApplier,
  type ThemeDeclarations,
  type ThemeRoot,
} from "./theming/host-theme.ts"
export { nessaUiTokens, type NessaUiToken } from "./theming/nessa-ui-tokens.ts"
