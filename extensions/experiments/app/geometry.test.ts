import { describe, expect, it } from "vitest"

import { climb, validateExperiment, type ExperimentInput } from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
import {
  axisTicks,
  climbLayout,
  formatElapsed,
  mapLayout,
  placeCard,
  stepAfter,
  visibleRange,
} from "./geometry.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function experiment(sample: (startedAt: number) => ExperimentInput) {
  const result = validateExperiment(sample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

const identity = { x: (value: number) => value, y: (value: number) => value }
const px = (value: number) => Math.round(value * 100) / 100

describe("axisTicks", () => {
  it("bounds the data on a 1-2-5 step and widens a flat series", () => {
    const ticks = axisTicks(0, 100, 4)
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0]).toBeLessThanOrEqual(0)
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(100)
    const flat = axisTicks(5, 5, 4)
    expect(flat[0]).toBeLessThan(5)
    expect(flat.at(-1)).toBeGreaterThan(5)
  })

  it("gives no ticks for a non-finite bound", () => {
    expect(axisTicks(Number.NaN, 1, 4)).toEqual([])
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

describe("stepAfter", () => {
  it("keeps the order it is given and carries the last value out", () => {
    expect(
      stepAfter(
        [
          { x: 0, y: 1 },
          { x: 2, y: 3 },
          { x: 1, y: 0 },
        ],
        identity,
      ),
    ).toBe("M0,1H2V3H1V0")
    expect(stepAfter([{ x: 0, y: 1 }], identity, 4)).toBe("M0,1H4")
    expect(stepAfter([], identity)).toBe("")
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
})

describe("placeCard", () => {
  const bounds = { left: 0, top: 0, width: 200, height: 100 }

  it("sits to the right of the anchor, or to the left when the right does not fit", () => {
    expect(
      placeCard({ anchor: { x: 20, y: 40 }, card: { width: 30, height: 10 }, bounds }),
    ).toEqual({ left: 32, top: 35 })
    expect(
      placeCard({ anchor: { x: 180, y: 40 }, card: { width: 40, height: 20 }, bounds })
        .left,
    ).toBe(128)
  })

  it("pins a card larger than the bounds to the padding", () => {
    expect(
      placeCard({
        anchor: { x: 50, y: 50 },
        card: { width: 300, height: 200 },
        bounds: { left: 0, top: 0, width: 100, height: 80 },
      }),
    ).toEqual({ left: 8, top: 8 })
  })
})

describe("visibleRange", () => {
  it("windows ten thousand rows and overscans", () => {
    expect(visibleRange(0, 320, 36, 10_000, 6)).toEqual({ start: 0, end: 15 })
    expect(visibleRange(36 * 200, 320, 36, 10_000, 6)).toEqual({ start: 194, end: 215 })
    expect(visibleRange(0, 320, 36, 0, 6)).toEqual({ start: 0, end: 0 })
  })
})
