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

const minus = "−"

/** `value` rounded to `decimals`, with `-0` read as `0`. */
function rounded(value: number, decimals: number): number {
  const result = Number(value.toFixed(decimals))
  return result === 0 ? 0 : result
}

/** `value` to `decimals` places, a negative with a minus sign: "−3.5". */
function written(value: number, decimals: number): string {
  const result = rounded(value, decimals)
  const digits = Math.abs(result).toFixed(decimals)
  return result < 0 ? `${minus}${digits}` : digits
}

/** A value of `metric`: its number to the metric's decimals, then its unit as given. */
export function formatValue(metric: Metric, value: number): Formatted {
  return `${written(value, metric.decimals)}${metric.unit}` as Formatted
}

/**
 * The change `delta` in `metric`. Its tone is `neutral` when its rounded
 * magnitude is 0 or within `noise` (the definition's, for its own metric;
 * none for a guardrail's), and otherwise `good` when it moves the way the
 * metric's `better` says and `bad` when it does not.
 */
export function changeOf(metric: Metric, delta: number, noise?: number): Change {
  const value = rounded(delta, metric.decimals)
  const magnitude = Math.abs(value)
  const tone: ChangeTone =
    magnitude === 0 || (noise !== undefined && magnitude <= noise)
      ? "neutral"
      : value > 0 === (metric.better === "up")
        ? "good"
        : "bad"
  const size = `${written(magnitude, metric.decimals)}${metric.deltaUnit ?? metric.unit}`
  return Object.freeze({ value, size, tone }) as Change
}
