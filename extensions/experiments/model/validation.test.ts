import { describe, expect, it } from "vitest"

import { scoreOf, type Experiment, type ExperimentData } from "./experiment.ts"
import { fixture, start, type Fixture } from "./fixture.ts"
import { rules, validateExperiment, type Path, type Rule } from "./validation.ts"

/** The rule and path of each problem `input` has; empty when it is valid. */
function problems(input: unknown): { rule: Rule; path: Path }[] {
  const validation = validateExperiment(input)
  return validation.kind === "valid"
    ? []
    : validation.problems.map(({ rule, path }) => ({ rule, path }))
}

/** The fixture with `edit` applied. */
function edited(edit: (experiment: Fixture) => void): Fixture {
  const experiment = fixture()
  edit(experiment)
  return experiment
}

/** A run of the fixture, by index; the fixture has three. */
const run = (experiment: Fixture, index: 0 | 1 | 2) => experiment.runs[index]!
const cases = (experiment: Fixture) => run(experiment, 0).cases!
const change = (experiment: Fixture) => run(experiment, 0).change!

interface Case {
  /** What the edit does. */
  readonly name: string
  readonly edit: (experiment: Fixture) => void
}

interface Breaks extends Case {
  /** Exactly the problems it causes. */
  readonly problems: readonly { rule: Rule; path: Path }[]
}

/**
 * Each rule, both ways: edits that break it, each with exactly the problems
 * that follow, and edits at its edge that hold it.
 */
const table: Record<Rule, { breaks: readonly Breaks[]; holds: readonly Case[] }> = {
  shape: {
    breaks: [
      {
        name: "decimals above 10",
        edit: (e) => (e.definition.metric.decimals = 11),
        problems: [{ rule: "shape", path: ["definition", "metric", "decimals"] }],
      },
      {
        name: "decimals not whole",
        edit: (e) => (e.definition.metric.decimals = 1.5),
        problems: [{ rule: "shape", path: ["definition", "metric", "decimals"] }],
      },
      {
        name: "decimals below 0",
        edit: (e) => (e.definition.guardrails[0]!.metric.decimals = -1),
        problems: [
          { rule: "shape", path: ["definition", "guardrails", 0, "metric", "decimals"] },
        ],
      },
      {
        name: "a budget of 0 runs",
        edit: (e) => (e.definition.budget = { runs: 0 }),
        problems: [{ rule: "shape", path: ["definition", "budget", "runs"] }],
      },
      {
        name: "a budget of part of a run",
        edit: (e) => (e.definition.budget = { runs: 1.5 }),
        problems: [{ rule: "shape", path: ["definition", "budget", "runs"] }],
      },
      {
        name: "negative noise",
        edit: (e) => (e.definition.noise = -0.1),
        problems: [{ rule: "shape", path: ["definition", "noise"] }],
      },
      {
        name: "a negative interval",
        edit: (e) => (run(e, 0).scores = { b: { mean: 54, interval: -1 } }),
        problems: [{ rule: "shape", path: ["runs", 0, "scores", "b", "interval"] }],
      },
      {
        name: "a run number of 0",
        edit: (e) => (run(e, 0).number = 0),
        problems: [{ rule: "shape", path: ["runs", 0, "number"] }],
      },
      {
        name: "a negative count",
        edit: (e) => (cases(e).broken = -1),
        problems: [{ rule: "shape", path: ["runs", 0, "cases", "broken"] }],
      },
      {
        name: "a count not whole",
        edit: (e) => (cases(e).slices[0]!.total = 60.5),
        problems: [{ rule: "shape", path: ["runs", 0, "cases", "slices", 0, "total"] }],
      },
      {
        name: "a file's lines not whole",
        edit: (e) => (change(e).files[0]!.added = 2.5),
        problems: [{ rule: "shape", path: ["runs", 0, "change", "files", 0, "added"] }],
      },
      {
        name: "progress not whole",
        edit: (e) => (run(e, 2).progress = { done: 1.5, total: 10 }),
        problems: [{ rule: "shape", path: ["runs", 2, "progress", "done"] }],
      },
      {
        name: "a moved page of 201",
        edit: (e) => {
          cases(e).total = 1000
          cases(e).fixed = 201
          cases(e).moved = Array.from({ length: 201 }, (_, index) => ({
            id: `m${index}`,
            title: "Moved",
            slice: "s1",
            move: "fixed" as const,
          }))
        },
        problems: [{ rule: "shape", path: ["runs", 0, "cases", "moved"] }],
      },
      {
        name: "a key the shape does not have",
        edit: (e) => Object.assign(run(e, 0), { settledat: start + 20 }),
        problems: [{ rule: "shape", path: ["runs", 0] }],
      },
      {
        name: "an id outside the alphabet",
        edit: (e) => (e.areas[0]!.id = "a/b"),
        problems: [{ rule: "shape", path: ["areas", 0, "id"] }],
      },
      {
        name: "a split id a table cannot own",
        edit: (e) => {
          e.definition.splits[0]!.id = "__proto__"
          run(e, 0).scores = JSON.parse('{"__proto__": {"mean": 1}, "b": {"mean": 54}}')
        },
        problems: [
          { rule: "shape", path: ["definition", "splits", 0, "id"] },
          { rule: "shape", path: ["runs", 0, "scores", "__proto__"] },
        ],
      },
      {
        name: "a measure keyed __proto__",
        edit: (e) => (e.baseline.measures = JSON.parse('{"__proto__": 5, "g": 10}')),
        problems: [{ rule: "shape", path: ["baseline", "measures", "__proto__"] }],
      },
      {
        name: "a score beyond the bound",
        edit: (e) => (run(e, 0).scores = { b: { mean: 1e15 + 2 } }),
        problems: [{ rule: "shape", path: ["runs", 0, "scores", "b", "mean"] }],
      },
      {
        name: "a measure beyond the bound, below 0",
        edit: (e) => (e.baseline.measures = { g: -1e15 - 2 }),
        problems: [{ rule: "shape", path: ["baseline", "measures", "g"] }],
      },
      {
        name: "a score that is not a number",
        edit: (e) => (run(e, 0).scores = { b: { mean: Number.NaN } }),
        problems: [{ rule: "shape", path: ["runs", 0, "scores", "b", "mean"] }],
      },
      {
        name: "a glyph that is not path data",
        edit: (e) => (e.areas[0]!.glyph = 'M0 0"/><script>'),
        problems: [{ rule: "shape", path: ["areas", 0, "glyph"] }],
      },
      {
        name: "a glyph whose last command has no numbers",
        edit: (e) => (e.areas[0]!.glyph = "M0 0 L"),
        problems: [{ rule: "shape", path: ["areas", 0, "glyph"] }],
      },
      {
        name: "blank text",
        edit: (e) => (run(e, 0).reason = "  "),
        problems: [{ rule: "shape", path: ["runs", 0, "reason"] }],
      },
    ],
    holds: [
      { name: "decimals 0", edit: (e) => (e.definition.metric.decimals = 0) },
      {
        name: "values at the bound, either side",
        edit: (e) => {
          run(e, 1).scores = { b: { mean: 1e15 } }
          run(e, 1).measures = { g: -1e15 }
        },
      },
      { name: "decimals 10", edit: (e) => (e.definition.metric.decimals = 10) },
      { name: "a budget of 1 run", edit: (e) => (e.definition.budget = { runs: 1 }) },
      { name: "noise 0", edit: (e) => (e.definition.noise = 0) },
      {
        name: "no noise, reference, budget or noun",
        edit: (e) => {
          delete e.definition.noise
          delete e.definition.reference
          delete e.definition.budget
          delete e.definition.caseNoun
        },
      },
      {
        name: "an interval of 0",
        edit: (e) => (run(e, 0).scores = { b: { mean: 54, interval: 0 } }),
      },
      {
        name: "counts of 0",
        edit: (e) => {
          cases(e).slices[1] = { name: "s2", total: 0, passingBefore: 0, passingAfter: 0 }
          cases(e).moved = [cases(e).moved[0]!]
        },
      },
      {
        name: "a moved page of 200",
        edit: (e) => {
          cases(e).total = 1000
          cases(e).fixed = 200
          cases(e).slices[0] = {
            name: "s1",
            total: 600,
            passingBefore: 300,
            passingAfter: 500,
          }
          cases(e).moved = Array.from({ length: 200 }, (_, index) => ({
            id: `m${index}`,
            title: "Moved",
            slice: "s1",
            move: "fixed" as const,
          }))
        },
      },
      {
        name: "a split id that names an inherited member",
        edit: (e) => {
          e.definition.splits[0]!.id = "constructor"
          e.baseline.scores = { constructor: { mean: 50 }, b: { mean: 50 } }
          run(e, 0).scores = { constructor: { mean: 1 }, b: { mean: 54 } }
        },
      },
      {
        name: "no areas, agents or notes",
        edit: (e) => {
          e.areas = []
          e.agents = []
          e.notes = []
          delete run(e, 0).areaId
          delete run(e, 0).agentId
          delete run(e, 2).agentId
        },
      },
    ],
  },

  "split-ids-unique": {
    breaks: [
      {
        name: "a split defined twice",
        edit: (e) => e.definition.splits.push({ id: "a", label: "A again" }),
        problems: [{ rule: "split-ids-unique", path: ["definition", "splits", 2, "id"] }],
      },
    ],
    holds: [
      {
        name: "a split and a guardrail sharing an id",
        edit: (e) => e.definition.splits.push({ id: "g", label: "G" }),
      },
    ],
  },
  "guardrail-ids-unique": {
    breaks: [
      {
        name: "a guardrail defined twice",
        edit: (e) => e.definition.guardrails.push({ ...e.definition.guardrails[0]! }),
        problems: [
          { rule: "guardrail-ids-unique", path: ["definition", "guardrails", 1, "id"] },
        ],
      },
    ],
    holds: [
      {
        name: "a second guardrail",
        edit: (e) =>
          e.definition.guardrails.push({ ...e.definition.guardrails[0]!, id: "h" }),
      },
    ],
  },
  "verdict-ids-unique": {
    breaks: [
      {
        name: "a verdict defined twice",
        edit: (e) =>
          // Defined again as kept: r2's verdict is still the first, rejected.
          e.definition.verdicts.push({
            id: "drop",
            label: "Again",
            tone: "good",
            outcome: "kept",
          }),
        problems: [
          { rule: "verdict-ids-unique", path: ["definition", "verdicts", 3, "id"] },
        ],
      },
    ],
    holds: [
      {
        name: "a verdict no run has",
        edit: (e) =>
          e.definition.verdicts.push({
            id: "other",
            label: "Other",
            tone: "neutral",
            outcome: "rejected",
          }),
      },
    ],
  },
  "primary-split-defined": {
    breaks: [
      {
        name: "a primary split that is not a split",
        edit: (e) => (e.definition.primarySplit = "c"),
        problems: [
          { rule: "primary-split-defined", path: ["definition", "primarySplit"] },
          // r1, the best, has no score on a split that does not exist.
          { rule: "best-runs-scored", path: ["bestSoFar", 0] },
        ],
      },
    ],
    holds: [{ name: "the other split", edit: (e) => (e.definition.primarySplit = "a") }],
  },

  "run-ids-unique": {
    breaks: [
      {
        name: "a run with the baseline's id",
        edit: (e) => (run(e, 1).id = "base"),
        problems: [{ rule: "run-ids-unique", path: ["runs", 1, "id"] }],
      },
      {
        name: "two runs with one id",
        edit: (e) => (run(e, 1).id = "r1"),
        problems: [{ rule: "run-ids-unique", path: ["runs", 1, "id"] }],
      },
    ],
    holds: [{ name: "a run with an area's id", edit: (e) => (run(e, 1).id = "x") }],
  },
  "run-numbers-unique": {
    breaks: [
      {
        name: "two runs with one number",
        edit: (e) => (run(e, 2).number = 2),
        problems: [{ rule: "run-numbers-unique", path: ["runs", 2, "number"] }],
      },
    ],
    holds: [{ name: "numbers with a gap", edit: (e) => (run(e, 2).number = 7) }],
  },
  "area-ids-unique": {
    breaks: [
      {
        name: "an area defined twice",
        edit: (e) => e.areas.push({ ...e.areas[0]!, name: "Again" }),
        problems: [{ rule: "area-ids-unique", path: ["areas", 1, "id"] }],
      },
    ],
    holds: [
      { name: "a second area", edit: (e) => e.areas.push({ ...e.areas[0]!, id: "y" }) },
    ],
  },
  "agent-ids-unique": {
    breaks: [
      {
        name: "an agent defined twice",
        edit: (e) => e.agents.push({ ...e.agents[0]! }),
        problems: [{ rule: "agent-ids-unique", path: ["agents", 1, "id"] }],
      },
    ],
    holds: [
      {
        name: "a second agent",
        edit: (e) => e.agents.push({ ...e.agents[0]!, id: "ag2" }),
      },
    ],
  },

  "verdict-defined": {
    breaks: [
      {
        name: "a verdict not in the vocabulary",
        edit: (e) => (run(e, 1).verdict = "lost"),
        problems: [{ rule: "verdict-defined", path: ["runs", 1, "verdict"] }],
      },
      {
        name: "a verdict not in the vocabulary, on the run an agent evaluates",
        // Reported once, as this; not also as a run no agent should be evaluating.
        edit: (e) => (run(e, 2).verdict = "lost"),
        problems: [{ rule: "verdict-defined", path: ["runs", 2, "verdict"] }],
      },
    ],
    holds: [
      {
        name: "another verdict in the vocabulary",
        edit: (e) => {
          e.definition.verdicts.push({
            id: "other",
            label: "Other",
            tone: "neutral",
            outcome: "rejected",
          })
          run(e, 1).verdict = "other"
        },
      },
    ],
  },
  "split-defined": {
    breaks: [
      {
        name: "a run's score on no split",
        edit: (e) => (run(e, 1).scores = { b: { mean: 53 }, c: { mean: 1 } }),
        problems: [{ rule: "split-defined", path: ["runs", 1, "scores", "c"] }],
      },
      {
        name: "the baseline's score on no split",
        edit: (e) => (e.baseline.scores = { b: { mean: 50 }, c: { mean: 1 } }),
        problems: [{ rule: "split-defined", path: ["baseline", "scores", "c"] }],
      },
    ],
    holds: [
      {
        name: "scores on some of the splits",
        edit: (e) => (e.baseline.scores = { a: { mean: 1 } }),
      },
    ],
  },
  "guardrail-defined": {
    breaks: [
      {
        name: "a run's measure for no guardrail",
        edit: (e) => (run(e, 0).measures = { g: 11, h: 2 }),
        problems: [{ rule: "guardrail-defined", path: ["runs", 0, "measures", "h"] }],
      },
      {
        name: "the baseline's measure for no guardrail",
        edit: (e) => (e.baseline.measures = { h: 2 }),
        problems: [{ rule: "guardrail-defined", path: ["baseline", "measures", "h"] }],
      },
    ],
    holds: [
      { name: "a baseline not measured yet", edit: (e) => (e.baseline.measures = {}) },
    ],
  },
  "parent-earlier": {
    breaks: [
      {
        name: "a parent with a higher number",
        edit: (e) => (run(e, 1).parentId = "r3"),
        problems: [{ rule: "parent-earlier", path: ["runs", 1, "parentId"] }],
      },
      {
        name: "a run its own parent",
        edit: (e) => (run(e, 1).parentId = "r2"),
        problems: [{ rule: "parent-earlier", path: ["runs", 1, "parentId"] }],
      },
      {
        name: "a parent that is not a run",
        edit: (e) => (run(e, 1).parentId = "gone"),
        problems: [{ rule: "parent-earlier", path: ["runs", 1, "parentId"] }],
      },
      {
        name: "a loop through two runs",
        edit: (e) => {
          run(e, 0).parentId = "r2"
          run(e, 1).parentId = "r1"
        },
        problems: [{ rule: "parent-earlier", path: ["runs", 0, "parentId"] }],
      },
    ],
    holds: [
      { name: "the baseline", edit: (e) => (run(e, 2).parentId = "base") },
      { name: "a lower-numbered run", edit: (e) => (run(e, 2).parentId = "r2") },
      {
        name: "a lower number listed later",
        edit: (e) => {
          e.runs.reverse()
        },
      },
    ],
  },
  "area-defined": {
    breaks: [
      {
        name: "a run's area not defined",
        edit: (e) => (run(e, 0).areaId = "y"),
        problems: [{ rule: "area-defined", path: ["runs", 0, "areaId"] }],
      },
      {
        name: "an agent's area not defined",
        edit: (e) => (e.agents[0]!.areaId = "y"),
        problems: [{ rule: "area-defined", path: ["agents", 0, "areaId"] }],
      },
    ],
    holds: [
      {
        name: "no area on a run or an agent",
        edit: (e) => {
          delete run(e, 0).areaId
          delete e.agents[0]!.areaId
        },
      },
    ],
  },
  "agent-defined": {
    breaks: [
      {
        name: "a run's agent not defined",
        edit: (e) => (run(e, 0).agentId = "nobody"),
        problems: [{ rule: "agent-defined", path: ["runs", 0, "agentId"] }],
      },
    ],
    holds: [{ name: "no agent on a run", edit: (e) => delete run(e, 0).agentId }],
  },
  "activity-run-defined": {
    breaks: [
      {
        name: "evaluating a run that is not one",
        edit: (e) => (e.agents[0]!.activity = { kind: "evaluating", runId: "r9" }),
        problems: [
          { rule: "activity-run-defined", path: ["agents", 0, "activity", "runId"] },
        ],
      },
      {
        name: "evaluating the baseline",
        edit: (e) => (e.agents[0]!.activity = { kind: "evaluating", runId: "base" }),
        problems: [
          { rule: "activity-run-defined", path: ["agents", 0, "activity", "runId"] },
        ],
      },
    ],
    holds: [
      {
        name: "drafting, with a note",
        edit: (e) => (e.agents[0]!.activity = { kind: "drafting", note: "Thinking." }),
      },
    ],
  },
  "activity-run-pending": {
    breaks: [
      {
        name: "evaluating a run that was kept",
        edit: (e) => (e.agents[0]!.activity = { kind: "evaluating", runId: "r1" }),
        problems: [
          { rule: "activity-run-pending", path: ["agents", 0, "activity", "runId"] },
        ],
      },
      {
        name: "evaluating a run that was rejected",
        edit: (e) => (e.agents[0]!.activity = { kind: "evaluating", runId: "r2" }),
        problems: [
          { rule: "activity-run-pending", path: ["agents", 0, "activity", "runId"] },
        ],
      },
    ],
    holds: [{ name: "evaluating a pending run", edit: () => {} }],
  },
  "note-run-defined": {
    breaks: [
      {
        name: "a note about a run that is not one",
        edit: (e) => (e.notes[0]!.runId = "r9"),
        problems: [{ rule: "note-run-defined", path: ["notes", 0, "runId"] }],
      },
    ],
    holds: [{ name: "a note about no run", edit: (e) => delete e.notes[0]!.runId }],
  },

  "settled-when-decided": {
    breaks: [
      {
        name: "a pending run with a settledAt",
        edit: (e) => {
          delete run(e, 2).progress
          run(e, 2).settledAt = start + 60
        },
        problems: [{ rule: "settled-when-decided", path: ["runs", 2, "settledAt"] }],
      },
      {
        name: "a rejected run with no settledAt",
        edit: (e) => delete run(e, 1).settledAt,
        problems: [{ rule: "settled-when-decided", path: ["runs", 1, "settledAt"] }],
      },
      {
        name: "a kept run with no settledAt",
        edit: (e) => delete run(e, 0).settledAt,
        problems: [{ rule: "settled-when-decided", path: ["runs", 0, "settledAt"] }],
      },
    ],
    holds: [
      {
        name: "a pending run with no progress",
        edit: (e) => delete run(e, 2).progress,
      },
    ],
  },
  "started-after-experiment": {
    breaks: [
      {
        name: "a run started before its experiment",
        edit: (e) => (run(e, 2).startedAt = start - 1),
        problems: [{ rule: "started-after-experiment", path: ["runs", 2, "startedAt"] }],
      },
    ],
    holds: [
      {
        name: "a run started with its experiment",
        edit: (e) => (run(e, 2).startedAt = start),
      },
    ],
  },
  "settled-after-started": {
    breaks: [
      {
        name: "a run settled before it started",
        edit: (e) => (run(e, 1).settledAt = start + 14),
        problems: [{ rule: "settled-after-started", path: ["runs", 1, "settledAt"] }],
      },
    ],
    holds: [
      {
        name: "a run settled as it started",
        edit: (e) => (run(e, 1).settledAt = start + 15),
      },
      {
        name: "runs settled out of the order they started",
        edit: (e) => (run(e, 1).settledAt = start + 16),
      },
    ],
  },
  "progress-while-pending": {
    breaks: [
      {
        name: "a settled run with progress",
        edit: (e) => (run(e, 1).progress = { done: 10, total: 10 }),
        problems: [{ rule: "progress-while-pending", path: ["runs", 1, "progress"] }],
      },
    ],
    holds: [
      {
        name: "a pending run with all done",
        edit: (e) => (run(e, 2).progress = { done: 10, total: 10 }),
      },
    ],
  },
  "progress-within-total": {
    breaks: [
      {
        name: "more done than in total",
        edit: (e) => (run(e, 2).progress = { done: 11, total: 10 }),
        problems: [
          { rule: "progress-within-total", path: ["runs", 2, "progress", "done"] },
        ],
      },
    ],
    holds: [
      { name: "none of none", edit: (e) => (run(e, 2).progress = { done: 0, total: 0 }) },
    ],
  },

  "slice-passing-within-total": {
    breaks: [
      {
        name: "more passing before than in the slice",
        edit: (e) => {
          cases(e).slices[0]!.passingBefore = 61
          cases(e).slices[0]!.passingAfter = 60
        },
        problems: [
          {
            rule: "slice-passing-within-total",
            path: ["runs", 0, "cases", "slices", 0, "passingBefore"],
          },
        ],
      },
      {
        name: "more passing after than in the slice",
        edit: (e) => {
          cases(e).slices[1]!.passingBefore = 40
          cases(e).slices[1]!.passingAfter = 41
        },
        problems: [
          {
            rule: "slice-passing-within-total",
            path: ["runs", 0, "cases", "slices", 1, "passingAfter"],
          },
        ],
      },
    ],
    holds: [
      {
        name: "every case passing, after in one slice and before in another",
        edit: (e) => {
          cases(e).slices[0] = {
            name: "s1",
            total: 60,
            passingBefore: 58,
            passingAfter: 60,
          }
          cases(e).slices[1] = {
            name: "s2",
            total: 20,
            passingBefore: 20,
            passingAfter: 19,
          }
        },
      },
    ],
  },
  "slice-within-cases": {
    breaks: [
      {
        name: "a slice with more cases than the run",
        edit: (e) => (cases(e).slices[0]!.total = 101),
        problems: [
          {
            rule: "slice-within-cases",
            path: ["runs", 0, "cases", "slices", 0, "total"],
          },
        ],
      },
    ],
    holds: [
      { name: "a slice of every case", edit: (e) => (cases(e).slices[0]!.total = 100) },
    ],
  },
  "slice-coherent": {
    breaks: [
      {
        name: "a slice passing more by more than were fixed",
        edit: (e) => (cases(e).slices[0]!.passingAfter = 34),
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 0] }],
      },
      {
        name: "a slice passing fewer by more than were broken",
        edit: (e) => (cases(e).slices[1]!.passingAfter = 18),
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 1] }],
      },
      {
        name: "a broken case listed in a slice with no cases",
        edit: (e) => {
          cases(e).slices[1] = { name: "s2", total: 0, passingBefore: 0, passingAfter: 0 }
        },
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 1] }],
      },
      {
        name: "a slice of every case that did not move by fixed less broken",
        edit: (e) =>
          cases(e).slices.push({
            name: "all",
            total: 100,
            passingBefore: 50,
            passingAfter: 50,
          }),
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 2] }],
      },
      {
        name: "a slice leaving too few cases outside it for the rest that moved",
        edit: (e) => {
          cases(e).total = 10
          cases(e).fixed = 5
          cases(e).broken = 0
          cases(e).slices = [{ name: "s1", total: 8, passingBefore: 3, passingAfter: 3 }]
          cases(e).moved = []
        },
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 0] }],
      },
      {
        name: "a broken case listed in a slice with nothing passing before",
        edit: (e) => {
          cases(e).slices[1] = {
            name: "s2",
            total: 40,
            passingBefore: 0,
            passingAfter: 0,
          }
        },
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 1] }],
      },
      {
        name: "a fixed case listed in a slice that was all passing before",
        edit: (e) => {
          cases(e).fixed = 1
          cases(e).slices[0] = {
            name: "s1",
            total: 60,
            passingBefore: 60,
            passingAfter: 60,
          }
        },
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 0] }],
      },
      {
        name: "more fixed listed in a slice than its fall leaves room for",
        edit: (e) => {
          cases(e).fixed = 3
          cases(e).broken = 2
          cases(e).slices = [
            { name: "s1", total: 60, passingBefore: 30, passingAfter: 28 },
          ]
          cases(e).moved = [1, 2, 3].map((n) => ({
            id: `c${n}`,
            title: "Fixed",
            slice: "s1",
            move: "fixed" as const,
          }))
        },
        problems: [{ rule: "slice-coherent", path: ["runs", 0, "cases", "slices", 0] }],
      },
    ],
    holds: [
      {
        name: "a slice moved by every case fixed, and one by every case broken",
        edit: (e) => {
          cases(e).slices[0]!.passingAfter = 33
          cases(e).slices[1]!.passingAfter = 19
        },
      },
      {
        name: "slices that overlap: one of every case beside the others",
        edit: (e) =>
          cases(e).slices.push({
            name: "all",
            total: 100,
            passingBefore: 50,
            passingAfter: 52,
          }),
      },
      {
        name: "one slice covering some of the cases",
        edit: (e) => {
          cases(e).slices = [{ name: "s1", total: 10, passingBefore: 5, passingAfter: 5 }]
          cases(e).moved = []
        },
      },
      {
        name: "churn: as many fixed as broken, and no change",
        edit: (e) => {
          cases(e).fixed = 1
          cases(e).broken = 1
          cases(e).slices[0]!.passingAfter = 30
          cases(e).moved = [
            { id: "c1", title: "Case 1", slice: "s1", move: "fixed" },
            { id: "c2", title: "Case 2", slice: "s1", move: "broken" },
          ]
        },
      },
    ],
  },
  "slice-names-unique": {
    breaks: [
      {
        name: "a slice listed twice",
        edit: (e) => cases(e).slices.push({ ...cases(e).slices[0]! }),
        problems: [
          { rule: "slice-names-unique", path: ["runs", 0, "cases", "slices", 2, "name"] },
        ],
      },
    ],
    holds: [
      {
        name: "one slice name in two runs",
        edit: (e) => (run(e, 1).cases = { ...cases(e), moved: [] }),
      },
    ],
  },
  "moved-within-total": {
    breaks: [
      {
        name: "more moved than the run has",
        edit: (e) => (cases(e).broken = 98),
        problems: [{ rule: "moved-within-total", path: ["runs", 0, "cases"] }],
      },
    ],
    holds: [
      {
        name: "every case moved",
        edit: (e) => {
          cases(e).broken = 97
          cases(e).slices[0] = {
            name: "s1",
            total: 60,
            passingBefore: 58,
            passingAfter: 2,
          }
          cases(e).slices[1] = {
            name: "s2",
            total: 40,
            passingBefore: 39,
            passingAfter: 1,
          }
        },
      },
    ],
  },
  "moved-page-within-counts": {
    breaks: [
      {
        // Each slice alone could hold its one fixed case; together they list two.
        name: "more fixed listed than fixed",
        edit: (e) => {
          cases(e).fixed = 1
          cases(e).slices[0]!.passingAfter = 31
          cases(e).moved.push({ id: "c3", title: "Case 3", slice: "s2", move: "fixed" })
        },
        problems: [
          { rule: "moved-page-within-counts", path: ["runs", 0, "cases", "moved"] },
        ],
      },
      {
        name: "more broken listed than broken",
        edit: (e) =>
          cases(e).moved.push({ id: "c4", title: "Case 4", slice: "s1", move: "broken" }),
        problems: [
          { rule: "moved-page-within-counts", path: ["runs", 0, "cases", "moved"] },
        ],
      },
    ],
    holds: [
      {
        name: "exactly as many listed as moved",
        edit: (e) => {
          cases(e).fixed = 1
          cases(e).slices[0]!.passingAfter = 31
        },
      },
      { name: "none listed", edit: (e) => (cases(e).moved = []) },
    ],
  },
  "moved-ids-unique": {
    breaks: [
      {
        name: "a case listed twice",
        edit: (e) => (cases(e).moved[1]!.id = "c1"),
        problems: [
          { rule: "moved-ids-unique", path: ["runs", 0, "cases", "moved", 1, "id"] },
        ],
      },
    ],
    holds: [
      {
        name: "a case id that is a slice name",
        edit: (e) => (cases(e).moved[1]!.id = "s1"),
      },
    ],
  },
  "moved-slice-defined": {
    breaks: [
      {
        name: "a case in a slice the run does not have",
        edit: (e) => (cases(e).moved[0]!.slice = "s3"),
        problems: [
          {
            rule: "moved-slice-defined",
            path: ["runs", 0, "cases", "moved", 0, "slice"],
          },
        ],
      },
    ],
    holds: [
      { name: "a case in another slice", edit: (e) => (cases(e).moved[0]!.slice = "s2") },
    ],
  },
  "file-paths-unique": {
    breaks: [
      {
        name: "a file listed twice",
        edit: (e) => (change(e).files[1]!.path = "a.ts"),
        problems: [
          { rule: "file-paths-unique", path: ["runs", 0, "change", "files", 1, "path"] },
        ],
      },
    ],
    holds: [
      { name: "no files", edit: (e) => (change(e).files = []) },
      {
        name: "paths differing in case",
        edit: (e) => (change(e).files[1]!.path = "A.ts"),
      },
    ],
  },

  "best-runs-unique": {
    breaks: [
      {
        name: "a run named twice",
        edit: (e) => (e.bestSoFar = ["r1", "r1"]),
        problems: [{ rule: "best-runs-unique", path: ["bestSoFar", 1] }],
      },
    ],
    holds: [{ name: "the fixture's one", edit: () => {} }],
  },
  "best-runs-kept": {
    breaks: [
      {
        name: "a rejected run",
        edit: (e) => e.bestSoFar.push("r2"),
        problems: [{ rule: "best-runs-kept", path: ["bestSoFar", 1] }],
      },
      {
        name: "a pending run",
        edit: (e) => e.bestSoFar.push("r3"),
        problems: [{ rule: "best-runs-kept", path: ["bestSoFar", 1] }],
      },
      {
        name: "a run that is not one",
        edit: (e) => e.bestSoFar.push("r9"),
        problems: [{ rule: "best-runs-kept", path: ["bestSoFar", 1] }],
      },
      {
        name: "the baseline",
        edit: (e) => e.bestSoFar.push("base"),
        problems: [{ rule: "best-runs-kept", path: ["bestSoFar", 1] }],
      },
    ],
    holds: [
      {
        name: "a second kept run",
        edit: (e) => {
          run(e, 1).verdict = "keep"
          e.bestSoFar.push("r2")
        },
      },
    ],
  },
  "best-runs-scored": {
    breaks: [
      {
        name: "a kept run with no score on the primary split",
        edit: (e) => (run(e, 0).scores = { a: { mean: 55 } }),
        problems: [{ rule: "best-runs-scored", path: ["bestSoFar", 0] }],
      },
      {
        name: "a kept run with no score on a primary split named for an inherited member",
        edit: (e) => {
          e.definition.splits[1]!.id = "toString"
          e.definition.primarySplit = "toString"
          e.baseline.scores = { a: { mean: 50 }, toString: { mean: 50 } }
          run(e, 0).scores = { a: { mean: 55 } }
          run(e, 1).scores = {}
        },
        problems: [{ rule: "best-runs-scored", path: ["bestSoFar", 0] }],
      },
    ],
    holds: [
      {
        name: "a kept run scored only on the primary split",
        edit: (e) => (run(e, 0).scores = { b: { mean: 55 } }),
      },
    ],
  },
  "best-settled-in-order": {
    breaks: [
      {
        name: "a run that settled before the one it follows",
        edit: (e) => {
          run(e, 1).verdict = "keep"
          run(e, 0).settledAt = start + 41
          e.bestSoFar = ["r1", "r2"]
        },
        problems: [{ rule: "best-settled-in-order", path: ["bestSoFar", 1] }],
      },
    ],
    holds: [
      {
        name: "two runs that settled at once",
        edit: (e) => {
          run(e, 1).verdict = "keep"
          run(e, 0).settledAt = start + 40
          e.bestSoFar = ["r1", "r2"]
        },
      },
      {
        name: "kept in settling order, not in number order",
        edit: (e) => {
          run(e, 1).verdict = "keep"
          run(e, 1).settledAt = start + 18
          run(e, 0).settledAt = start + 40
          e.bestSoFar = ["r2", "r1"]
        },
      },
    ],
  },
  "kept-runs-best": {
    breaks: [
      {
        name: "a kept run not named",
        edit: (e) => (e.bestSoFar = []),
        problems: [{ rule: "kept-runs-best", path: ["runs", 0, "verdict"] }],
      },
    ],
    holds: [
      {
        name: "no kept run, and none named",
        edit: (e) => {
          run(e, 0).verdict = "drop"
          e.bestSoFar = []
        },
      },
    ],
  },
}

describe("validateExperiment", () => {
  it("accepts the fixture", () => {
    expect(problems(fixture())).toEqual([])
  })

  it("has a table entry for every rule, each with a break and a hold", () => {
    expect(Object.keys(table).sort()).toEqual([...rules].sort())
    for (const rule of rules) {
      expect(table[rule].breaks.length, rule).toBeGreaterThan(0)
      expect(table[rule].holds.length, rule).toBeGreaterThan(0)
    }
  })

  for (const rule of rules) {
    describe(rule, () => {
      for (const { name, edit, problems: expected } of table[rule].breaks) {
        it(`refuses ${name}`, () => {
          expect(problems(edited(edit))).toEqual(expected)
        })
      }
      for (const { name, edit } of table[rule].holds) {
        it(`accepts ${name}`, () => {
          expect(problems(edited(edit))).toEqual([])
        })
      }
    })
  }

  it("reports every problem, not the first", () => {
    const input = edited((e) => {
      run(e, 1).verdict = "lost"
      e.notes[0]!.runId = "r9"
    })
    expect(problems(input)).toEqual([
      { rule: "verdict-defined", path: ["runs", 1, "verdict"] },
      { rule: "note-run-defined", path: ["notes", 0, "runId"] },
    ])
  })

  it("refuses what is not an object", () => {
    for (const input of [null, undefined, 1, "experiment", []]) {
      expect(problems(input)).toEqual([{ rule: "shape", path: [] }])
    }
  })

  it("answers with typed problems, each with a message", () => {
    const validation = validateExperiment(edited((e) => (run(e, 1).verdict = "lost")))
    expect(validation).toEqual({
      kind: "invalid",
      problems: [
        {
          rule: "verdict-defined",
          path: ["runs", 1, "verdict"],
          message: "verdict lost is not defined",
        },
      ],
    })
  })
})

describe("what validateExperiment returns", () => {
  const valid = (input: unknown): Experiment => {
    const validation = validateExperiment(input)
    if (validation.kind !== "valid") throw new Error(JSON.stringify(validation.problems))
    return validation.experiment
  }

  it("is a copy, and the input changing afterwards does not change it", () => {
    const input = fixture()
    const experiment = valid(input)
    expect(experiment).not.toBe(input)
    expect(experiment.runs).not.toBe(input.runs)
    expect(experiment.runs[0]!.scores).not.toBe(input.runs[0]!.scores)
    input.runs[0]!.verdict = "drop"
    input.bestSoFar.push("r9")
    input.runs[0]!.cases!.slices[0]!.total = 0
    expect(experiment.runs[0]!.verdict).toBe("keep")
    expect(experiment.bestSoFar).toEqual(["r1"])
    expect(experiment.runs[0]!.cases!.slices[0]!.total).toBe(60)
  })

  it("is frozen at every level", () => {
    const experiment = valid(fixture())
    const unfrozen: string[] = []
    const visit = (node: unknown, path: string) => {
      if (node === null || typeof node !== "object") return
      if (!Object.isFrozen(node)) unfrozen.push(path)
      for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`)
    }
    visit(experiment, "experiment")
    expect(unfrozen).toEqual([])
  })

  it("reads the input once: a getter that changes its answer cannot pass a rule it breaks", () => {
    const input = fixture()
    let reads = 0
    // Pending on the first read, as the parser sees it; kept on any later one.
    Object.defineProperty(input.runs[2]!, "verdict", {
      enumerable: true,
      get: () => (reads++ === 0 ? "wait" : "keep"),
    })
    const experiment = valid(input)
    expect(reads).toBe(1)
    expect(experiment.runs[2]!.verdict).toBe("wait")
  })

  it("keeps a table's own entries only", () => {
    const experiment = valid(
      edited((e) => {
        e.definition.splits[0]!.id = "constructor"
        e.baseline.scores = { constructor: { mean: 50 }, b: { mean: 50 } }
        run(e, 0).scores = { constructor: { mean: 1 }, b: { mean: 54 } }
      }),
    )
    expect(scoreOf(experiment.runs[0]!, "constructor")).toEqual({ mean: 1 })
    expect(scoreOf(experiment.runs[1]!, "constructor")).toBeUndefined()
    expect(scoreOf(experiment.runs[1]!, "toString")).toBeUndefined()
  })

  it("is the only way to an Experiment", () => {
    const experiment = valid(fixture())
    // @ts-expect-error A spread copy is not an Experiment: the brand is not copied.
    const spread: Experiment = { ...experiment, bestSoFar: [] }
    // @ts-expect-error The shape alone is not an Experiment.
    const shape: Experiment = experiment as ExperimentData
    expect([spread, shape]).toHaveLength(2)
  })
})
