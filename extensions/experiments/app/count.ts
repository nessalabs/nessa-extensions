/**
 * How a count is written. Counts are not metric values: `model/metric.ts`
 * does not format them, and this is the one place the views do
 * (`count.test.ts`). A metric's numbers stay in `metric.ts`.
 */

/** `count` with thousands separated, for a person to read: 10000 is "10,000". */
export function formatCount(count: number): string {
  const whole = Math.trunc(count)
  // `Math.trunc(-0.4)` is `-0`, and `-0 < 0` is false, so the sign comes from
  // the truncated value. Otherwise a fraction between -1 and 0 reads "−0".
  const negative = whole < 0
  const digits = String(Math.abs(whole))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return negative ? `−${grouped}` : grouped
}

/**
 * `count` of `noun`, the singular when it is one and the plural otherwise.
 * With no noun, the count alone: a definition that names no case noun does
 * not get one invented here.
 */
export function countLabel(
  count: number,
  noun?: { readonly one: string; readonly other: string },
): string {
  const formatted = formatCount(count)
  if (noun === undefined) return formatted
  return `${formatted} ${count === 1 ? noun.one : noun.other}`
}
