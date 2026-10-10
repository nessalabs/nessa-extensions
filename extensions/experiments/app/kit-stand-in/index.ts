/**
 * A temporary copy of nessa_ui at e02b577a74ed99ba05c8bfba58c8984b881c3a69.
 * The files under `src/` are that commit, byte for byte (`stand-in.test.ts`
 * refuses a drift). This file and `stand-in.css` are the seam: the copies
 * import `@/` and style themselves with Tailwind classes, and neither the
 * alias nor Tailwind is this app. Delete this directory when
 * `@nessalabs/ui` is installable (nessa_ui#115) and point the imports here
 * at the package.
 */
import "../tokens.css"
import "./stand-in.css"

export {
  intersectChartRects,
  linearScale,
  MAX_TICK_COUNT,
  niceTicks,
  placeChartTooltip,
  proportionWeights,
  stepPath,
  type ChartPoint,
  type ChartRect,
  type ChartScale,
  type ChartTooltipPlacement,
  type ChartTooltipPlacementInput,
  type ChartTooltipSide,
  type ProportionWeighting,
  type StepPathOptions,
} from "./src/lib/chart-geometry.ts"
export {
  ChartTooltip,
  type ChartTooltipBoundary,
  type ChartTooltipProps,
} from "./src/components/chart-tooltip.tsx"
export { Delta, type DeltaProps, type DeltaTone } from "./src/components/delta.tsx"
export { Meter, type MeterProps, type MeterTone } from "./src/components/meter.tsx"
export {
  ProportionBar,
  proportionBarTones,
  type ProportionBarProps,
  type ProportionBarSegment,
  type ProportionBarTone,
} from "./src/components/proportion-bar.tsx"
export { Stat, type StatProps, type StatSize } from "./src/components/stat.tsx"
export {
  StatusLabel,
  type StatusLabelProps,
  type StatusLabelTone,
} from "./src/components/status-label.tsx"
export { VirtualList, type VirtualListProps } from "./src/components/virtual-list.tsx"
