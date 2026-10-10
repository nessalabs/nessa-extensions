import { describe, expect, it } from "vitest"

import { sparkline } from "./sparkline.ts"

describe("sparkline", () => {
  it("draws a series that falls, as given, without recomputing a best", () => {
    const drawn = sparkline(
      [
        { at: 0, value: 1 },
        { at: 1, value: 3 },
        { at: 2, value: 2 },
      ],
      100,
      40,
    )
    expect(drawn.line).not.toBe("")
    const heights = drawn.line.match(/V[\d.]+/g) ?? []
    expect(heights.length).toBeGreaterThanOrEqual(2)
    expect(new Set(heights).size).toBeGreaterThan(1)
  })

  it("draws nothing when the series is empty", () => {
    expect(sparkline([], 100, 40).line).toBe("")
  })
})
