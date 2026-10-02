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

/** Text a person reads: a title, a label, a reason. Never blank. */
export const text = z.string().regex(/\S/, { error: "text is not blank" })

/** A time, as milliseconds since the Unix epoch. */
export const instant = z.number().int().nonnegative()

/** A count of things: a whole number, 0 or more. */
export const count = z.number().int().nonnegative()

/**
 * The most a measured or scored number may be, either side of 0. Bounded so
 * that what the model works out from two of them — a difference, a limit's
 * ratio of the baseline's measure — stays finite and is written in plain
 * digits (`validation.test.ts`, `metric.test.ts`).
 */
export const valueBound = 1e15

/** A measured or scored number, within `valueBound`. zod refuses `NaN` and the infinities. */
export const value = z.number().min(-valueBound).max(valueBound)

/** A tone a view draws something in. */
export const tone = z.enum(["good", "bad", "neutral", "warning", "active"])
export type Tone = z.output<typeof tone>
