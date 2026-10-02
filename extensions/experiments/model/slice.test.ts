import { describe, expect, it } from "vitest"

import { sliceCoherent, type Listed, type RunCounts, type SliceCounts } from "./slice.ts"

/**
 * Whether some cells, none below 0, give the counts: a search over the cells
 * themselves, which `sliceCoherent`'s closed form must equal. `f` and `b`
 * are the slice's fixed and broken cases; every other cell follows from them.
 */
function searched(slice: SliceCounts, run: RunCounts, listed: Listed): boolean {
  for (let f = 0; f <= slice.total; f += 1) {
    for (let b = 0; b <= slice.total; b += 1) {
      const p = slice.passingBefore - b // stayed passing, in the slice
      const q = slice.total - p - f - b // stayed failing, in the slice
      const fixedOutside = run.fixed - f
      const brokenOutside = run.broken - b
      // stayed passing or failing, outside it
      const stayedOutside = run.total - slice.total - fixedOutside - brokenOutside
      if (
        p >= 0 &&
        q >= 0 &&
        p + f === slice.passingAfter &&
        fixedOutside >= 0 &&
        brokenOutside >= 0 &&
        stayedOutside >= 0 &&
        f >= listed.fixed &&
        b >= listed.broken
      ) {
        return true
      }
    }
  }
  return false
}

describe("sliceCoherent", () => {
  it("is exactly whether some cells give the counts, for every input up to a run of 6 cases", () => {
    const disagreements: string[] = []
    let possible = 0
    let impossible = 0
    for (let runTotal = 0; runTotal <= 6; runTotal += 1)
      for (let fixed = 0; fixed <= runTotal; fixed += 1)
        for (let broken = 0; fixed + broken <= runTotal; broken += 1)
          for (let total = 0; total <= runTotal; total += 1)
            for (let passingBefore = 0; passingBefore <= total; passingBefore += 1)
              for (let passingAfter = 0; passingAfter <= total; passingAfter += 1)
                for (let listedFixed = 0; listedFixed <= fixed; listedFixed += 1)
                  for (let listedBroken = 0; listedBroken <= broken; listedBroken += 1) {
                    const slice = { total, passingBefore, passingAfter }
                    const run = { total: runTotal, fixed, broken }
                    const listed = { fixed: listedFixed, broken: listedBroken }
                    const expected = searched(slice, run, listed)
                    if (expected) possible += 1
                    else impossible += 1
                    if (sliceCoherent(slice, run, listed) !== expected) {
                      disagreements.push(JSON.stringify({ slice, run, listed, expected }))
                    }
                  }
    expect(disagreements).toEqual([])
    // Both answers occur, so the comparison means something either way.
    expect(possible).toBeGreaterThan(1000)
    expect(impossible).toBeGreaterThan(1000)
  })

  it("refuses a slice of every case that does not move by fixed less broken", () => {
    const run = { total: 100, fixed: 3, broken: 1 }
    expect(sliceCoherent({ total: 100, passingBefore: 50, passingAfter: 50 }, run)).toBe(
      false,
    )
    expect(sliceCoherent({ total: 100, passingBefore: 50, passingAfter: 52 }, run)).toBe(
      true,
    )
  })

  it("refuses a slice that leaves too few cases outside it for the rest that moved", () => {
    const run = { total: 10, fixed: 5, broken: 0 }
    // At most 2 of the 5 fixed fit outside a slice of 8, so 3 are in it.
    expect(sliceCoherent({ total: 8, passingBefore: 3, passingAfter: 3 }, run)).toBe(
      false,
    )
    expect(sliceCoherent({ total: 8, passingBefore: 3, passingAfter: 6 }, run)).toBe(true)
  })

  it("rounds the outside bound up: two moved and one outside place leave one in", () => {
    const run = { total: 3, fixed: 1, broken: 1 }
    // Churn: the two moved need at least one in the slice of 2, net 0 either way.
    expect(sliceCoherent({ total: 2, passingBefore: 1, passingAfter: 1 }, run)).toBe(true)
    expect(sliceCoherent({ total: 2, passingBefore: 0, passingAfter: 0 }, run)).toBe(
      false,
    )
  })
})
