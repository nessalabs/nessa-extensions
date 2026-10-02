import { describe, expect, it } from "vitest"

import { isPathData } from "./path-data.ts"

describe("isPathData", () => {
  it("accepts path data a browser draws in full", () => {
    for (const text of [
      "M3 4.5h10M3 8h10M3 11.5h6",
      "M10.6 2.6a3 3 0 0 0-2.8 4L3.2 11.2a1.1 1.1 0 0 0 1.6 1.6l4.6-4.6z",
      "M3.1 7a3.9 3.9 0 1 0 7.8 0a3.9 3.9 0 1 0-7.8 0M10 10l3.3 3.3",
      "M1 1h14v14H1z",
      "M0,0 L1,1",
      "M 0 0 L 1 1 Z",
      // A moveto's further sets are lines; numbers may run together.
      "m1 1 2 2 3 3",
      "M1-1-2.5.5.5.5",
      "M1e2 .5L1E-1 2",
      // An arc's flags may run into what follows them.
      "M1 1a1 1 0 001 1",
      "M0 0C1 1 2 2 3 3S4 4 5 5Q6 6 7 7T8 8",
      "  M1 1  ",
    ]) {
      expect(isPathData(text), text).toBe(true)
    }
  })

  it("refuses what a browser stops drawing at, or never starts", () => {
    for (const text of [
      "",
      "   ",
      "M",
      "M0",
      "M0 0 L",
      "M0 0 L1",
      "M0 0 h",
      "L0 0",
      "Z",
      "M0 0 Z1",
      "M0 0 X1 1",
      "M0 0,",
      "M0 0,L1 1",
      "M,0 0",
      "M0 0 a1 1 0 2 0 1 1",
      "M0 0 C1 1 2 2 3",
      'M0 0"/><script>',
    ]) {
      expect(isPathData(text), text).toBe(false)
    }
  })
})
