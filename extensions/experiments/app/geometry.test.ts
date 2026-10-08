import { describe, expect, it } from "vitest"

import { climb, validateExperiment, type ExperimentInput } from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
import { climbLayout, formatElapsed, mapLayout } from "./geometry.ts"
import { niceTicks, placeChartTooltip, stepPath } from "./kit-stand-in/index.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function experiment(sample: (startedAt: number) => ExperimentInput) {
  const result = validateExperiment(sample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

const identity = { x: (value: number) => value, y: (value: number) => value }
const px = (value: number) => Math.round(value * 100) / 100

describe("niceTicks", () => {
  it("bounds the data on a 1-2-5 step and widens a flat series", () => {
    const ticks = niceTicks(0, 100, 4)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(100)
    const flat = niceTicks(5, 5, 4)
    expect(flat[0]).toBeLessThan(5)
    expect(flat.at(-1)).toBeGreaterThan(5)
  })

  it("gives no ticks for a non-finite bound", () => {
    expect(niceTicks(Number.NaN, 1, 4)).toEqual([])
  })
})

describe("formatElapsed", () => {
  it("writes minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0m")
    expect(formatElapsed(45 * 60_000)).toBe("45m")
    expect(formatElapsed(2 * 3_600_000)).toBe("2h")
    expect(formatElapsed(3 * 3_600_000 + 10 * 60_000)).toBe("3h 10m")
  })
})

describe("stepPath", () => {
  it("keeps the order it is given and carries the last value out", () => {
    expect(
      stepPath(
        [
          { x: 0, y: 1 },
          { x: 2, y: 3 },
          { x: 1, y: 0 },
        ],
        identity,
      ),
    ).toBe("M0,1H2V3H1V0")
    expect(stepPath([{ x: 0, y: 1 }], identity, { until: 4 })).toBe("M0,1H4")
    expect(stepPath([], identity)).toBe("")
  })
})

describe("climbLayout", () => {
  it("carries the best line out and does not follow a later worse point", () => {
    const layout = climbLayout({
      points: [
        { runId: "a", at: 0, value: 10 },
        { runId: "b", at: 100, value: 30 },
        { runId: "c", at: 200, value: 12 },
      ],
      best: [
        { at: 0, value: 10 },
        { at: 100, value: 30 },
      ],
      width: 400,
      height: 280,
    })
    const better = layout.points.find((point) => point.runId === "b")
    const worse = layout.points.find((point) => point.runId === "c")
    if (better === undefined || worse === undefined)
      throw new Error("both points are placed")
    expect(layout.best).toContain(`V${px(better.y)}`)
    expect(layout.best).not.toContain(`V${px(worse.y)}`)
    expect(layout.referenceY).toBeUndefined()
    expect(layout.band).toBe("")
  })

  it("draws the band and the reference when the series has them", () => {
    const layout = climbLayout({
      points: [{ runId: "a", at: 0, value: 10 }],
      best: [{ at: 0, value: 10 }],
      noise: 2,
      reference: 16,
      width: 400,
      height: 280,
    })
    expect(layout.band).not.toBe("")
    expect(layout.referenceY).toEqual(expect.any(Number))
  })

  it("places both samples from the climb the model returns", () => {
    for (const sample of [checkoutSample, latencySample]) {
      const series = climb(experiment(sample))
      const layout = climbLayout({
        points: series.points,
        best: series.best,
        width: 720,
        height: 280,
      })
      expect(layout.points).toHaveLength(series.points.length)
      expect(layout.best).not.toBe("")
      expect(layout.points.length).toBeGreaterThan(0)
    }
  })
})

describe("mapLayout", () => {
  it("draws nothing when there are no areas, thread included", () => {
    expect(
      mapLayout({ areas: [], runs: [], thread: ["l1", "l3"], width: 400, height: 200 }),
    ).toMatchObject({ columns: [], dots: [], thread: "" })
  })

  it("keeps column order when the width is under the insets", () => {
    const layout = mapLayout({
      areas: [{ id: "a" }, { id: "b" }],
      runs: [],
      thread: [],
      width: 160,
      height: 200,
    })
    const [first, second] = layout.columns
    expect(first?.x).toBeLessThan(second?.x ?? 0)
  })
})

describe("placeChartTooltip", () => {
  const boundary = { left: 0, top: 0, width: 200, height: 100 }
  const gap = { side: "right" as const, offset: 12, padding: 8 }

  it("sits to the right of the anchor, or to the left when the right does not fit", () => {
    expect(
      placeChartTooltip({
        anchor: { x: 20, y: 40 },
        size: { width: 30, height: 10 },
        boundary,
        ...gap,
      }),
    ).toEqual({ x: 32, y: 35, side: "right" })
    expect(
      placeChartTooltip({
        anchor: { x: 180, y: 40 },
        size: { width: 40, height: 20 },
        boundary,
        ...gap,
      }).x,
    ).toBe(128)
  })

  it("pins a card larger than the bounds to the padding", () => {
    expect(
      placeChartTooltip({
        anchor: { x: 50, y: 50 },
        size: { width: 300, height: 200 },
        boundary: { left: 0, top: 0, width: 100, height: 80 },
        ...gap,
      }),
    ).toEqual({ x: 8, y: 8, side: "right" })
  })
})
