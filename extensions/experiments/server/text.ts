/**
 * What each tool says in text: an answer that stands on its own, for a host
 * without MCP Apps and for the model. Every metric number is written by the
 * model's formatter (`model/metric.ts`), and every judgement — a verdict, the
 * best version — is the harness's, read through `model/selections.ts`; none
 * is worked out here.
 */
import {
  bestVersion,
  formatSize,
  formatValue,
  guardrailChange,
  limitOf,
  lineTotals,
  measureOf,
  metricChange,
  movedCount,
  runOf,
  runsNewestFirst,
  scoreOf,
  type Change,
  type Experiment,
  type Problem,
  type Run,
} from "../model/index.ts"
import type { FileOpening, FileRequest } from "./source.ts"

/** How many of a run's files its text names; the rest are counted. */
export const filesNamed = 20

/** How many runs a list of runs names; the rest are counted. */
export const runsNamed = 50

/** How many experiments' ids a text names; the rest are counted. */
export const idsNamed = 50

/** How many of an invalid experiment's problems its text names; the rest are counted. */
export const problemsNamed = 20

/** How many characters of a download its text shows; the rest are counted. */
export const downloadShown = 20_000

const count = (value: number) => value.toLocaleString("en-US")

/** `value` things: "1 file", "2 files". */
const counted = (value: number, one: string, other: string) =>
  `${count(value)} ${value === 1 ? one : other}`

const time = (at: number) => new Date(at).toISOString()

/** `items`, the first `limit` of them, then how many more there are. */
function capped(items: readonly string[], limit: number): string[] {
  return items.length <= limit
    ? [...items]
    : [...items.slice(0, limit), `…and ${count(items.length - limit)} more`]
}

/** A run as it is named: "run 3 (c3)". */
const runName = (run: Run) => `run ${run.number} (${run.id})`

/** What a version was built on: "the baseline" or a run. */
function parentName(experiment: Experiment, parentId: string): string {
  const parent = runOf(experiment, parentId)
  return parent === undefined ? "the baseline" : runName(parent)
}

function verdictLabel(experiment: Experiment, run: Run): string {
  // Validation holds that every run's verdict is defined (`verdict-defined`).
  return (
    experiment.definition.verdicts.find((verdict) => verdict.id === run.verdict)?.label ??
    run.verdict
  )
}

function outcomeOf(experiment: Experiment, run: Run) {
  return experiment.definition.verdicts.find((verdict) => verdict.id === run.verdict)
    ?.outcome
}

const toneWords = { good: "better", bad: "worse", neutral: "neutral" } as const

/** A change from the baseline as text: its sign, its size, and how it reads. */
function onBaseline(change: Change): string {
  const sign = change.value > 0 ? "+" : change.value < 0 ? "−" : "±"
  return `${sign}${change.size} on the baseline (${toneWords[change.tone]})`
}

/** The primary split's label. */
function primaryLabel(experiment: Experiment): string {
  const { splits, primarySplit } = experiment.definition
  return splits.find((split) => split.id === primarySplit)?.label ?? primarySplit
}

/** A run's score on the primary split, or that it has none yet. */
function primaryScore(experiment: Experiment, run: Run): string {
  const score = scoreOf(run, experiment.definition.primarySplit)
  return score === undefined
    ? `not scored on ${primaryLabel(experiment)} yet`
    : `${formatValue(experiment.definition.metric, score.mean)} on ${primaryLabel(experiment)}`
}

/** One line for a run, as a list of runs shows it. */
function runLine(experiment: Experiment, run: Run): string {
  return `- ${runName(run)}: ${verdictLabel(experiment, run)}, ${primaryScore(experiment, run)}. ${run.reason}`
}

/** What `show_experiment` and `get_experiment` say: the experiment, then its runs. */
export function experimentText(experiment: Experiment): string {
  const { definition } = experiment
  const { metric } = definition
  const primary = definition.primarySplit
  const lines = [
    `${experiment.title} (experiment ${experiment.id})`,
    `Goal: ${experiment.goal}`,
    `Metric: ${metric.name}, ${metric.better === "up" ? "higher" : "lower"} is better, on ${primaryLabel(experiment)}${
      definition.noise === undefined
        ? ""
        : `; a change within ${formatSize(metric, definition.noise)} is noise`
    }.`,
  ]
  const baseline = scoreOf(experiment.baseline, primary)
  lines.push(
    baseline === undefined
      ? "Baseline: being scored."
      : `Baseline: ${formatValue(metric, baseline.mean)}.`,
  )
  const best = bestVersion(experiment)
  if (best.kind === "baseline") {
    lines.push("Best: the baseline; no run has been kept yet.")
  } else {
    const score = scoreOf(best.run, primary)
    // Validation holds that a best run is scored on the primary split (`best-runs-scored`).
    const gain =
      baseline === undefined || score === undefined
        ? ""
        : `, ${onBaseline(metricChange(experiment, baseline.mean, score.mean))}`
    lines.push(
      `Best: ${runName(best.run)}, ${primaryScore(experiment, best.run)}${gain}.`,
    )
  }
  if (definition.reference !== undefined) {
    lines.push(
      `Reference: ${definition.reference.label}, ${formatValue(metric, definition.reference.value)}.`,
    )
  }
  for (const guardrail of definition.guardrails) {
    const limit = limitOf(experiment, guardrail.id)
    const bound =
      limit === undefined || limit.kind === "not-measured-yet"
        ? "relative to the baseline, which is not measured yet"
        : `${limit.bound === "at-most" ? "at most" : "at least"} ${limit.formatted}`
    lines.push(`Guardrail: ${guardrail.metric.name}, ${bound}.`)
  }
  const outcomes = { kept: 0, rejected: 0, pending: 0 }
  for (const run of experiment.runs) {
    const outcome = outcomeOf(experiment, run)
    if (outcome !== undefined) outcomes[outcome] += 1
  }
  lines.push(
    `Runs: ${count(experiment.runs.length)}${
      definition.budget === undefined
        ? ""
        : ` of a budget of ${count(definition.budget.runs)}`
    }; ${count(outcomes.kept)} kept, ${count(outcomes.rejected)} rejected, ${count(outcomes.pending)} pending.`,
  )
  if (experiment.areas.length > 0) {
    lines.push(`Areas: ${experiment.areas.map((area) => area.name).join(", ")}.`)
  }
  if (experiment.agents.length > 0) {
    lines.push(`Agents: ${count(experiment.agents.length)}.`)
  }
  if (experiment.runs.length > 0) {
    lines.push(
      "",
      "Runs, newest first:",
      ...runLines(experiment, runsNewestFirst(experiment)),
    )
  }
  return lines.join("\n")
}

/** One line for each of `runs`, in their order, capped at `runsNamed`. */
function runLines(experiment: Experiment, runs: readonly Run[]): string[] {
  return capped(
    runs.map((run) => runLine(experiment, run)),
    runsNamed,
  )
}

/** What `list_runs` says about `runs`, the experiment's runs newest first. */
export function runsText(experiment: Experiment, runs: readonly Run[]): string {
  return runs.length === 0
    ? `Experiment ${experiment.id} has no runs yet.`
    : [
        `The runs of ${experiment.title}, newest first:`,
        ...runLines(experiment, runs),
      ].join("\n")
}

/** What `get_run` says: the run in full, its files capped at `filesNamed`. */
export function runText(experiment: Experiment, run: Run): string {
  const { definition } = experiment
  const { metric } = definition
  const lines = [
    `Run ${run.number} (${run.id}) of ${experiment.title} (experiment ${experiment.id}): ${verdictLabel(experiment, run)}.`,
    `Reason: ${run.reason}`,
    `Built on ${parentName(experiment, run.parentId)}. Started ${time(run.startedAt)}${
      run.settledAt === undefined ? "" : `, settled ${time(run.settledAt)}`
    }.`,
  ]
  if (run.progress !== undefined) {
    lines.push(`Progress: ${count(run.progress.done)} of ${count(run.progress.total)}.`)
  }
  for (const split of definition.splits) {
    const score = scoreOf(run, split.id)
    if (score === undefined) continue
    const interval =
      score.interval === undefined ? "" : ` ± ${formatSize(metric, score.interval)}`
    const baseline = scoreOf(experiment.baseline, split.id)
    const change =
      baseline === undefined
        ? ""
        : `, ${onBaseline(metricChange(experiment, baseline.mean, score.mean))}`
    lines.push(`${split.label}: ${formatValue(metric, score.mean)}${interval}${change}.`)
  }
  for (const guardrail of definition.guardrails) {
    const measure = measureOf(run, guardrail.id)
    if (measure === undefined) continue
    const baseline = measureOf(experiment.baseline, guardrail.id)
    const change =
      baseline === undefined
        ? undefined
        : guardrailChange(experiment, guardrail.id, baseline, measure)
    lines.push(
      `${guardrail.metric.name}: ${formatValue(guardrail.metric, measure)}${
        change === undefined ? "" : `, ${onBaseline(change)}`
      }.`,
    )
  }
  if (run.cases !== undefined) {
    const noun = definition.caseNoun ?? { one: "case", other: "cases" }
    const { total, fixed, broken } = run.cases
    lines.push(
      `${noun.other[0]?.toUpperCase()}${noun.other.slice(1)}: ${count(total)}; ${count(movedCount(run.cases))} moved, ${count(fixed)} fixed and ${count(broken)} broken.`,
    )
  }
  if (run.change !== undefined) {
    const { added, removed } = lineTotals(run.change)
    lines.push(
      `Change: ${run.change.summary} ${counted(run.change.files.length, "file", "files")}, ${counted(added, "line", "lines")} added and ${count(removed)} removed:`,
      ...capped(
        run.change.files.map(
          (file) =>
            `- ${file.path} (${file.status}, +${count(file.added)} −${count(file.removed)})`,
        ),
        filesNamed,
      ),
    )
  }
  return lines.join("\n")
}

/** What a tool says when the source has no experiment `id`. */
export function missingText(id: string, ids: readonly string[]): string {
  return ids.length === 0
    ? `There is no experiment ${JSON.stringify(id)}: there are no experiments.`
    : `There is no experiment ${JSON.stringify(id)}. The experiments are: ${capped(ids, idsNamed).join(", ")}.`
}

/** What a tool says when the experiment `id` is not one the views can show. */
export function invalidText(id: string, problems: readonly Problem[]): string {
  return [
    `Experiment ${JSON.stringify(id)} can't be shown: it is not a valid experiment.`,
    ...capped(
      problems.map(
        (problem) =>
          `- ${problem.rule}${problem.path.length === 0 ? "" : ` at ${problem.path.join(".")}`}: ${problem.message}`,
      ),
      problemsNamed,
    ),
  ].join("\n")
}

/** What `open_file` says when the run records no change. */
export function noChangeText(experiment: Experiment, run: Run): string {
  return `Run ${run.id} of experiment ${experiment.id} records no change.`
}

/** What `open_file` says when the run did not change `path`. */
export function unchangedPathText(
  experiment: Experiment,
  run: Run,
  path: string,
): string {
  return `Run ${run.id} of experiment ${experiment.id} did not change ${JSON.stringify(path)}.`
}

/** What a tool says when the experiment has no run `runId`. */
export function missingRunText(experiment: Experiment, runId: string): string {
  return `Experiment ${experiment.id} has no run ${JSON.stringify(runId)}.`
}

/**
 * The first `downloadShown` code units of `text`, never ending inside a
 * character that takes two, then how many more there are.
 */
function shownPart(text: string): string {
  const high = text.charCodeAt(downloadShown - 1)
  const end = high >= 0xd800 && high <= 0xdbff ? downloadShown - 1 : downloadShown
  // Characters, not code units: a character that takes two is one.
  return `${text.slice(0, end)}\n…and ${count([...text.slice(end)].length)} more characters`
}

/** What `open_file` says about what it opened, or why it could not. */
export function openingText(request: FileRequest, opening: FileOpening): string {
  const what =
    request.path === undefined
      ? `the change of run ${request.runId}`
      : `${request.path} in run ${request.runId}`
  switch (opening.kind) {
    case "link":
      return `Open ${what} at ${opening.url}`
    case "download":
      return [
        `Ready to download ${what} as ${opening.name} (${opening.mimeType}):`,
        "",
        opening.text.length <= downloadShown ? opening.text : shownPart(opening.text),
      ].join("\n")
    case "unavailable":
      return `Can't open ${what}: ${opening.reason}`
  }
}
