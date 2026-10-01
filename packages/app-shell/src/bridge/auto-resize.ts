/**
 * Tells the host the app's size as it changes
 * (`ui/notifications/size-changed`), so a host that sizes its iframe to the
 * app (flexible `containerDimensions`) can. It reports while the connection is
 * open, and stops when it is torn down or closed; the bridge leaves out a
 * size equal to the last one it sent.
 */
import type { Bridge } from "./bridge.ts"

/** Watches `element`'s size, calling `changed` on each change; returns what stops it. */
export type ObserveSize = (element: Element, changed: () => void) => () => void

const resizeObserver: ObserveSize = (element, changed) => {
  const observer = new ResizeObserver(changed)
  observer.observe(element)
  return () => observer.disconnect()
}

/**
 * Reports `element`'s size — by default the document's — whenever it changes
 * while `bridge` is connected. Returns what stops it.
 */
export function autoResize(
  bridge: Bridge,
  element: Element = document.documentElement,
  observe: ObserveSize = resizeObserver,
): () => void {
  let stopObserving: (() => void) | null = null
  const report = () => {
    const { width, height } = element.getBoundingClientRect()
    bridge.reportSize({ width: Math.ceil(width), height: Math.ceil(height) })
  }
  const follow = () => {
    const status = bridge.getState().connection.status
    const open = status === "connected" || status === "tearing-down"
    if (open && stopObserving === null) {
      stopObserving = observe(element, report)
      report()
    } else if (!open && stopObserving !== null) {
      stopObserving()
      stopObserving = null
    }
  }
  const unsubscribe = bridge.subscribe(follow)
  follow()
  return () => {
    unsubscribe()
    stopObserving?.()
    stopObserving = null
  }
}
