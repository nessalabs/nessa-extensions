/**
 * The one place a metric's numbers are written (nessa-agent ADR 333, "A
 * metric's numbers are formatted in one place"). A value comes back as
 * `Formatted` text; a change as a `Change`, which a view hands to nessa_ui's
 * `Delta` to draw: `Delta` adds the sign, and the tone is decided here. Only
 * this module makes either (`metric.test.ts`, "the brands"), so a view that
 * holds one did not format a metric number itself. Counts are not metric values and are not written here.
 */
import type { Metric } from "./definition.ts"

/** A brand a spread or a template literal cannot carry. */
declare class FormattedBrand {
  private readonly formatted: true
}

/** A metric value written out: its number, then its unit. */
export type Formatted = string & FormattedBrand

/** How a change reads against the metric's `better`. */
export type ChangeTone = "good" | "bad" | "neutral"

declare class ChangeBrand {
  private readonly change: true
}

/**
 * A change in a metric, as a view draws it. `value` is the change rounded to
 * the metric's decimals (not `-0`: `metric.test.ts`), so its sign, `size` and `tone` agree;
 * `size` is its magnitude written in the delta unit, with no sign.
 */
export type Change = ChangeBrand & {
  readonly value: number
  readonly size: Formatted
  readonly tone: ChangeTone
}

const minus = "\u2212"

/** One writer per number of decimals: digits only, no grouping, no sign. */
const writers = new Map<number, Intl.NumberFormat>()

/**
 * `value`'s magnitude written to `decimals` places, rounding half away from
 * zero on the decimal the number reads as, so 0.35 is "0.4" as 0.25 is
 * "0.3" (`metric.test.ts`). `toFixed` would round the binary double instead.
 */
function digits(value: number, decimals: number): string {
  let writer = writers.get(decimals)
  if (writer === undefined) {
    writer = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    })
    writers.set(decimals, writer)
  }
  return writer.format(Math.abs(value))
}

/**
 * `value` rounded as it is written to `decimals`. A negative that rounds to
 * nothing is `-0`, which `written` writes as "0" and a `Change`'s second
 * rounding makes `0` (`metric.test.ts`).
 */
function rounded(value: number, decimals: number): number {
  const magnitude = Number(digits(value, decimals))
  return value < 0 ? -magnitude : magnitude
}

/** `value` to `decimals` places, a negative with a minus sign: "−3.5". */
function written(value: number, decimals: number): string {
  const result = rounded(value, decimals)
  return result < 0 ? `${minus}${digits(result, decimals)}` : digits(result, decimals)
}

/** A value of `metric`: its number to the metric's decimals, then its unit as given. */
export function formatValue(metric: Metric, value: number): Formatted {
  return `${written(value, metric.decimals)}${metric.unit}` as Formatted
}

/**
 * The change in `metric` from `from` to `to`, as two values written side by
 * side read: the difference of the two rounded as they are written, so the
 * change agrees with them (`metric.test.ts`). Its tone is `neutral` when its
 * magnitude is 0 or within `noise` (the definition's, for its own metric;
 * none for a guardrail's), and otherwise `good` when it moves the way the
 * metric's `better` says and `bad` when it does not.
 */
export function changeBetween(
  metric: Metric,
  from: number,
  to: number,
  noise?: number,
): Change {
  const { decimals } = metric
  // Rounded again: the difference of two rounded decimals can carry a binary
  // remainder (0.30000000000000004).
  const value = rounded(rounded(to, decimals) - rounded(from, decimals), decimals)
  const magnitude = Math.abs(value)
  const tone: ChangeTone =
    magnitude === 0 || (noise !== undefined && magnitude <= noise)
      ? "neutral"
      : value > 0 === (metric.better === "up")
        ? "good"
        : "bad"
  const size = `${written(magnitude, decimals)}${metric.deltaUnit ?? metric.unit}`
  return Object.freeze({ value, size, tone }) as Change
}
