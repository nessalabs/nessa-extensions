/**
 * The card's climb: the best-so-far line, as given. Nothing when the series
 * is empty. `sparkline.ts` owns the path.
 */
import type { Sparkline as SparklineShape } from "./sparkline.ts"
import "./sparkline.css"

export function Sparkline({ line, width, height }: SparklineShape) {
  if (line === "") return null
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      role="img"
      aria-label="Best so far"
    >
      <path className="sparkline-line" d={line} />
    </svg>
  )
}
