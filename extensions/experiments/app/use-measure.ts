/**
 * Measurement the charts need and cannot do while rendering: an element's
 * width, and the size of a hover card so `placeCard` can keep it inside the
 * chart. Both start from a fallback, so a host that reports no size — a test,
 * a first frame — still draws.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react"

import { placeCard, type Box, type Point } from "./geometry.ts"

export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): readonly [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const measure = () => {
      // clientWidth is the width children can fill. A border box is wider
      // than that by the border, and a chart drawn at that width overflows.
      const next = node.clientWidth
      if (next > 0) setWidth(Math.round(next))
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
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
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null || anchor === undefined) return
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    if (
      Math.abs(rect.width - size.width) <= 1 &&
      Math.abs(rect.height - size.height) <= 1
    )
      return
    setSize({ width: rect.width, height: rect.height })
  }, [anchor, size.width, size.height])
  const place =
    anchor === undefined ? undefined : placeCard({ anchor, card: size, bounds })
  return { ref, ...(place === undefined ? {} : { place }) }
}
