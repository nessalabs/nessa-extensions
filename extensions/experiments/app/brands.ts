/**
 * `Formatted` and `Change` are brands. A tick label and a score's change
 * have to be ones the formatter produced. This file is typechecked and not
 * run: the calls below are refused, and a test that only asserted that
 * would count without checking anything.
 */
import { formatValue, type Change, type Formatted } from "../model/index.ts"
import type { ClimbChartProps } from "./climb-chart.tsx"
import type { ScoreRead } from "./reading.ts"

const metric = {
  id: "p95",
  name: "p95 latency",
  unit: " ms",
  better: "down",
  decimals: 0,
} as const

function tickLabel(label: ClimbChartProps["yTicks"][number]["label"]): Formatted {
  return label
}

function scoreChange(change: NonNullable<ScoreRead["change"]>): Change {
  return change
}

tickLabel(
  // @ts-expect-error a number is not a formatted metric value
  418,
)
tickLabel(
  // @ts-expect-error a plain string is not a formatted metric value
  "418 ms",
)
scoreChange(
  // @ts-expect-error a plain object is not a Change
  { value: -21, size: formatValue(metric, 21), tone: "bad" },
)
