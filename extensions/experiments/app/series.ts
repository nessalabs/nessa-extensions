/**
 * An area's hue as the chart ramp's ink. The ramp's names are nessa_ui's;
 * which hue an area has is the experiment's.
 */
import type { Area } from "../model/index.ts"

const series = {
  1: "var(--nessa-chart-series-1)",
  2: "var(--nessa-chart-series-2)",
  3: "var(--nessa-chart-series-3)",
  4: "var(--nessa-chart-series-4)",
  5: "var(--nessa-chart-series-5)",
} as const satisfies Record<Area["hue"], string>

const seriesStrong = {
  1: "var(--nessa-chart-series-1-strong)",
  2: "var(--nessa-chart-series-2-strong)",
  3: "var(--nessa-chart-series-3-strong)",
  4: "var(--nessa-chart-series-4-strong)",
  5: "var(--nessa-chart-series-5-strong)",
} as const satisfies Record<Area["hue"], string>

/** The series ink for an area's hue. `strong` is the step a thin bar uses. */
export function seriesInk(hue: Area["hue"], strong = false): string {
  return strong ? seriesStrong[hue] : series[hue]
}
