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
 * A change in a metric, as a view draws it: `value`, the change as written
 * (never `-0`: `metric.test.ts`), so its sign, `size` and `tone` agree;
 * `size`, its magnitude written in the delta unit, with no sign.
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

/** `value` to `decimals` places, a negative with a minus sign ("−3.5"), and nothing as "0". */
function written(value: number, decimals: number): string {
  const text = digits(value, decimals)
  return value < 0 && Number(text) !== 0 ? `${minus}${text}` : text
}

/** A value of `metric`: its number to the metric's decimals, then its unit as given. */
export function formatValue(metric: Metric, value: number): Formatted {
  return `${written(value, metric.decimals)}${metric.unit}` as Formatted
}

/** What a size of `metric` is written in: its delta unit, or its unit. */
const sizeUnit = (metric: Metric) => metric.deltaUnit ?? metric.unit

/**
 * A size in `metric`, such as a score's interval or the noise: its magnitude
 * to the metric's decimals, with no sign, in the delta unit ("1.2 pts").
 */
export function formatSize(metric: Metric, size: number): Formatted {
  return `${digits(size, metric.decimals)}${sizeUnit(metric)}` as Formatted
}

/** `value` as written to `places`, in units of its last place: 1.25 at 2 is 125. */
function scaled(value: number, places: number): bigint {
  const units = BigInt(digits(value, places).replace(".", ""))
  return value < 0 ? -units : units
}

/** The magnitude of `units` of the last of `places` places, written: 125 at 2 is "1.25". */
function unscaled(units: bigint, places: number): string {
  const text = (units < 0n ? -units : units).toString().padStart(places + 1, "0")
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`
}

/**
 * The change in `metric` from `from` to `to`, as two values written side by
 * side read: the exact difference of the two as they are written, so the
 * change agrees with them at any size (`metric.test.ts`). Its tone is
 * `neutral` when its magnitude is 0 or within `noise`, and otherwise `good`
 * when it moves the way the metric's `better` says and `bad` when it does
 * not. Which noise applies is `selections.ts`'s to say (`metricChange`,
 * `guardrailChange`), so the model's barrel does not export this.
 */
export function changeBetween(
  metric: Metric,
  from: number,
  to: number,
  noise?: number,
): Change {
  const units = scaled(to, metric.decimals) - scaled(from, metric.decimals)
  const magnitude = unscaled(units, metric.decimals)
  const value = units === 0n ? 0 : Number(units < 0n ? `-${magnitude}` : magnitude)
  const tone: ChangeTone =
    units === 0n || (noise !== undefined && Math.abs(value) <= noise)
      ? "neutral"
      : value > 0 === (metric.better === "up")
        ? "good"
        : "bad"
  return Object.freeze({ value, size: `${magnitude}${sizeUnit(metric)}`, tone }) as Change
}
