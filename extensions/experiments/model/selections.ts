/**
 * What the views read from a validated experiment: the best version, the
 * climb, the path to the best, a run's lineage, runs in order, and a
 * guardrail's limit. Each is read from what the harness said — `bestSoFar`,
 * `settledAt`, the verdicts — and none works out a decision again: the best
 * run is not found here by score or by order (nessa-agent ADR 333, "The
 * harness decides, the window shows"; `selections.test.ts`, "bestVersion").
 */
import type { Baseline, Cases, Experiment, Run, RunChange, Score } from "./experiment.ts"
import { changeBetween, formatValue, type Change, type Formatted } from "./metric.ts"

/** Something scored and measured: the baseline or a run. */
type Scored = Pick<Baseline, "scores" | "measures">

/** `owner`'s score on `splitId`, if it has one. */
export function scoreOf(owner: Scored, splitId: string): Score | undefined {
  return Object.hasOwn(owner.scores, splitId) ? owner.scores[splitId] : undefined
}

/** `owner`'s measure for `guardrailId`, if it has one. */
export function measureOf(owner: Scored, guardrailId: string): number | undefined {
  return Object.hasOwn(owner.measures, guardrailId)
    ? owner.measures[guardrailId]
    : undefined
}

/** The run with `id`, if there is one. */
export function runOf(experiment: Experiment, id: string): Run | undefined {
  return experiment.runs.find((run) => run.id === id)
}

/** The runs by id. Validation holds that ids are unique. */
const runsById = (experiment: Experiment): ReadonlyMap<string, Run> =>
  new Map(experiment.runs.map((run) => [run.id, run]))

/** Whether the baseline has a score on the primary split yet. */
export function isBaselineScored(experiment: Experiment): boolean {
  return scoreOf(experiment.baseline, experiment.definition.primarySplit) !== undefined
}

/** The best version: the last of `bestSoFar`, or the baseline while it is empty. */
export type BestVersion =
  | { readonly kind: "baseline"; readonly baseline: Baseline }
  | { readonly kind: "run"; readonly run: Run }

export function bestVersion(experiment: Experiment): BestVersion {
  const last = experiment.bestSoFar.at(-1)
  // Validation holds that every bestSoFar id names a run.
  const run = last === undefined ? undefined : runOf(experiment, last)
  return run === undefined
    ? { kind: "baseline", baseline: experiment.baseline }
    : { kind: "run", run }
}

/** A settled run's score on the primary split, at the time it settled. */
export interface ClimbPoint {
  readonly runId: string
  readonly at: number
  readonly value: number
}

/** Where the best-so-far line steps to: the baseline's score, or a kept run's. */
export interface BestStep {
  /** The kept run; absent for the baseline. */
  readonly runId?: string
  readonly at: number
  readonly value: number
}

/** The climb, over time: every settled, scored run, and the best-so-far line. */
export interface Climb {
  /** In the order they settled; runs settled at one time by number. */
  readonly points: readonly ClimbPoint[]
  /**
   * From the baseline's score at the experiment's start, once it is scored,
   * then a step at each `bestSoFar` run's `settledAt`, in that order.
   */
  readonly best: readonly BestStep[]
}

export function climb(experiment: Experiment): Climb {
  const { primarySplit } = experiment.definition
  const points = experiment.runs
    .flatMap((run) => {
      const score = scoreOf(run, primarySplit)
      return run.settledAt === undefined || score === undefined
        ? []
        : [{ run, point: { runId: run.id, at: run.settledAt, value: score.mean } }]
    })
    .sort((a, b) => a.point.at - b.point.at || a.run.number - b.run.number)
    .map(({ point }) => point)
  const baseline = scoreOf(experiment.baseline, primarySplit)
  const best: BestStep[] =
    baseline === undefined ? [] : [{ at: experiment.startedAt, value: baseline.mean }]
  const byId = runsById(experiment)
  for (const runId of experiment.bestSoFar) {
    const run = byId.get(runId)
    const score = run === undefined ? undefined : scoreOf(run, primarySplit)
    // Validation holds that each is a kept, settled run scored on the primary split.
    if (run?.settledAt === undefined || score === undefined) continue
    best.push({ runId, at: run.settledAt, value: score.mean })
  }
  return { points, best }
}

/** A step on the path to the best version, and what it gained on the one before. */
export interface PathStep {
  readonly run: Run
  /** On the primary split, against the step before (the baseline first); absent while that one is not scored. */
  readonly gain?: Change
}

/** `bestSoFar` in order, each with its gain. */
export function pathToBest(experiment: Experiment): readonly PathStep[] {
  const { metric, primarySplit, noise } = experiment.definition
  const byId = runsById(experiment)
  let before = scoreOf(experiment.baseline, primarySplit)?.mean
  return experiment.bestSoFar.flatMap((runId) => {
    const run = byId.get(runId)
    if (run === undefined) return []
    const mean = scoreOf(run, primarySplit)?.mean
    const gain =
      before === undefined || mean === undefined
        ? undefined
        : changeBetween(metric, before, mean, noise)
    before = mean
    return [gain === undefined ? { run } : { run, gain }]
  })
}

/** What a run was built on, from the baseline down to the run itself. */
export interface Lineage {
  readonly baseline: Baseline
  /** Each run's parent before it, the run last. */
  readonly runs: readonly Run[]
}

/**
 * The lineage of the run with `runId`, or `undefined` when there is no such
 * run. It ends: validation holds that each parent is the baseline or a
 * lower-numbered run.
 */
export function lineage(experiment: Experiment, runId: string): Lineage | undefined {
  const byId = runsById(experiment)
  const chain: Run[] = []
  let at = byId.get(runId)
  if (at === undefined) return undefined
  while (at !== undefined) {
    chain.unshift(at)
    at = byId.get(at.parentId)
  }
  return { baseline: experiment.baseline, runs: chain }
}

/** Newest first: by `startedAt`, then by `number`. */
const newest = (a: Run, b: Run) => b.startedAt - a.startedAt || b.number - a.number

/** The runs newest first: by `startedAt`, then by `number`. */
export function runsNewestFirst(experiment: Experiment): readonly Run[] {
  return [...experiment.runs].sort(newest)
}

/**
 * The runs by their score on `splitId`, best first by the metric's `better`;
 * runs with no score there after them. Runs that tie are newest first.
 */
export function runsByScore(experiment: Experiment, splitId: string): readonly Run[] {
  const sign = experiment.definition.metric.better === "up" ? -1 : 1
  return [...experiment.runs].sort((a, b) => {
    const left = scoreOf(a, splitId)
    const right = scoreOf(b, splitId)
    if (left === undefined || right === undefined) {
      return left === right ? newest(a, b) : left === undefined ? 1 : -1
    }
    return sign * (left.mean - right.mean) || newest(a, b)
  })
}

/** A guardrail's limit as a value of its metric, or why it has none yet. */
export type ResolvedLimit =
  | {
      readonly kind: "limit"
      readonly bound: "at-most" | "at-least"
      readonly value: number
      readonly formatted: Formatted
    }
  /** Limited relative to the baseline, which has no measure for it yet. */
  | { readonly kind: "not-measured-yet" }

/**
 * The limit of the guardrail with `guardrailId`, or `undefined` when there is
 * no such guardrail. A limit relative to the baseline is its ratio of the
 * baseline's measure.
 */
export function limitOf(
  experiment: Experiment,
  guardrailId: string,
): ResolvedLimit | undefined {
  const guardrail = experiment.definition.guardrails.find(
    (each) => each.id === guardrailId,
  )
  if (guardrail === undefined) return undefined
  const { bound, relativeTo } = guardrail.limit
  let value = guardrail.limit.value
  if (relativeTo === "baseline") {
    const measure = measureOf(experiment.baseline, guardrailId)
    if (measure === undefined) return { kind: "not-measured-yet" }
    value *= measure
  }
  return { kind: "limit", bound, value, formatted: formatValue(guardrail.metric, value) }
}

/** How many of a run's cases moved: those fixed and those broken. */
export function movedCount(cases: Cases): number {
  return cases.fixed + cases.broken
}

/** Lines a change added and removed, over all its files. */
export function lineTotals(change: RunChange): {
  readonly added: number
  readonly removed: number
} {
  let added = 0
  let removed = 0
  for (const file of change.files) {
    added += file.added
    removed += file.removed
  }
  return { added, removed }
}
