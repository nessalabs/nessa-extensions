/**
 * A temporary copy of nessa_ui at e02b577a74ed99ba05c8bfba58c8984b881c3a69.
 * Component names, prop names, which props are required, and the defaults
 * match that commit's `@nessalabs/ui`, and so do `linearScale`, `niceTicks`,
 * `stepPath`, `placeChartTooltip`, and `VirtualList`. Delete this directory
 * when `@nessalabs/ui` is installable (nessa_ui#115) and point the imports
 * here at the package.
 */
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
} from "./chart-geometry.ts"
export {
  ChartTooltip,
  Delta,
  Meter,
  ProportionBar,
  proportionBarTones,
  Stat,
  StatusLabel,
  type ChartTooltipBoundary,
  type ChartTooltipProps,
  type DeltaProps,
  type DeltaTone,
  type MeterProps,
  type MeterTone,
  type ProportionBarProps,
  type ProportionBarSegment,
  type ProportionBarTone,
  type StatProps,
  type StatSize,
  type StatusLabelProps,
  type StatusLabelTone,
} from "./components.tsx"
export { VirtualList, type VirtualListProps } from "./virtual-list.tsx"
