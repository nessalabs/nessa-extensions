/**
 * The card's line: the climb's best-so-far series, drawn as given. `stepPath`
 * is called without `better`, so nothing here recomputes which point is best
 * — a series that falls draws the fall. Pixels only; the series is `climb`.
 */
import { linearScale, stepPath } from "./kit-stand-in/index.ts"

export interface Sparkline {
  readonly line: string
  readonly width: number
  readonly height: number
}

const pad = 4

/** The step line for `steps`, or an empty line when there is nothing to draw. */
export function sparkline(
  steps: readonly { readonly at: number; readonly value: number }[],
  width: number,
  height: number,
): Sparkline {
  const finite = steps.filter(
    (step) => Number.isFinite(step.at) && Number.isFinite(step.value),
  )
  if (finite.length === 0 || !(width > 0) || !(height > 0)) {
    return { line: "", width, height }
  }
  const xs = finite.map((step) => step.at)
  const ys = finite.map((step) => step.value)
  const x = linearScale(
    [Math.min(...xs), Math.max(...xs)],
    [pad, Math.max(pad, width - pad)],
  )
  const y = linearScale(
    [Math.min(...ys), Math.max(...ys)],
    [Math.max(pad, height - pad), pad],
  )
  return {
    line: stepPath(
      finite.map((step) => ({ x: step.at, y: step.value })),
      { x, y },
    ),
    width,
    height,
  }
}
