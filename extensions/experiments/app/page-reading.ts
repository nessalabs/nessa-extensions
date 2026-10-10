/**
 * What the pages show, read from the definition and from what the harness
 * decided. Titles a page can be given default to these. The path is
 * `bestSoFar` in order, not a run's parent chain. Numbers are `Formatted`
 * and `Change` from the model; this module does not write one itself.
 */
import { formatCount } from "./count.ts"
import { areaCards } from "./reading.ts"
import type { Change, Formatted, Tone } from "../model/index.ts"
import {
  bestVersion,
  formatValue,
  limitOf,
  lineage,
  measureOf,
  metricChange,
  pathToBest,
  primarySplitOf,
  runOf,
  runsNewestFirst,
  scoreOf,
  verdictOf,
  type Experiment,
  type Run,
} from "../model/index.ts"

export interface Headline {
  /** The metric's name. */
  readonly title: string
  /** The primary split's label. */
  readonly subtitle: string
  readonly value?: Formatted
  readonly change?: Change
  /** The baseline's score, once it has one. */
  readonly from?: Formatted
  readonly kept: string
}

export interface PathStepRead {
  readonly runId: string
  readonly number: number
  readonly label: string
  readonly gain?: Change
}

export interface SwarmRead {
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly runId?: string
}

export interface NoteRead {
  readonly key: string
  readonly tone: Tone
  readonly text: string
  readonly runId?: string
}

export interface RunRow {
  readonly id: string
  readonly number: number
  readonly verdictId: string
  readonly verdict: string
  readonly tone: Tone
  readonly outcome: "kept" | "rejected" | "pending"
  readonly score?: Formatted
  readonly change?: Change
  readonly area?: string
  readonly reason: string
}

export interface GuardrailRead {
  readonly id: string
  readonly name: string
  readonly value?: Formatted
  readonly limit: string
}

export interface OutcomeRead {
  readonly number: number
  readonly verdict: string
  readonly tone: Tone
  readonly reason: string
  readonly scoreLabel: string
  readonly score?: Formatted
  readonly change?: Change
  readonly guardrails: readonly GuardrailRead[]
}

export interface LineageStep {
  readonly key: string
  readonly label: string
  /** Absent for the baseline, which is not a run to open. */
  readonly runId?: string
  readonly current: boolean
}

export interface AreaGain {
  readonly id: string
  readonly name: string
  readonly score: Formatted
  readonly change?: Change
}

function parentMean(experiment: Experiment, run: Run): number | undefined {
  const parent =
    run.parentId === experiment.baseline.id
      ? experiment.baseline
      : runOf(experiment, run.parentId)
  if (parent === undefined) return undefined
  return scoreOf(parent, experiment.definition.primarySplit)?.mean
}

/** The best version, against the baseline, in the metric's own words. */
export function headline(experiment: Experiment): Headline {
  const { metric } = experiment.definition
  const split = primarySplitOf(experiment)
  const best = bestVersion(experiment)
  const baseline = scoreOf(experiment.baseline, split.id)?.mean
  const mean = best.kind === "baseline" ? baseline : scoreOf(best.run, split.id)?.mean
  const from = baseline === undefined ? undefined : formatValue(metric, baseline)
  const change =
    best.kind === "run" && baseline !== undefined && mean !== undefined
      ? metricChange(experiment, baseline, mean)
      : undefined
  const kept = experiment.runs.filter(
    (run) => verdictOf(experiment, run).outcome === "kept",
  ).length
  const settled = experiment.runs.filter((run) => run.settledAt !== undefined).length
  return {
    title: metric.name,
    subtitle: split.label,
    ...(mean === undefined ? {} : { value: formatValue(metric, mean) }),
    ...(change === undefined ? {} : { change }),
    ...(from === undefined ? {} : { from }),
    kept: `${formatCount(kept)} kept of ${formatCount(settled)} settled`,
  }
}

/** `bestSoFar` in order, each with what it gained on the one before. */
export function pathSteps(experiment: Experiment): readonly PathStepRead[] {
  return pathToBest(experiment).map(({ run, gain }) => ({
    runId: run.id,
    number: run.number,
    label: run.change?.summary ?? run.reason,
    ...(gain === undefined ? {} : { gain }),
  }))
}

/** What each agent is doing now. None when the experiment has no agents. */
export function swarmNow(experiment: Experiment): readonly SwarmRead[] {
  return experiment.agents.map((agent) => {
    if (agent.activity.kind === "evaluating") {
      const run = runOf(experiment, agent.activity.runId)
      return {
        id: agent.id,
        name: agent.name,
        detail: run === undefined ? "Evaluating" : `Evaluating run ${run.number}`,
        ...(run === undefined ? {} : { runId: run.id }),
      }
    }
    return { id: agent.id, name: agent.name, detail: agent.activity.note }
  })
}

/** The harness's notes, in the order it gave them. */
export function noteReads(experiment: Experiment): readonly NoteRead[] {
  return experiment.notes.map((note, index) => ({
    key: `${index}:${note.at}`,
    tone: note.tone,
    text: note.text,
    ...(note.runId === undefined ? {} : { runId: note.runId }),
  }))
}

/** Areas that have a latest score. None when the experiment has no areas. */
export function areaGains(experiment: Experiment): readonly AreaGain[] {
  return areaCards(experiment).flatMap((card) =>
    card.score === undefined
      ? []
      : [
          {
            id: card.id,
            name: card.name,
            score: card.score,
            ...(card.change === undefined ? {} : { change: card.change }),
          },
        ],
  )
}

/** One run, with its score on the primary split against what it was built on. */
export function runRow(experiment: Experiment, run: Run): RunRow {
  const { metric, primarySplit } = experiment.definition
  const verdict = verdictOf(experiment, run)
  const score = scoreOf(run, primarySplit)
  const from = parentMean(experiment, run)
  const change =
    score === undefined || from === undefined
      ? undefined
      : metricChange(experiment, from, score.mean)
  const area = experiment.areas.find((each) => each.id === run.areaId)
  return {
    id: run.id,
    number: run.number,
    verdictId: verdict.id,
    verdict: verdict.label,
    tone: verdict.tone,
    outcome: verdict.outcome,
    ...(score === undefined ? {} : { score: formatValue(metric, score.mean) }),
    ...(change === undefined ? {} : { change }),
    ...(area === undefined ? {} : { area: area.name }),
    reason: run.reason,
  }
}

/** Every run, newest first, with its score on the primary split. */
export function runRows(experiment: Experiment): readonly RunRow[] {
  return runsNewestFirst(experiment).map((run) => runRow(experiment, run))
}

function limitText(experiment: Experiment, guardrailId: string): string | undefined {
  const limit = limitOf(experiment, guardrailId)
  if (limit === undefined) return undefined
  if (limit.kind === "not-measured-yet") return "Not measured yet"
  return limit.bound === "at-most"
    ? `At most ${limit.formatted}`
    : `At least ${limit.formatted}`
}

/** A run's outcome: its verdict, its score, and each guardrail the definition names. */
export function outcomeRead(experiment: Experiment, run: Run): OutcomeRead {
  const { metric, primarySplit, guardrails } = experiment.definition
  const verdict = verdictOf(experiment, run)
  const score = scoreOf(run, primarySplit)
  const from = parentMean(experiment, run)
  const change =
    score === undefined || from === undefined
      ? undefined
      : metricChange(experiment, from, score.mean)
  return {
    number: run.number,
    verdict: verdict.label,
    tone: verdict.tone,
    reason: run.reason,
    scoreLabel: primarySplitOf(experiment).label,
    ...(score === undefined ? {} : { score: formatValue(metric, score.mean) }),
    ...(change === undefined ? {} : { change }),
    guardrails: guardrails.flatMap((guardrail) => {
      const limit = limitText(experiment, guardrail.id)
      if (limit === undefined) return []
      const measure = measureOf(run, guardrail.id)
      return [
        {
          id: guardrail.id,
          name: guardrail.metric.name,
          ...(measure === undefined
            ? {}
            : { value: formatValue(guardrail.metric, measure) }),
          limit,
        },
      ]
    }),
  }
}

/**
 * The lineage of `runId`: the baseline, then each parent, the run last.
 * Undefined when the experiment has no such run.
 */
export function lineageSteps(
  experiment: Experiment,
  runId: string,
): readonly LineageStep[] | undefined {
  const line = lineage(experiment, runId)
  if (line === undefined) return undefined
  return [
    { key: `baseline:${line.baseline.id}`, label: "Baseline", current: false },
    ...line.runs.map((run) => ({
      key: run.id,
      label: `Run ${run.number}`,
      runId: run.id,
      current: run.id === runId,
    })),
  ]
}

/**
 * The runs view's subtitle. With no filter it is how many runs the list has.
 * With a filter it names that verdict and how many of the list it shows.
 */
export function runsSubtitle(
  count: number,
  filtered?: { readonly count: number; readonly label: string },
): string {
  const all = count === 1 ? "1 run" : `${formatCount(count)} runs`
  if (filtered === undefined) return all
  const name = filtered.label.toLowerCase()
  return `${formatCount(filtered.count)} ${name} of ${all}`
}
