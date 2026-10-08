import { describe, expect, it } from "vitest"

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

describe("the view's metric types", () => {
  it("accepts a value the formatter wrote", () => {
    const value = formatValue(metric, 418)
    expect(tickLabel(value)).toBe("418 ms")
    expect(value).toBe("418 ms")
  })

  it("refuses a raw number or a plain string where a formatted value belongs", () => {
    tickLabel(
      // @ts-expect-error a number is not a formatted metric value
      418,
    )
    tickLabel(
      // @ts-expect-error a plain string is not a formatted metric value
      "418 ms",
    )
  })

  it("refuses a plain object where a change belongs", () => {
    const size = formatValue(metric, 21)
    scoreChange(
      // @ts-expect-error a plain object is not a Change
      { value: -21, size, tone: "bad" },
    )
  })
})
