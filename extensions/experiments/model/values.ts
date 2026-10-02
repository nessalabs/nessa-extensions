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
 * guardrail id), so the alphabet is what keeps a key such as `__proto__` —
 * which a JavaScript object cannot hold as its own — out of one
 * (`validation.test.ts`, "a split id a table cannot own").
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

/** A measured or scored number. zod refuses `NaN` and the infinities. */
export const value = z.number()

/** A tone a view draws something in. */
export const tone = z.enum(["good", "bad", "neutral", "warning", "active"])
export type Tone = z.output<typeof tone>
