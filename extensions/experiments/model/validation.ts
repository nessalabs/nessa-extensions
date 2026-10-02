/**
 * Validation: the one place an experiment's integrity is checked (nessa-agent
 * ADR 333, "Validation"), and the only maker of an `Experiment`.
 *
 * `validateExperiment` takes any value; whatever JSON can carry is answered,
 * valid or not (an input whose reading throws — a getter, a revoked proxy —
 * throws). zod parses it into a fresh copy, frozen
 * at every level, and from then on only the copy is read: the rules below are
 * checked on it, and it is what is branded and returned. The input is read
 * only by the parser (which may read a union's tag twice: once to choose,
 * once to copy), never after it, so nothing changed in it afterwards — by a
 * getter, or by whoever holds it — can reach what was checked
 * (`validation.test.ts`, "what validateExperiment returns").
 *
 * The parser holds each field on its own (an id's alphabet, a count's whole
 * number, `decimals` 0–10, the moved page's 200); a failure there is a
 * `shape` problem at its path, and the rules are not checked, since they read
 * the shape. The rules hold what spans fields — the definition is coherent,
 * ids are unique, every reference resolves, times and counts agree, and
 * `bestSoFar` names exactly the kept runs in the order they became best —
 * each with a `Rule` of its own. Every problem is reported, not the first.
 *
 * `validation.test.ts` tests each rule both ways.
 */
import {
  experimentData,
  movedCount,
  scoreOf,
  type Experiment,
  type ExperimentData,
} from "./experiment.ts"
import { sliceCoherent } from "./slice.ts"

/** The rules, each named for what it holds. */
export const rules = [
  /** The input is not an experiment's shape; see `experiment.ts`. */
  "shape",
  // The definition.
  "split-ids-unique",
  "guardrail-ids-unique",
  "verdict-ids-unique",
  "primary-split-defined",
  // Identity.
  "run-ids-unique",
  "run-numbers-unique",
  "area-ids-unique",
  "agent-ids-unique",
  // References.
  "verdict-defined",
  "split-defined",
  "guardrail-defined",
  "parent-earlier",
  "area-defined",
  "agent-defined",
  "activity-run-defined",
  "note-run-defined",
  // Agreement between an agent and the run it works on.
  "activity-run-pending",
  // Settling and progress.
  "settled-when-decided",
  "started-after-experiment",
  "settled-after-started",
  "progress-while-pending",
  "progress-within-total",
  // Cases and changes.
  "slice-passing-within-total",
  "slice-within-cases",
  "slice-coherent",
  "slice-names-unique",
  "moved-within-total",
  "moved-page-within-counts",
  "moved-ids-unique",
  "moved-slice-defined",
  "file-paths-unique",
  // The best.
  "best-runs-unique",
  "best-runs-kept",
  "best-runs-scored",
  "best-settled-in-order",
  "kept-runs-best",
] as const

export type Rule = (typeof rules)[number]

/** Where in the input a problem is: keys and indexes from its root. */
export type Path = readonly (string | number)[]

/** One rule an input broke, and where. */
export interface Problem {
  readonly rule: Rule
  readonly path: Path
  readonly message: string
}

/** What `validateExperiment` answers. */
export type Validation =
  | { readonly kind: "valid"; readonly experiment: Experiment }
  | { readonly kind: "invalid"; readonly problems: readonly Problem[] }

/** Checks `input` and answers the `Experiment` it is, or every problem with it. */
export function validateExperiment(input: unknown): Validation {
  const parsed = experimentData.safeParse(input)
  if (!parsed.success) {
    return {
      kind: "invalid",
      problems: parsed.error.issues.map((issue) => ({
        rule: "shape",
        path: issue.path.map((key) => (typeof key === "symbol" ? String(key) : key)),
        message: issue.message,
      })),
    }
  }
  const copy = parsed.data
  const problems = problemsOf(copy)
  if (problems.length > 0) return { kind: "invalid", problems }
  // The one cast that makes an Experiment: of the parser's frozen copy, once
  // every rule holds of it.
  return { kind: "valid", experiment: copy as Experiment }
}

/** Every rule `experiment` breaks. */
function problemsOf(experiment: ExperimentData): Problem[] {
  const problems: Problem[] = []
  const report = (rule: Rule, path: Path, message: string) =>
    problems.push({ rule, path, message })
  const { definition, baseline, runs, areas, agents, notes, bestSoFar } = experiment

  // The definition.
  const splitIds = uniqueIds(
    definition.splits.map((split) => split.id),
    (index, duplicate) =>
      report(
        "split-ids-unique",
        ["definition", "splits", index, "id"],
        `split ${duplicate} is defined twice`,
      ),
  )
  const guardrailIds = uniqueIds(
    definition.guardrails.map((guardrail) => guardrail.id),
    (index, duplicate) =>
      report(
        "guardrail-ids-unique",
        ["definition", "guardrails", index, "id"],
        `guardrail ${duplicate} is defined twice`,
      ),
  )
  // A verdict defined twice is reported below; references name the first.
  const verdicts = firstById(definition.verdicts)
  uniqueIds(
    definition.verdicts.map((verdict) => verdict.id),
    (index, duplicate) =>
      report(
        "verdict-ids-unique",
        ["definition", "verdicts", index, "id"],
        `verdict ${duplicate} is defined twice`,
      ),
  )
  if (!splitIds.has(definition.primarySplit)) {
    report(
      "primary-split-defined",
      ["definition", "primarySplit"],
      `the primary split ${definition.primarySplit} is not one of the splits`,
    )
  }

  // Scores and measures name defined splits and guardrails, the baseline's too.
  const checkTables = (
    owner: { readonly scores: object; readonly measures: object },
    at: Path,
  ) => {
    for (const split of Object.keys(owner.scores)) {
      if (!splitIds.has(split)) {
        report("split-defined", [...at, "scores", split], `split ${split} is not defined`)
      }
    }
    for (const guardrail of Object.keys(owner.measures)) {
      if (!guardrailIds.has(guardrail)) {
        report(
          "guardrail-defined",
          [...at, "measures", guardrail],
          `guardrail ${guardrail} is not defined`,
        )
      }
    }
  }
  checkTables(baseline, ["baseline"])

  // Identity.
  uniqueIds([baseline.id, ...runs.map((run) => run.id)], (index, duplicate) =>
    report(
      "run-ids-unique",
      index === 0 ? ["baseline", "id"] : ["runs", index - 1, "id"],
      `${duplicate} names more than one run or the baseline`,
    ),
  )
  uniqueIds(
    runs.map((run) => String(run.number)),
    (index, duplicate) =>
      report(
        "run-numbers-unique",
        ["runs", index, "number"],
        `run number ${duplicate} is used twice`,
      ),
  )
  const areaIds = uniqueIds(
    areas.map((area) => area.id),
    (index, duplicate) =>
      report(
        "area-ids-unique",
        ["areas", index, "id"],
        `area ${duplicate} is defined twice`,
      ),
  )
  const agentIds = uniqueIds(
    agents.map((agent) => agent.id),
    (index, duplicate) =>
      report(
        "agent-ids-unique",
        ["agents", index, "id"],
        `agent ${duplicate} is defined twice`,
      ),
  )

  // Runs: references, settling, progress, cases and changes. A run id used
  // twice is reported above; references name the first run with it.
  const runsById = firstById(runs)

  runs.forEach((run, index) => {
    const at: Path = ["runs", index]
    checkTables(run, at)
    const verdict = verdicts.get(run.verdict)
    if (verdict === undefined) {
      report(
        "verdict-defined",
        [...at, "verdict"],
        `verdict ${run.verdict} is not defined`,
      )
    }
    if (run.parentId !== baseline.id) {
      const parent = runsById.get(run.parentId)
      if (parent === undefined || parent.number >= run.number) {
        report(
          "parent-earlier",
          [...at, "parentId"],
          `the parent ${run.parentId} is neither the baseline nor a lower-numbered run`,
        )
      }
    }
    if (run.areaId !== undefined && !areaIds.has(run.areaId)) {
      report("area-defined", [...at, "areaId"], `area ${run.areaId} is not defined`)
    }
    if (run.agentId !== undefined && !agentIds.has(run.agentId)) {
      report("agent-defined", [...at, "agentId"], `agent ${run.agentId} is not defined`)
    }
    if (verdict !== undefined) {
      const pending = verdict.outcome === "pending"
      if (pending === (run.settledAt !== undefined)) {
        report(
          "settled-when-decided",
          [...at, "settledAt"],
          pending
            ? "a run whose verdict is pending has no settledAt"
            : "a run whose verdict is decided has a settledAt",
        )
      }
      if (!pending && run.progress !== undefined) {
        report(
          "progress-while-pending",
          [...at, "progress"],
          "only a run whose verdict is pending has progress",
        )
      }
    }
    if (run.startedAt < experiment.startedAt) {
      report(
        "started-after-experiment",
        [...at, "startedAt"],
        "a run starts at or after its experiment",
      )
    }
    if (run.settledAt !== undefined && run.settledAt < run.startedAt) {
      report(
        "settled-after-started",
        [...at, "settledAt"],
        "a run settles at or after it starts",
      )
    }
    if (run.progress !== undefined && run.progress.done > run.progress.total) {
      report(
        "progress-within-total",
        [...at, "progress", "done"],
        "a run's progress is done at most its total",
      )
    }
    if (run.cases !== undefined) checkCases(run.cases, [...at, "cases"], report)
    if (run.change !== undefined) {
      uniqueIds(
        run.change.files.map((file) => file.path),
        (fileIndex, duplicate) =>
          report(
            "file-paths-unique",
            [...at, "change", "files", fileIndex, "path"],
            `${duplicate} is listed twice`,
          ),
      )
    }
  })

  // Agents and notes.
  agents.forEach((agent, index) => {
    if (agent.areaId !== undefined && !areaIds.has(agent.areaId)) {
      report(
        "area-defined",
        ["agents", index, "areaId"],
        `area ${agent.areaId} is not defined`,
      )
    }
    if (agent.activity.kind !== "evaluating") return
    const evaluated = runsById.get(agent.activity.runId)
    if (evaluated === undefined) {
      report(
        "activity-run-defined",
        ["agents", index, "activity", "runId"],
        `run ${agent.activity.runId} is not one of the runs`,
      )
    } else if (verdicts.get(evaluated.verdict)?.outcome !== "pending") {
      // A run whose verdict is not defined is reported as such, not here.
      if (verdicts.has(evaluated.verdict)) {
        report(
          "activity-run-pending",
          ["agents", index, "activity", "runId"],
          `run ${agent.activity.runId} is decided, so no agent is evaluating it`,
        )
      }
    }
  })
  notes.forEach((note, index) => {
    if (note.runId !== undefined && !runsById.has(note.runId)) {
      report(
        "note-run-defined",
        ["notes", index, "runId"],
        `run ${note.runId} is not one of the runs`,
      )
    }
  })

  // The best: exactly the kept runs, each scored on the primary split, in the
  // order they became best.
  const named = new Set<string>()
  let previous: number | undefined
  bestSoFar.forEach((runId, index) => {
    const at: Path = ["bestSoFar", index]
    if (named.has(runId)) {
      report("best-runs-unique", at, `${runId} is named twice`)
      return
    }
    named.add(runId)
    const run = runsById.get(runId)
    if (run === undefined || verdicts.get(run.verdict)?.outcome !== "kept") {
      report("best-runs-kept", at, `${runId} is not a kept run`)
      return
    }
    if (scoreOf(run, definition.primarySplit) === undefined) {
      report("best-runs-scored", at, `${runId} has no score on the primary split`)
    }
    // A kept run's outcome is decided, so its settledAt is present; when it is
    // not, settled-when-decided has said so.
    if (run.settledAt === undefined) return
    if (previous !== undefined && run.settledAt < previous) {
      report("best-settled-in-order", at, `${runId} settled before the run it follows`)
    }
    previous = run.settledAt
  })
  runs.forEach((run, index) => {
    if (verdicts.get(run.verdict)?.outcome === "kept" && !named.has(run.id)) {
      report(
        "kept-runs-best",
        ["runs", index, "verdict"],
        `kept run ${run.id} is not in bestSoFar`,
      )
    }
  })

  return problems
}

/** A run's cases: slices, the moved page, and the counts they agree with. */
function checkCases(
  cases: NonNullable<ExperimentData["runs"][number]["cases"]>,
  at: Path,
  report: (rule: Rule, path: Path, message: string) => void,
) {
  // How many of the page's cases each slice lists, fixed and broken.
  const listed = new Map<string, { fixed: number; broken: number }>()
  for (const moved of cases.moved) {
    const counts = listed.get(moved.slice) ?? { fixed: 0, broken: 0 }
    counts[moved.move] += 1
    listed.set(moved.slice, counts)
  }
  // A slice's coherence is checked only once what it is read with holds: the
  // run's moved within its total, the page within the run's counts, the
  // slice's name its own, and its counts within the run's and its own. So a
  // fact is reported once, as itself (`validation.test.ts`).
  const movedWithin = movedCount(cases) <= cases.total
  const movedFixed = cases.moved.filter((moved) => moved.move === "fixed").length
  const pageWithin =
    movedFixed <= cases.fixed && cases.moved.length - movedFixed <= cases.broken
  const named = new Map<string, number>()
  for (const slice of cases.slices)
    named.set(slice.name, (named.get(slice.name) ?? 0) + 1)
  cases.slices.forEach((slice, index) => {
    // A slice is a group of the run's cases: no larger than they are.
    let within = movedWithin && pageWithin && named.get(slice.name) === 1
    if (slice.total > cases.total) {
      within = false
      report(
        "slice-within-cases",
        [...at, "slices", index, "total"],
        `slice ${slice.name} has more cases than the run`,
      )
    }
    for (const key of ["passingBefore", "passingAfter"] as const) {
      if (slice[key] > slice.total) {
        within = false
        report(
          "slice-passing-within-total",
          [...at, "slices", index, key],
          `slice ${slice.name} has more passing than it has cases`,
        )
      }
    }
    if (within && !sliceCoherent(slice, cases, listed.get(slice.name))) {
      report(
        "slice-coherent",
        [...at, "slices", index],
        `no number of cases fixed and broken in slice ${slice.name} agrees with its counts, the run's, and the cases it lists`,
      )
    }
  })
  const sliceNames = uniqueIds(
    cases.slices.map((slice) => slice.name),
    (index, duplicate) =>
      report(
        "slice-names-unique",
        [...at, "slices", index, "name"],
        `slice ${duplicate} is listed twice`,
      ),
  )
  if (!movedWithin) {
    report("moved-within-total", at, "more cases moved than the run has")
  }
  if (movedFixed > cases.fixed) {
    report(
      "moved-page-within-counts",
      [...at, "moved"],
      "the page lists more fixed cases than were fixed",
    )
  }
  if (cases.moved.length - movedFixed > cases.broken) {
    report(
      "moved-page-within-counts",
      [...at, "moved"],
      "the page lists more broken cases than were broken",
    )
  }
  uniqueIds(
    cases.moved.map((moved) => moved.id),
    (index, duplicate) =>
      report(
        "moved-ids-unique",
        [...at, "moved", index, "id"],
        `case ${duplicate} is listed twice`,
      ),
  )
  cases.moved.forEach((moved, index) => {
    if (!sliceNames.has(moved.slice)) {
      report(
        "moved-slice-defined",
        [...at, "moved", index, "slice"],
        `slice ${moved.slice} is not one of the run's slices`,
      )
    }
  })
}

/** `items` by id, the first with each id. */
function firstById<Item extends { readonly id: string }>(
  items: readonly Item[],
): ReadonlyMap<string, Item> {
  const byId = new Map<string, Item>()
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item)
  return byId
}

/** The distinct `ids`, calling `duplicate` with the index of each repeat. */
function uniqueIds(
  ids: readonly string[],
  duplicate: (index: number, id: string) => void,
): ReadonlySet<string> {
  const seen = new Set<string>()
  ids.forEach((each, index) => {
    if (seen.has(each)) duplicate(index, each)
    else seen.add(each)
  })
  return seen
}
