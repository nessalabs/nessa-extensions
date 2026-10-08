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

/** A metric value written out: its number and its unit, where the metric says. */
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

/**
 * `value` in units of the last of `places` places, rounded half away from
 * zero: 0.35 at 1 place is 4, as 0.25 is 3 (`metric.test.ts`).
 *
 * Every number this module writes or compares goes through here, so a value,
 * a size, a change and the noise are all read as the same decimal. That
 * decimal is the number's shortest round-trip digits, which ECMA-262
 * specifies for `Number#toString` in every engine; the rounding is then
 * exact, in `bigint`. (Rounding the binary double, as `toFixed` does, writes
 * 0.35 as "0.3".)
 */
function scaled(value: number, places: number): bigint {
  return rounded(decimal(value), places)
}

/** A decimal exactly: `units` of 10^-`scale`. */
interface Decimal {
  readonly units: bigint
  readonly scale: number
}

/** `value`'s shortest round-trip digits, exactly. */
function decimal(value: number): Decimal {
  const [mantissa = "0", exponent = "0"] = String(Math.abs(value)).split("e")
  const [whole = "0", fraction = ""] = mantissa.split(".")
  const units = BigInt(whole + fraction)
  return { units: value < 0 ? -units : units, scale: fraction.length - Number(exponent) }
}

/** `exact` in units of the last of `places` places, rounded half away from zero. */
function rounded(exact: Decimal, places: number): bigint {
  const magnitude = exact.units < 0n ? -exact.units : exact.units
  const shift = places - exact.scale
  let result: bigint
  if (shift >= 0) {
    result = magnitude * 10n ** BigInt(shift)
  } else {
    const divisor = 10n ** BigInt(-shift)
    result = (magnitude * 2n + divisor) / (divisor * 2n)
  }
  return exact.units < 0n ? -result : result
}

/**
 * `factor` times `value` in `metric`: the number nearest the exact product
 * of the two decimals, and that number written. A
 * limit relative to the baseline is its ratio of the baseline's measure, and
 * 1.05 × 1.9 is 1.995, written "2.00", where the binary product is
 * 1.9949999999999999 (`metric.test.ts`). For `selections.ts`'s `limitOf`, so
 * not exported from the model's barrel.
 */
export function productOf(
  metric: Metric,
  factor: number,
  value: number,
): { readonly value: number; readonly formatted: Formatted } {
  const left = decimal(factor)
  const right = decimal(value)
  const product = { units: left.units * right.units, scale: left.scale + right.scale }
  // The number nearest the exact product, and that number written, so the
  // two agree: a view that writes the value again writes the same text. (Only
  // a product with more digits than a number holds, on a half, could round
  // otherwise than the exact product.)
  const digits = Math.max(product.scale, 0)
  const exact = Number(
    `${product.units < 0n ? "-" : ""}${unscaled(product.units * 10n ** BigInt(digits - product.scale), digits)}`,
  )
  return { value: exact, formatted: formatValue(metric, exact) }
}

/** The magnitude of `units` of the last of `places` places, written: 125 at 2 is "1.25". */
function unscaled(units: bigint, places: number): string {
  const text = (units < 0n ? -units : units).toString().padStart(places + 1, "0")
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`
}

/**
 * `number` with `unit` on the side `position` says. Absent is after. The
 * unit's own spacing is kept (`metric.test.ts`).
 */
const placed = (number: string, unit: string, position: Metric["position"]) =>
  position === "before" ? `${unit}${number}` : `${number}${unit}`

/**
 * A value of `metric`: its number to the metric's decimals, its unit where
 * `position` says. A minus sign is written before both, so a leading unit
 * reads "−$0.05" (`metric.test.ts`).
 */
export function formatValue(metric: Metric, value: number): Formatted {
  const units = scaled(value, metric.decimals)
  const text = placed(unscaled(units, metric.decimals), metric.unit, metric.position)
  return (units < 0n ? `${minus}${text}` : text) as Formatted
}

/** What a size of `metric` is written in: its delta unit, or its unit. */
const sizeUnit = (metric: Metric) => metric.deltaUnit ?? metric.unit

/**
 * A size in `metric`, such as a score's interval or the noise: its magnitude
 * to the metric's decimals, with no sign, in the delta unit ("1.2 pts").
 */
export function formatSize(metric: Metric, size: number): Formatted {
  return placed(
    unscaled(scaled(size, metric.decimals), metric.decimals),
    sizeUnit(metric),
    metric.position,
  ) as Formatted
}

/**
 * The change in `metric` from `from` to `to`, as two values written side by
 * side read: the exact difference of the two as written, so the change
 * agrees with them at any size (`metric.test.ts`). Its tone is `neutral`
 * when it is 0 or within `noise` as `formatSize` writes it, and otherwise
 * `good` when it moves the way the metric's `better` says and `bad` when it
 * does not. Which noise applies is `selections.ts`'s to say (`metricChange`,
 * `guardrailChange`), so the model's barrel does not export this.
 */
export function changeBetween(
  metric: Metric,
  from: number,
  to: number,
  noise?: number,
): Change {
  const places = metric.decimals
  const units = scaled(to, places) - scaled(from, places)
  const magnitude = units < 0n ? -units : units
  const value =
    units === 0n ? 0 : Number(`${units < 0n ? "-" : ""}${unscaled(units, places)}`)
  const tone: ChangeTone =
    units === 0n || (noise !== undefined && magnitude <= scaled(noise, places))
      ? "neutral"
      : units > 0n === (metric.better === "up")
        ? "good"
        : "bad"
  const size = placed(unscaled(units, places), sizeUnit(metric), metric.position)
  return Object.freeze({ value, size, tone }) as Change
}
