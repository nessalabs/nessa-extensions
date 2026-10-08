/**
 * What a view shows of an experiment, read from the definition and from what
 * the harness decided. Labels are the definition's (a metric's name, a
 * split's label, a verdict's label and tone). Numbers are `Formatted` and
 * `Change` from `model/metric.ts`; this module does not write a metric
 * number itself. It does not decide which run is best (`selections.ts` does)
 * and it does not place pixels (`geometry.ts` does).
 */
import { formatCount, countLabel } from "./count.ts"
import type {
  Area,
  Change,
  Experiment,
  Formatted,
  Outcome,
  Run,
  Tone,
} from "../model/index.ts"
import {
  climb,
  formatValue,
  lineTotals,
  metricChange,
  runOf,
  scoreOf,
  verdictOf,
} from "../model/index.ts"

export interface ScoreRead {
  readonly label: string
  readonly value: Formatted
  readonly change?: Change
}

export interface ClimbPointRead {
  readonly runId: string
  readonly at: number
  readonly value: number
  readonly number: number
  readonly verdict: string
  readonly tone: Tone
  readonly outcome: Outcome
  readonly hue?: Area["hue"]
  readonly summary?: string
  readonly reason: string
  readonly area?: string
  readonly agent?: string
  readonly score: Formatted
  readonly scores: readonly ScoreRead[]
}

export interface ClimbRead {
  readonly title: string
  /** The primary split's label, from the definition. */
  readonly caption: string
  readonly metricName: string
  readonly noise?: number
  readonly reference?: {
    readonly value: number
    readonly label: string
    readonly formatted: Formatted
  }
  readonly points: readonly ClimbPointRead[]
  readonly best: readonly { readonly at: number; readonly value: number }[]
}

/** The parent a run was built on: the baseline, or an earlier run. */
function parentOf(experiment: Experiment, run: Run) {
  if (run.parentId === experiment.baseline.id) return experiment.baseline
  return runOf(experiment, run.parentId)
}

/** The change on `splitId` from what `run` was built on. The tone is `metricChange`'s. */
function changeOn(experiment: Experiment, run: Run, splitId: string): Change | undefined {
  const to = scoreOf(run, splitId)?.mean
  const parent = parentOf(experiment, run)
  const from = parent === undefined ? undefined : scoreOf(parent, splitId)?.mean
  if (from === undefined || to === undefined) return undefined
  return metricChange(experiment, from, to)
}

function areaOf(experiment: Experiment, areaId: string | undefined): Area | undefined {
  if (areaId === undefined) return undefined
  return experiment.areas.find((area) => area.id === areaId)
}

function agentName(
  experiment: Experiment,
  agentId: string | undefined,
): string | undefined {
  if (agentId === undefined) return undefined
  return experiment.agents.find((agent) => agent.id === agentId)?.name
}

/** The climb as the chart reads it: settled, scored runs, and the best line as given. */
export function climbRead(experiment: Experiment): ClimbRead {
  const { metric, noise, reference, primarySplit } = experiment.definition
  const series = climb(experiment)
  const caption = experiment.definition.splits.find(
    (split) => split.id === primarySplit,
  )?.label
  const points = series.points.flatMap((point) => {
    const run = runOf(experiment, point.runId)
    if (run === undefined) return []
    const verdict = verdictOf(experiment, run)
    const area = areaOf(experiment, run.areaId)
    const agent = agentName(experiment, run.agentId)
    const scores = experiment.definition.splits.flatMap((split) => {
      const score = scoreOf(run, split.id)
      if (score === undefined) return []
      const change = changeOn(experiment, run, split.id)
      return [
        {
          label: split.label,
          value: formatValue(metric, score.mean),
          ...(change === undefined ? {} : { change }),
        },
      ]
    })
    return [
      {
        runId: run.id,
        at: point.at,
        value: point.value,
        number: run.number,
        verdict: verdict.label,
        tone: verdict.tone,
        outcome: verdict.outcome,
        ...(area === undefined ? {} : { hue: area.hue, area: area.name }),
        ...(run.change === undefined ? {} : { summary: run.change.summary }),
        reason: run.reason,
        ...(agent === undefined ? {} : { agent }),
        score: formatValue(metric, point.value),
        scores,
      },
    ]
  })
  return {
    title: metric.name,
    caption: caption ?? metric.name,
    metricName: metric.name,
    ...(noise === undefined ? {} : { noise }),
    ...(reference === undefined
      ? {}
      : {
          reference: {
            value: reference.value,
            label: reference.label,
            formatted: formatValue(metric, reference.value),
          },
        }),
    points,
    best: series.best.map((step) => ({ at: step.at, value: step.value })),
  }
}

export interface AreaRunRead {
  readonly id: string
  readonly label: string
  readonly tone: Tone
  readonly outcome: Outcome
}

export interface AreaAgentRead {
  readonly id: string
  readonly name: string
  readonly note?: string
  readonly status?: { readonly label: string; readonly tone: Tone }
}

export interface AreaCardRead {
  readonly id: string
  readonly name: string
  readonly glyph: string
  readonly hue: Area["hue"]
  readonly status?: { readonly label: string; readonly tone: Tone }
  readonly score?: Formatted
  readonly change?: Change
  readonly caption: string
  readonly runs: readonly AreaRunRead[]
  readonly agents: readonly AreaAgentRead[]
}

function verdictRead(
  experiment: Experiment,
  run: Run,
): { label: string; tone: Tone; outcome: Outcome } {
  const verdict = verdictOf(experiment, run)
  return { label: verdict.label, tone: verdict.tone, outcome: verdict.outcome }
}

/** One card per area, in the definition's order. None when the experiment has no areas. */
export function areaCards(experiment: Experiment): readonly AreaCardRead[] {
  const { metric, primarySplit } = experiment.definition
  return experiment.areas.map((area) => {
    const runs = experiment.runs
      .filter((run) => run.areaId === area.id)
      .sort((a, b) => a.startedAt - b.startedAt || a.number - b.number)
    const settled = runs
      .filter((run) => run.settledAt !== undefined)
      .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0) || b.number - a.number)
    const latest = settled[0]
    const evaluating = experiment.agents.find(
      (agent) => agent.areaId === area.id && agent.activity.kind === "evaluating",
    )
    const evaluatingRun =
      evaluating?.activity.kind === "evaluating"
        ? runOf(experiment, evaluating.activity.runId)
        : undefined
    const statusRun = evaluatingRun ?? latest
    const score = latest === undefined ? undefined : scoreOf(latest, primarySplit)
    const change =
      latest === undefined ? undefined : changeOn(experiment, latest, primarySplit)
    return {
      id: area.id,
      name: area.name,
      glyph: area.glyph,
      hue: area.hue,
      ...(statusRun === undefined ? {} : { status: verdictRead(experiment, statusRun) }),
      ...(score === undefined ? {} : { score: formatValue(metric, score.mean) }),
      ...(change === undefined ? {} : { change }),
      caption: metric.name,
      runs: runs.map((run) => ({ id: run.id, ...verdictRead(experiment, run) })),
      agents: experiment.agents
        .filter((agent) => agent.areaId === area.id)
        .map((agent) => {
          if (agent.activity.kind === "evaluating") {
            const run = runOf(experiment, agent.activity.runId)
            return {
              id: agent.id,
              name: agent.name,
              ...(run === undefined ? {} : { status: verdictRead(experiment, run) }),
            }
          }
          return { id: agent.id, name: agent.name, note: agent.activity.note }
        }),
    }
  })
}

export interface MapRunRead {
  readonly runId: string
  readonly areaId: string
  readonly at: number
  readonly number: number
  readonly verdict: string
  readonly tone: Tone
  readonly outcome: Outcome
  readonly hue: Area["hue"]
  readonly area: string
}

export interface MapRead {
  readonly areas: readonly {
    readonly id: string
    readonly name: string
    readonly hue: Area["hue"]
  }[]
  readonly runs: readonly MapRunRead[]
  readonly thread: readonly string[]
}

/** Every run that names an area, and the best-so-far thread. Empty areas, an empty map. */
export function mapRead(experiment: Experiment): MapRead {
  const areas = experiment.areas.map((area) => ({
    id: area.id,
    name: area.name,
    hue: area.hue,
  }))
  const known = new Set(areas.map((area) => area.id))
  const runs = experiment.runs.flatMap((run) => {
    if (run.areaId === undefined || !known.has(run.areaId)) return []
    const area = areaOf(experiment, run.areaId)
    if (area === undefined) return []
    const verdict = verdictRead(experiment, run)
    return [
      {
        runId: run.id,
        areaId: area.id,
        at: run.settledAt ?? run.startedAt,
        number: run.number,
        verdict: verdict.label,
        tone: verdict.tone,
        outcome: verdict.outcome,
        hue: area.hue,
        area: area.name,
      },
    ]
  })
  return { areas, runs, thread: experiment.bestSoFar }
}

export interface VerdictRead {
  readonly id: string
  readonly label: string
  readonly tone: Tone
}

/** The verdicts, in the order the definition lists them. */
export function verdicts(experiment: Experiment): readonly VerdictRead[] {
  return experiment.definition.verdicts.map((verdict) => ({
    id: verdict.id,
    label: verdict.label,
    tone: verdict.tone,
  }))
}

export interface SliceRead {
  readonly name: string
  /** Passing after the run, as a fraction of the slice. */
  readonly filled: number
  readonly text: string
}

export interface CaseResultsRead {
  readonly fixed: string
  readonly broken: string
  readonly barLabel: string
  readonly segments: readonly {
    readonly id: "fixed" | "broken" | "unchanged"
    readonly label: string
    readonly value: number
  }[]
  readonly slices: readonly SliceRead[]
  readonly moved: readonly {
    readonly id: string
    readonly title: string
    readonly slice: string
    readonly move: "fixed" | "broken"
  }[]
}

/** A run's cases, in the definition's case noun. Undefined when the run has none. */
export function caseResults(
  experiment: Experiment,
  run: Run,
): CaseResultsRead | undefined {
  const cases = run.cases
  if (cases === undefined) return undefined
  const noun = experiment.definition.caseNoun
  const unchanged = Math.max(0, cases.total - cases.fixed - cases.broken)
  const fixed = `${countLabel(cases.fixed, noun)} fixed`
  const broken = `${countLabel(cases.broken, noun)} broken`
  return {
    fixed,
    broken,
    barLabel: `${fixed}, ${broken}`,
    segments: [
      { id: "fixed", label: fixed, value: cases.fixed },
      { id: "broken", label: broken, value: cases.broken },
      { id: "unchanged", label: countLabel(unchanged, noun), value: unchanged },
    ],
    slices: cases.slices.map((slice) => ({
      name: slice.name,
      filled: slice.total === 0 ? 0 : slice.passingAfter / slice.total,
      text: `${formatCount(slice.passingBefore)} to ${formatCount(slice.passingAfter)} of ${formatCount(slice.total)}`,
    })),
    moved: cases.moved.map((item) => ({
      id: item.id,
      title: item.title,
      slice: item.slice,
      move: item.move,
    })),
  }
}

export interface ChangeFileRead {
  readonly key: string
  readonly path: string
  readonly status: "added" | "modified" | "deleted" | "renamed"
  readonly added: string
  readonly removed: string
}

export interface ChangeRead {
  readonly summary: string
  readonly added: string
  readonly removed: string
  readonly files: readonly ChangeFileRead[]
}

/** A run's change. Undefined when the run records none. */
export function changeRead(run: Run): ChangeRead | undefined {
  const change = run.change
  if (change === undefined) return undefined
  const totals = lineTotals(change)
  return {
    summary: change.summary,
    added: formatCount(totals.added),
    removed: formatCount(totals.removed),
    files: change.files.map((file, index) => ({
      key: `${index}:${file.path}`,
      path: file.path,
      status: file.status,
      added: formatCount(file.added),
      removed: formatCount(file.removed),
    })),
  }
}

/** A settled run with cases, else the first run that has them. */
export function runWithCases(experiment: Experiment): Run | undefined {
  return (
    experiment.runs.find(
      (run) => run.cases !== undefined && run.settledAt !== undefined,
    ) ?? experiment.runs.find((run) => run.cases !== undefined)
  )
}

/** A run whose change is short enough to read, else the first run that has one. */
export function runWithChange(experiment: Experiment): Run | undefined {
  const withChange = experiment.runs.filter((run) => run.change !== undefined)
  return withChange.find((run) => (run.change?.files.length ?? 0) <= 8) ?? withChange[0]
}
