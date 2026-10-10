import { describe, expect, it } from "vitest"

import { checkoutSample, latencySample } from "../samples/index.ts"
import { measureOf, movedCount, scoreOf, type Experiment } from "./experiment.ts"
import { fixture, start, type Fixture } from "./fixture.ts"
import {
  bestVersion,
  climb,
  isBaselineScored,
  guardrailChange,
  limitOf,
  lineage,
  lineTotals,
  metricChange,
  pathToBest,
  runOf,
  runsByScore,
  runsNewestFirst,
  primarySplitOf,
  verdictOf,
} from "./selections.ts"
import { validateExperiment } from "./validation.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function valid(input: unknown): Experiment {
  const validation = validateExperiment(input)
  if (validation.kind !== "valid") throw new Error(JSON.stringify(validation.problems))
  return validation.experiment
}

function edited(edit: (experiment: Fixture) => void): Experiment {
  const experiment = fixture()
  edit(experiment)
  return valid(experiment)
}

const checkout = valid(checkoutSample(begun))
const latency = valid(latencySample(begun))
const ids = (runs: readonly { readonly id: string }[]) => runs.map((run) => run.id)

describe("verdictOf", () => {
  it("is the definition's verdict the run was given", () => {
    for (const run of checkout.runs) {
      const verdict = verdictOf(checkout, run)
      expect(verdict.id).toBe(run.verdict)
      expect(checkout.definition.verdicts).toContain(verdict)
    }
  })
})

describe("primarySplitOf", () => {
  it("is the definition's split the climb follows", () => {
    expect(primarySplitOf(checkout)).toEqual({ id: "test", label: "Test" })
    expect(primarySplitOf(latency)).toEqual({ id: "replay", label: "Replayed traffic" })
  })
})

describe("bestVersion", () => {
  it("is the last of bestSoFar", () => {
    const last = checkout.bestSoFar.at(-1)
    const latencyLast = latency.bestSoFar.at(-1)
    if (last === undefined || latencyLast === undefined) {
      throw new Error("each sample kept a run")
    }
    expect(last).toBe("r23")
    expect(bestVersion(checkout)).toEqual({ kind: "run", run: runOf(checkout, last) })
    expect(bestVersion(latency)).toEqual({
      kind: "run",
      run: runOf(latency, latencyLast),
    })
  })

  it("is the last of bestSoFar, not the last kept run nor the best score", () => {
    // r2 is kept and settled first, and scores higher; r1 is named last.
    const experiment = edited((e) => {
      e.runs[1]!.verdict = "keep"
      e.runs[1]!.settledAt = start + 18
      e.runs[1]!.scores = { b: { mean: 99 } }
      e.bestSoFar = ["r2", "r1"]
    })
    expect(bestVersion(experiment)).toEqual({ kind: "run", run: experiment.runs[0] })
  })

  it("is the baseline while bestSoFar is empty", () => {
    const experiment = edited((e) => {
      e.runs[0]!.verdict = "drop"
      e.bestSoFar = []
    })
    expect(bestVersion(experiment)).toEqual({
      kind: "baseline",
      baseline: experiment.baseline,
    })
  })
})

describe("climb", () => {
  it("begins at the baseline's score at the experiment's start, and steps at each keep's settledAt", () => {
    const { best } = climb(latency)
    expect(best).toEqual([
      { at: begun, value: 462 },
      { runId: "l1", at: runOf(latency, "l1")!.settledAt, value: 418 },
      { runId: "l3", at: runOf(latency, "l3")!.settledAt, value: 371 },
      { runId: "l6", at: runOf(latency, "l6")!.settledAt, value: 322 },
    ])
  })

  it("has a point for every settled run scored on the primary split, in the order they settled", () => {
    const { points } = climb(checkout)
    const settled = checkout.runs.filter((run) => run.settledAt !== undefined)
    expect(points).toHaveLength(settled.length)
    expect(points.map((point) => point.at)).toEqual(
      [...points.map((point) => point.at)].sort((a, b) => a - b),
    )
    // r20 was kept after reruns: it settled after r21 and r22, which were made after it.
    const order = points.map((point) => point.runId)
    expect(order.indexOf("r20")).toBeGreaterThan(order.indexOf("r22"))
  })

  it("never steps backwards in time when a keep settles late", () => {
    const { best } = climb(checkout)
    for (let index = 1; index < best.length; index += 1) {
      expect(best[index]!.at).toBeGreaterThanOrEqual(best[index - 1]!.at)
    }
    expect(best.map((step) => step.runId)).toEqual([undefined, ...checkout.bestSoFar])
  })

  it("begins at the first keep while the baseline is not scored", () => {
    const experiment = edited((e) => (e.baseline.scores = { a: { mean: 50 } }))
    expect(isBaselineScored(experiment)).toBe(false)
    expect(climb(experiment).best).toEqual([{ runId: "r1", at: start + 20, value: 54 }])
  })

  it("leaves out pending runs and runs with no score on the primary split", () => {
    const experiment = edited((e) => (e.runs[1]!.scores = { a: { mean: 1 } }))
    expect(climb(experiment).points).toEqual([{ runId: "r1", at: start + 20, value: 54 }])
  })

  it("orders runs that settled at one time by number", () => {
    const experiment = edited((e) => {
      e.runs[1]!.settledAt = start + 20
      e.runs.reverse()
    })
    expect(climb(experiment).points.map((point) => point.runId)).toEqual(["r1", "r2"])
  })
})

describe("pathToBest", () => {
  it("is bestSoFar in order, each with its gain on the one before, in the metric's terms", () => {
    const path = pathToBest(latency)
    expect(ids(path.map((step) => step.run))).toEqual(["l1", "l3", "l6"])
    expect(path.map((step) => step.gain)).toEqual([
      { value: -44, size: "44 ms", tone: "good" },
      { value: -47, size: "47 ms", tone: "good" },
      { value: -49, size: "49 ms", tone: "good" },
    ])
  })

  it("reads a gain within the noise as neutral", () => {
    const experiment = edited((e) => (e.runs[0]!.scores = { b: { mean: 50.4 } }))
    expect(pathToBest(experiment)[0]!.gain).toEqual({
      value: 0.4,
      size: "0.4 pts",
      tone: "neutral",
    })
  })

  it("gives the first step no gain while the baseline is not scored", () => {
    const experiment = edited((e) => (e.baseline.scores = {}))
    expect(pathToBest(experiment)).toEqual([{ run: experiment.runs[0] }])
  })

  it("is up on the hill-climb, where higher is better", () => {
    const tones = pathToBest(checkout).map((step) => step.gain?.tone)
    expect(tones).toEqual(checkout.bestSoFar.map(() => "good"))
  })
})

describe("metricChange and guardrailChange", () => {
  it("read the experiment's own metric against its noise", () => {
    expect(metricChange(latency, 462, 450)).toEqual({
      value: -12,
      size: "12 ms",
      tone: "neutral",
    })
    expect(metricChange(latency, 462, 446)).toEqual({
      value: -16,
      size: "16 ms",
      tone: "good",
    })
  })

  it("read a guardrail's metric with no noise, for the experiment's is its own metric's", () => {
    // Within the latency experiment's noise of 15, were it applied: still bad.
    expect(guardrailChange(latency, "accuracy", 98, 97.9)).toEqual({
      value: -0.1,
      size: "0.1%",
      tone: "bad",
    })
    expect(guardrailChange(checkout, "cost", 5.2, 5.0)).toEqual({
      value: -0.2,
      size: "$0.20",
      tone: "good",
    })
  })

  it("is undefined for a guardrail that is not one", () => {
    expect(guardrailChange(checkout, "toString", 1, 2)).toBeUndefined()
  })
})

describe("lineage", () => {
  it("runs from the baseline down to the run, through each parent", () => {
    const chain = lineage(latency, "l6")!
    expect(chain.baseline).toBe(latency.baseline)
    expect(ids(chain.runs)).toEqual(["l1", "l3", "l6"])
  })

  it("is the run alone when it was built on the baseline", () => {
    expect(ids(lineage(checkout, "r1")!.runs)).toEqual(["r1"])
  })

  it("is undefined for a run that is not one, the baseline included", () => {
    expect(lineage(checkout, "r999")).toBeUndefined()
    expect(lineage(checkout, checkout.baseline.id)).toBeUndefined()
  })
})

describe("runsNewestFirst", () => {
  it("orders by startedAt, newest first", () => {
    const runs = runsNewestFirst(checkout)
    expect(runs[0]!.id).toBe("r29")
    expect(runs.at(-1)!.id).toBe("r1")
  })

  it("orders runs that started at once by number, highest first", () => {
    const experiment = edited((e) => (e.runs[2]!.startedAt = start + 15))
    expect(ids(runsNewestFirst(experiment))).toEqual(["r3", "r2", "r1"])
  })

  it("does not change the experiment's own order", () => {
    runsNewestFirst(checkout)
    expect(checkout.runs[0]!.id).toBe("r1")
  })
})

describe("runsByScore", () => {
  it("puts the highest first where higher is better", () => {
    const runs = runsByScore(checkout, "test").filter((run) => scoreOf(run, "test"))
    const means = runs.map((run) => scoreOf(run, "test")!.mean)
    expect(means).toEqual([...means].sort((a, b) => b - a))
  })

  it("puts the lowest first where lower is better", () => {
    const runs = runsByScore(latency, "replay").filter((run) => scoreOf(run, "replay"))
    expect(ids(runs)).toEqual(["l6", "l2", "l4", "l3", "l5", "l1"])
  })

  it("puts runs with no score last, newest first, and ties newest first", () => {
    const experiment = edited((e) => (e.runs[1]!.scores = { b: { mean: 54 } }))
    expect(ids(runsByScore(experiment, "b"))).toEqual(["r2", "r1", "r3"])
    expect(ids(runsByScore(experiment, "a"))).toEqual(["r1", "r3", "r2"])
  })
})

describe("limitOf", () => {
  it("is the limit's value, for a limit that is absolute", () => {
    expect(limitOf(latency, "accuracy")).toEqual({
      kind: "limit",
      bound: "at-least",
      value: 97,
      formatted: "97.0%",
    })
  })

  it("is the ratio of the baseline's measure, for a limit relative to the baseline", () => {
    expect(limitOf(checkout, "cost")).toEqual({
      kind: "limit",
      bound: "at-most",
      // Exactly 5.72; the binary product is 5.720000000000001.
      value: 5.72,
      formatted: "$5.72",
    })
  })

  it("is the exact product, written: 1.05 times 1.9 is 1.995, written 2.00", () => {
    const experiment = edited((e) => {
      e.definition.guardrails[0]!.limit = {
        bound: "at-most",
        value: 1.05,
        relativeTo: "baseline",
      }
      e.baseline.measures = { g: 1.9 }
    })
    expect(limitOf(experiment, "g")).toEqual({
      kind: "limit",
      bound: "at-most",
      value: 1.995,
      formatted: "2.00¢",
    })
  })

  it("is not measured yet while the baseline has no measure for it", () => {
    const experiment = edited((e) => (e.baseline.measures = {}))
    expect(limitOf(experiment, "g")).toEqual({ kind: "not-measured-yet" })
  })

  it("is undefined for a guardrail that is not one", () => {
    expect(limitOf(checkout, "toString")).toBeUndefined()
  })
})

describe("tables and counts", () => {
  it("reads a score or a measure only where the table owns one", () => {
    const run = runOf(checkout, "r1")!
    expect(scoreOf(run, "test")).toEqual(run.scores.test)
    expect(scoreOf(run, "toString")).toBeUndefined()
    expect(measureOf(run, "cost")).toBe(run.measures.cost)
    expect(measureOf(run, "constructor")).toBeUndefined()
  })

  it("counts the moved as the fixed and the broken together", () => {
    const cases = runOf(checkout, "r3")!.cases!
    expect(movedCount(cases)).toBe(cases.fixed + cases.broken)
  })

  it("totals a change's lines over its files", () => {
    expect(lineTotals(edited(() => {}).runs[0]!.change!)).toEqual({
      added: 13,
      removed: 1,
    })
  })
})
