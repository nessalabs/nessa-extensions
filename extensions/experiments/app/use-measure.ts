/**
 * The width a chart cannot know while rendering. It starts from a fallback,
 * so a host that reports no size — a test, a first frame — still draws.
 */
import { useCallback, useRef, useState } from "react"

export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): readonly [(node: T | null) => void, number] {
  const [width, setWidth] = useState(fallback)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (node === null) return
    const measure = () => {
      // clientWidth is the width children can fill. A border box is wider
      // than that by the border, and a chart drawn at that width overflows.
      const next = node.clientWidth
      if (next > 0) {
        const rounded = Math.round(next)
        setWidth((current) => (current === rounded ? current : rounded))
      }
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const watching = new ResizeObserver(measure)
    watching.observe(node)
    observer.current = watching
  }, [])
  return [ref, width]
}
