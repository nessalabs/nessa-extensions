/**
 * What kind of experiment this is, as data: the metric it climbs, the splits
 * each run is scored on, the guardrails it must stay within, and the verdicts
 * its harness gives. Every view reads an experiment through its definition, so
 * a percent score that should rise and a latency that should fall are drawn by
 * the same views (nessa-agent ADR 333, "The definition").
 *
 * The definition arrives over the wire, so it carries no functions: a unit, a
 * delta unit, where that unit is written, and a number of decimals say how a
 * metric's numbers read (`metric.ts`).
 */
import { z } from "zod/v4"

import { id, number, text, tone, value } from "./values.ts"

/** What is measured, and how its numbers read. */
export const metric = z
  .strictObject({
    id,
    name: text,
    /** Written with a value as given, spacing included: "%", " ms", "$". */
    unit: z.string(),
    /** Written with a change instead of `unit`, when it differs: " pts". */
    deltaUnit: z.string().exactOptional(),
    /**
     * Where `unit` and `deltaUnit` are written. Absent means after the number,
     * which is what `metric.ts` reads; a value present must be `before` or
     * `after` (`validation.test.ts`).
     */
    position: z.enum(["before", "after"]).exactOptional(),
    /** Which way is better. */
    better: z.enum(["up", "down"]),
    /** Decimals a value and a change are written with: a whole number, 0–10. */
    decimals: number.int().min(0).max(10),
  })
  .readonly()
export type Metric = z.output<typeof metric>

/**
 * A limit a guardrail's measure must stay within. With `relativeTo:
 * "baseline"`, `value` is a ratio of the baseline's measure (1.1 is 10% above
 * it).
 */
export const limit = z
  .strictObject({
    bound: z.enum(["at-most", "at-least"]),
    value,
    relativeTo: z.literal("baseline").exactOptional(),
  })
  .readonly()
export type Limit = z.output<typeof limit>

/** What runs are scored on: "train", "test". */
export const split = z.strictObject({ id, label: text }).readonly()
export type Split = z.output<typeof split>

/** A limit a run must stay within, on a metric of its own. */
export const guardrail = z.strictObject({ id, metric, limit }).readonly()
export type Guardrail = z.output<typeof guardrail>

/**
 * What a verdict means for the climb. `kept`: the run became the new best.
 * `rejected`: settled and not kept. `pending`: not decided yet.
 */
export const outcome = z.enum(["kept", "rejected", "pending"])
export type Outcome = z.output<typeof outcome>

/** A verdict the harness gives runs, with the label and tone it is shown in. */
export const verdict = z.strictObject({ id, label: text, tone, outcome }).readonly()
export type Verdict = z.output<typeof verdict>

/** Every experiment arrives with one; see this module's comment. */
export const experimentDefinition = z
  .strictObject({
    /** The metric the climb is on. */
    metric,
    /** What each run is scored on. */
    splits: z.array(split).readonly(),
    /** Which of `splits` the climb follows. */
    primarySplit: id,
    /** Limits a run must stay within, each on a metric of its own. */
    guardrails: z.array(guardrail).readonly(),
    /** The verdicts runs are given, in the order a filter lists them. */
    verdicts: z.array(verdict).readonly(),
    /** Changes of the metric within it read as neutral: 0 or more. */
    noise: value.nonnegative().exactOptional(),
    /** A value to draw a line at, with what it is ("best model, max effort"). */
    reference: z.strictObject({ value, label: text }).readonly().exactOptional(),
    /** How many runs the experiment may spend: a whole number, 1 or more. */
    budget: z
      .strictObject({ runs: number.int().min(1) })
      .readonly()
      .exactOptional(),
    /** What a case is called: "test case", "prompt", "request". */
    caseNoun: z.strictObject({ one: text, other: text }).readonly().exactOptional(),
  })
  .readonly()
export type ExperimentDefinition = z.output<typeof experimentDefinition>
