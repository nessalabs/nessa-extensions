/**
 * Whether a slice's counts can be true: the model of a slice that the rule
 * `slice-coherent` (`validation.ts`) checks.
 *
 * Every case of a run sits in one of eight cells: inside the slice or
 * outside it, and in each, it stayed passing, stayed failing, was fixed, or
 * was broken by the run. Everything an experiment says of a slice is a sum
 * of cells:
 *
 * ```
 *                  stayed passing  stayed failing  fixed   broken
 *   in the slice         p               q           f        b      total     = p + q + f + b
 *   outside              p'              q'          f'       b'     run total − total
 *
 *   passingBefore = p + b            the run's fixed  = f + f'
 *   passingAfter  = p + f            the run's broken = b + b'
 *   the page's fixed cases in the slice ≤ f, its broken cases ≤ b
 * ```
 *
 * The counts can be true exactly when some cells, none below 0, give those
 * sums. That holds whether slices overlap or cover only some of the cases,
 * since each slice is set against the whole run. `slice.test.ts` holds the
 * closed form below equal to a search over the cells themselves, for every
 * input up to a size.
 */

/** What a slice says of itself. */
export interface SliceCounts {
  readonly total: number
  readonly passingBefore: number
  readonly passingAfter: number
}

/** What the run says of all its cases. */
export interface RunCounts {
  readonly total: number
  readonly fixed: number
  readonly broken: number
}

/** How many of the page's moved cases are listed in the slice, each way. */
export interface Listed {
  readonly fixed: number
  readonly broken: number
}

/**
 * Whether some cells give `slice`'s counts, `run`'s, and the cases `listed`
 * in the slice. Every count is a whole number, 0 or more (the schema's), and
 * the slice's are within the run's and its own total, and `listed` within
 * the run's `fixed` and `broken` (the rules `slice-within-cases`,
 * `slice-passing-within-total` and `moved-page-within-counts`, checked first).
 * Counts are at most 10^15 (`valueBound`), so every sum here stays within
 * the 2^53 a double holds exactly.
 *
 * The cells follow from `b`: `f = b + change` (where `change` is
 * `passingAfter - passingBefore`), `p = passingBefore - b`,
 * `q = total - passingBefore - f`, `f' = fixed - f`, `b' = broken - b`, and
 * `p' + q' = (run total - total) - f' - b'`. Each at least 0, and `f`, `b`
 * at least what is listed, bound `b` from both sides.
 */
export function sliceCoherent(
  slice: SliceCounts,
  run: RunCounts,
  listed: Listed = { fixed: 0, broken: 0 },
): boolean {
  const change = slice.passingAfter - slice.passingBefore
  const outside = run.total - slice.total
  const lowest = Math.max(
    listed.broken, // b at least the broken listed in it
    listed.fixed - change, // f at least the fixed listed in it
    // p' + q' ≥ 0: the run's other moved cases fit outside the slice.
    Math.ceil((run.fixed + run.broken - change - outside) / 2),
  )
  const highest = Math.min(
    slice.passingBefore, // p ≥ 0
    slice.total - slice.passingBefore - change, // q ≥ 0
    run.broken, // b' ≥ 0
    run.fixed - change, // f' ≥ 0
  )
  return lowest <= highest
}
