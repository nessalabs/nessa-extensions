/**
 * Composition for an app in its iframe: a bridge over the window's
 * transport, its size reported as it changes, the React tree given the
 * bridge, and the connection opened. An app's entry is one call:
 *
 * ```tsx
 * mountApp(document.getElementById("root")!, <App />, { app: { name, version } })
 * ```
 */
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"

import { autoResize } from "../bridge/auto-resize.ts"
import { createBridge, type Bridge, type BridgeOptions } from "../bridge/bridge.ts"
import { windowTransport } from "../protocol/transport.ts"
import { BridgeProvider } from "./bindings.tsx"

export interface MountOptions extends Omit<BridgeOptions, "transport"> {
  /** The transport; the window's, to its parent, if not given. */
  transport?: BridgeOptions["transport"]
}

/**
 * Renders `app` into `element` with a connected bridge, and returns the
 * bridge and what unmounts it all. The connection's outcome is in the
 * bridge's state (`useConnection`); a failed connection is shown, not thrown.
 */
export function mountApp(
  element: Element,
  app: ReactNode,
  { transport = windowTransport(), ...options }: MountOptions,
): { bridge: Bridge; unmount: () => void } {
  const bridge = createBridge({ ...options, transport })
  const root = createRoot(element)
  root.render(<BridgeProvider bridge={bridge}>{app}</BridgeProvider>)
  const stopResizing = autoResize(bridge)
  // The failure is the connection's state, which the app renders.
  bridge.connect().catch(() => {})
  return {
    bridge,
    unmount() {
      stopResizing()
      root.unmount()
      bridge.close()
    },
  }
}
