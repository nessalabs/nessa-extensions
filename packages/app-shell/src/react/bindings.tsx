/**
 * React over the bridge. `BridgeProvider` gives a tree its bridge; each hook
 * reads one part of the bridge's state through `useSyncExternalStore`, so a
 * component re-renders when that part is replaced and not otherwise.
 *
 * The provider does not connect: composition does (`mountApp`, or the app's
 * own entry), so a test can hand it a bridge in any state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react"

import type { Bridge, BridgeState, CallOptions, Connection } from "../bridge/bridge.ts"
import type { ToolCall } from "../bridge/tool-call.ts"
import type { DisplayMode, HostContext } from "../protocol/messages.ts"
import type { DesignTokens } from "../theming/design-tokens.ts"
import { createThemeApplier, type ThemeRoot } from "../theming/host-theme.ts"

const BridgeContext = createContext<Bridge | null>(null)

export function BridgeProvider({
  bridge,
  children,
}: {
  bridge: Bridge
  children: ReactNode
}) {
  return <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>
}

/** The bridge `BridgeProvider` gave. Throws outside one: that is a wiring mistake. */
export function useBridge(): Bridge {
  const bridge = useContext(BridgeContext)
  if (bridge === null) throw new Error("useBridge is used outside a BridgeProvider")
  return bridge
}

function useBridgeState<T>(select: (state: BridgeState) => T): T {
  const bridge = useBridge()
  return useSyncExternalStore(bridge.subscribe, () => select(bridge.getState()))
}

/** Where the connection to the host stands. */
export function useConnection(): Connection {
  return useBridgeState((state) => state.connection)
}

/** The host context so far: theme, styles, display mode, locale, size. */
export function useHostContext(): HostContext {
  return useBridgeState((state) => state.hostContext)
}

/** The tool call the app was opened for: its input, then its result or cancellation. */
export function useToolCall(): ToolCall {
  return useBridgeState((state) => state.toolCall)
}

/** The tool's complete input, once the host has sent it. */
export function useToolInput(): Record<string, unknown> | undefined {
  return useBridgeState((state) => {
    const call = state.toolCall
    return call.phase === "running" ||
      call.phase === "complete" ||
      call.phase === "cancelled"
      ? call.input
      : undefined
  })
}

/** The tool's result, once it has finished. */
export function useToolResult() {
  return useBridgeState((state) =>
    state.toolCall.phase === "complete" ? state.toolCall.result : undefined,
  )
}

/**
 * The display mode the host shows the app in, the ones it offers, and a
 * request for another. The request resolves to the mode the host chose, or
 * rejects with a `BridgeError` the caller shows.
 */
export function useDisplayMode(): {
  mode: DisplayMode | undefined
  available: DisplayMode[] | undefined
  request: (mode: DisplayMode, options?: CallOptions) => Promise<DisplayMode>
} {
  const bridge = useBridge()
  const mode = useBridgeState((state) => state.hostContext.displayMode)
  const available = useBridgeState((state) => state.hostContext.availableDisplayModes)
  const request = useCallback(
    (next: DisplayMode, options?: CallOptions) =>
      bridge.requestDisplayMode(next, options),
    [bridge],
  )
  return { mode, available, request }
}

/**
 * Applies the host's theme to `root`, the element that scopes the design
 * system's theme, through `tokens`, and again each time the host context
 * changes; nothing while `root` is null. What the host does not supply keeps
 * the app's defaults; on unmount the defaults return.
 *
 * The variables and the theme attribute go on the same element. A design
 * system declares its dark values on the element that carries the attribute
 * (nessa_ui at zero specificity, `:where([data-nessa-mode="dark"])`), and
 * descendants read the nearest declaration — so a host's values set anywhere
 * above that element would be shadowed there, and the attribute set on the
 * document's root would lose to the design system's own `:root` defaults.
 */
export function useHostTheme<Token extends `--${string}`>(
  tokens: DesignTokens<Token>,
  root: ThemeRoot | null,
): void {
  const context = useHostContext()
  // One applier per root and token set, so each application replaces what
  // the last one set; a new root or token set clears the old one's.
  const applier = useMemo(
    () => (root === null ? null : createThemeApplier(root, tokens)),
    [root, tokens],
  )
  useEffect(() => () => applier?.clear(), [applier])
  useEffect(() => applier?.apply(context), [applier, context])
}

/**
 * An element that carries the host's theme for everything inside it: the
 * place an app puts its design system's scope.
 */
export function HostThemeScope<Token extends `--${string}`>({
  tokens,
  children,
  ...props
}: { tokens: DesignTokens<Token>; children?: ReactNode } & Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
>) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useHostTheme(tokens, element)
  return (
    <div {...props} ref={setElement}>
      {children}
    </div>
  )
}

/**
 * Runs `handler` when the host tears the app down, while the component is
 * mounted; the bridge answers the host once it has finished. The latest
 * `handler` is the one run.
 */
export function useTeardown(
  handler: (reason: string | undefined) => void | Promise<void>,
): void {
  const bridge = useBridge()
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const remove = bridge.onTeardown((reason) => latest.current(reason))
    return () => remove()
  }, [bridge])
}
