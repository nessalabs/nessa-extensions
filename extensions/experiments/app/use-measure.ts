/**
 * Measurement the charts need and cannot do while rendering: an element's
 * width, and the size of a hover card so `placeCard` can keep it inside the
 * chart. Both start from a fallback, so a host that reports no size — a test,
 * a first frame — still draws.
 */
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { placeCard, type Box, type Point } from "./geometry.ts"

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

/**
 * Where the card sits, updated once it has been measured. `anchor` is the
 * point it describes, in the chart's coordinates; `bounds` is the chart.
 */
export function useAnchoredCard(
  anchor: Point | undefined,
  bounds: Box,
): {
  readonly ref: RefObject<HTMLDivElement | null>
  readonly place?: { left: number; top: number }
} {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 220, height: 96 })
  const x = anchor?.x
  const y = anchor?.y
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null || x === undefined || y === undefined) return
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    if (
      Math.abs(rect.width - size.width) <= 1 &&
      Math.abs(rect.height - size.height) <= 1
    )
      return
    setSize({ width: rect.width, height: rect.height })
  }, [x, y, size.width, size.height])
  const place =
    anchor === undefined ? undefined : placeCard({ anchor, card: size, bounds })
  return { ref, ...(place === undefined ? {} : { place }) }
}
