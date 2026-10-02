/**
 * The values every part of an experiment is written in: ids, text, times,
 * counts, and numbers. Each is a zod schema, so the shape of an experiment is
 * declared once (`definition.ts`, `experiment.ts`) and its types are derived
 * from it.
 */
import { z } from "zod/v4"

/**
 * An id: 1–128 letters, digits, `.`, `_`, `:` or `-`, starting with a letter
 * or digit. Ids key tables (a run's `scores` by split id, its `measures` by
 * guardrail id), and the alphabet keeps them plain: no `__proto__`, no `/`.
 * (A table's own `__proto__` key is refused by `refuseProto` in
 * `experiment.ts`, since zod's record drops it before its key schema runs.)
 */
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, {
  error: "an id is 1–128 of A–Z a–z 0–9 . _ : -, starting with a letter or digit",
})

/** Whether `value` is an id, by `id`'s rule: for checking what names one outside an experiment. */
export function isId(value: string): boolean {
  return id.safeParse(value).success
}

/**
 * A number JSON carries as it is: any but `-0`, which JSON writes as `0`.
 * Every number in an experiment is one, so a valid experiment is exactly what
 * JSON carries (`validation.test.ts`, "is exactly what JSON carries").
 */
export const number = z.number().refine((n) => !Object.is(n, -0), {
  error: "-0 is not a number JSON carries: it writes 0",
})

/** Text a person reads: a title, a label, a reason. Never blank. */
export const text = z.string().regex(/\S/, { error: "text is not blank" })

/**
 * The latest time a `Date` holds, in milliseconds since the epoch (ECMA-262's
 * time value range), so every instant can be written as a date.
 */
const latestInstant = 8.64e15

/** A time, as milliseconds since the Unix epoch, up to `latestInstant`. */
export const instant = number.int().nonnegative().max(latestInstant)

/**
 * The most a measured or scored number may be, either side of 0, and the most
 * a count may be. Bounded so that what the model works out from them stays
 * exact: a difference or a limit's ratio of the baseline's measure, worked
 * in `bigint` (`metric.ts`), and a slice's sums of counts, which stay well
 * within the 2^53 a double holds exactly (`slice.ts`; `validation.test.ts`).
 */
export const valueBound = 1e15

/** A count of things: a whole number, 0 to `valueBound`. */
export const count = number.int().nonnegative().max(valueBound)

/** A measured or scored number, within `valueBound`. zod refuses `NaN` and the infinities. */
export const value = number.min(-valueBound).max(valueBound)

/** A tone a view draws something in. */
export const tone = z.enum(["good", "bad", "neutral", "warning", "active"])
export type Tone = z.output<typeof tone>
