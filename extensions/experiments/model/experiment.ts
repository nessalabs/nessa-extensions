/**
 * An experiment: its definition, its baseline and runs, the areas and agents
 * working on it, the harness's notes, and — from the harness — `bestSoFar`,
 * the runs that became the best, in the order they did (nessa-agent ADR 333).
 *
 * `experimentData` is the shape, as a zod schema; `Experiment` is that shape
 * once `validateExperiment` (`validation.ts`) has also checked the rules that
 * span fields. Every schema here is `.readonly()`, so what zod makes is frozen
 * at every level, and typed so (`validation.test.ts`, "is frozen at every
 * level").
 *
 * The harness decides; this model only carries what it decided. Whether a run
 * was kept, which run is best, and why, are the harness's, made with evidence
 * the views do not have, and are not worked out again here or in
 * `selections.ts` (`selections.test.ts`, "bestVersion").
 */
import { z } from "zod/v4"

import { experimentDefinition } from "./definition.ts"
import { count, id, instant, text, tone, value } from "./values.ts"

/** A run's score on one split: its mean, and the half-width of its confidence interval. */
export const score = z
  .strictObject({ mean: value, interval: value.nonnegative().optional() })
  .readonly()
export type Score = z.output<typeof score>

/**
 * Refuses an own `__proto__` key, which zod's record skips without a word
 * (zod 4.6) where its key schema would refuse it as an id. It runs in the
 * same parse, before the record; `validation.test.ts` holds both.
 */
function refuseProto(input: unknown, context: z.RefinementCtx) {
  if (input !== null && typeof input === "object" && Object.hasOwn(input, "__proto__")) {
    context.addIssue({
      code: "custom",
      path: ["__proto__"],
      message: "__proto__ is not an id",
    })
  }
}

/** Scores by split id. */
const scores = z
  .custom<Readonly<Record<string, z.input<typeof score>>>>()
  .superRefine(refuseProto)
  .pipe(z.record(id, score).readonly())
/** Measures by guardrail id. */
const measures = z
  .custom<Readonly<Record<string, number>>>()
  .superRefine(refuseProto)
  .pipe(z.record(id, value).readonly())

/**
 * A named group of a run's cases, such as a category, and how many of them
 * passed before the run and after it.
 */
export const slice = z
  .strictObject({
    name: text,
    total: count,
    passingBefore: count,
    passingAfter: count,
  })
  .readonly()
export type Slice = z.output<typeof slice>

/** One case whose outcome the run changed. */
export const movedCase = z
  .strictObject({
    /** The case's id in its suite, as the source writes it: unique in the page. */
    id: text,
    title: text,
    /** The name of the run's slice it is in. */
    slice: text,
    move: z.enum(["fixed", "broken"]),
  })
  .readonly()
export type MovedCase = z.output<typeof movedCase>

/** The most moved cases one page from the source holds. */
export const movedPageSize = 200

/**
 * A run's cases, as counts, at any size: a suite of a million is the same
 * few numbers as one of sixty. How many moved is `fixed` and `broken`
 * together, not a field of its own; `moved` is one page of them.
 */
export const cases = z
  .strictObject({
    total: count,
    fixed: count,
    broken: count,
    slices: z.array(slice).readonly(),
    moved: z.array(movedCase).max(movedPageSize).readonly(),
  })
  .readonly()
export type Cases = z.output<typeof cases>

/** A file a run changed, and how many lines it added and removed. */
export const changedFile = z
  .strictObject({
    path: text,
    status: z.enum(["added", "modified", "deleted", "renamed"]),
    added: count,
    removed: count,
  })
  .readonly()
export type ChangedFile = z.output<typeof changedFile>

/** What a run changed: in a sentence, and every file it touched. */
export const runChange = z
  .strictObject({ summary: text, files: z.array(changedFile).readonly() })
  .readonly()
export type RunChange = z.output<typeof runChange>

/** How far the harness is through evaluating a run, in cases. */
export const progress = z.strictObject({ done: count, total: count }).readonly()
export type Progress = z.output<typeof progress>

/**
 * One change tried and judged. `number` is the harness's label for it, from 1,
 * higher for a later-made run; nothing but lineage reads an order into it.
 */
export const run = z
  .strictObject({
    id,
    number: z.number().int().min(1),
    startedAt: instant,
    /** While it is being evaluated, when the harness says. */
    progress: progress.optional(),
    /**
     * When its outcome last changed: a keep decided after reruns moves it, a
     * rerun that confirms the same outcome does not. Present exactly when its
     * verdict's outcome is not `pending` (the rule `settled-when-decided`).
     */
    settledAt: instant.optional(),
    /** What it was built on: the baseline's id, or an earlier run's. */
    parentId: id,
    scores,
    measures,
    /** The id of one of the definition's verdicts. */
    verdict: id,
    /** The harness's reason for its verdict. */
    reason: text,
    areaId: id.optional(),
    agentId: id.optional(),
    cases: cases.optional(),
    change: runChange.optional(),
  })
  .readonly()
export type Run = z.output<typeof run>

/**
 * What runs are judged against. Not a run: it has no parent, verdict or time
 * to get wrong. It is scored once it has a score on the primary split.
 */
export const baseline = z.strictObject({ id, scores, measures }).readonly()
export type Baseline = z.output<typeof baseline>

/**
 * SVG path data: a move, then commands and numbers only, so it can only ever
 * be a path (`validation.test.ts`, "a glyph that is not path data").
 */
const pathData = z.string().regex(/^\s*[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$/, {
  error: "a glyph is SVG path data: a move, then commands, numbers, commas and spaces",
})

/** Part of the product the agents work on, with what it is drawn as. */
export const area = z
  .strictObject({
    id,
    name: text,
    /** An SVG path on a 16-unit grid. */
    glyph: pathData,
    /** Which of the series hues it is drawn in. */
    hue: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  })
  .readonly()
export type Area = z.output<typeof area>

/** What an agent is doing now. */
export const activity = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("evaluating"), runId: id }).readonly(),
  z
    .strictObject({
      kind: z.enum(["drafting", "diagnosing", "resting"]),
      note: text,
    })
    .readonly(),
])
export type Activity = z.output<typeof activity>

/** One of the agents working on the experiment. */
export const agent = z
  .strictObject({
    id,
    name: text,
    since: instant,
    /** The brief it was given. */
    brief: text,
    areaId: id.optional(),
    model: text.optional(),
    activity,
  })
  .readonly()
export type Agent = z.output<typeof agent>

/** Something the harness said, and the run it is about, if any. */
export const note = z
  .strictObject({ tone, text, at: instant, runId: id.optional() })
  .readonly()
export type Note = z.output<typeof note>

/** The shape of an experiment, before the rules that span its fields are checked. */
export const experimentData = z
  .strictObject({
    id,
    title: text,
    goal: text,
    /** The conversation that runs it: the host's id, written as the host writes it. */
    sessionId: text,
    startedAt: instant,
    notes: z.array(note).readonly(),
    definition: experimentDefinition,
    areas: z.array(area).readonly(),
    agents: z.array(agent).readonly(),
    baseline,
    runs: z.array(run).readonly(),
    /** The ids of the runs that became the best, in the order they did. */
    bestSoFar: z.array(id).readonly(),
  })
  .readonly()

/** What a source hands `validateExperiment`, typed: what `experimentData` accepts. */
export type ExperimentInput = z.input<typeof experimentData>

/** An experiment's shape; only `validateExperiment`'s output is an `Experiment`. */
export type ExperimentData = z.output<typeof experimentData>

/**
 * The brand. A class's private member is not copied by an object spread, so
 * `{ ...experiment, runs }` is not an `Experiment`, as a symbol-keyed brand
 * would be; `validation.test.ts` holds that with `@ts-expect-error`.
 */
declare class Validated {
  private readonly validated: true
}

/**
 * An experiment `validateExperiment` checked. Only it makes one — by a cast,
 * in one place, of the frozen copy its parser made — so a view cannot be
 * handed one that was not checked (`validation.test.ts`, "is the only way to
 * an Experiment").
 */
export type Experiment = ExperimentData & Validated
