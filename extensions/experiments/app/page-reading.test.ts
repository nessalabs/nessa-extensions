import { describe, expect, it } from "vitest"

import {
  pathToBest,
  validateExperiment,
  type Experiment,
  type ExperimentInput,
} from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
import {
  acceptedRuns,
  areaGains,
  headline,
  lineageSteps,
  noteReads,
  outcomeRead,
  pathSteps,
  runRow,
  runRows,
  runsSubtitle,
  swarmNow,
} from "./page-reading.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function experiment(sample: (startedAt: number) => ExperimentInput): Experiment {
  const result = validateExperiment(sample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

describe("what the pages read", () => {
  it("reads the checkout headline, path and swarm from the definition", () => {
    const checkout = experiment(checkoutSample)
    const head = headline(checkout)
    expect(head.title).toBe("Resolution rate")
    expect(head.subtitle).toBe("Test")
    expect(head.value).toBeDefined()
    expect(head.change?.tone).toBe("good")
    expect(head.kept).toMatch(/kept of/)

    const steps = pathSteps(checkout)
    expect(steps.map((step) => step.runId)).toEqual([...checkout.bestSoFar])
    expect(steps.map((step) => step.runId)).toEqual(
      pathToBest(checkout).map((step) => step.run.id),
    )

    expect(swarmNow(checkout).length).toBeGreaterThan(0)
    expect(
      swarmNow(checkout).some((agent) => agent.detail.startsWith("Evaluating")),
    ).toBe(true)
    expect(
      noteReads(checkout)
        .map((note) => note.text)
        .join(" "),
    ).toContain("escalation")
    expect(areaGains(checkout).map((gain) => gain.name)).toContain("System prompt")
  })

  it("reads a latency regression as bad, and has no areas and no swarm", () => {
    const latency = experiment(latencySample)
    expect(areaGains(latency)).toEqual([])
    expect(swarmNow(latency)).toEqual([])
    expect(headline(latency).title).toBe("p95 latency")
    expect(headline(latency).subtitle).toBe("Replayed traffic")
    const slower = runRows(latency).find((row) => row.id === "l5")
    expect(slower?.verdict).toBe("Slower")
    expect(slower?.change?.tone).toBe("bad")
    const run = latency.runs.find((each) => each.id === "l5")
    if (run === undefined) throw new Error("l5 is a run")
    const runs = acceptedRuns(latency.runs)
    const outcome = outcomeRead(latency, run, runs)
    expect(outcome.guardrails.map((guardrail) => guardrail.name)).toContain(
      "Answer accuracy",
    )
    expect(lineageSteps(latency, "l5", runs)?.map((step) => step.label)).toEqual([
      "Baseline",
      "Run 1",
      "Run 3",
      "Run 5",
    ])
  })

  it("shows a run whose verdict the definition dropped as unknown", () => {
    const checkout = experiment(checkoutSample)
    const run = checkout.runs[0]
    if (run === undefined) throw new Error("the sample has a run")
    const row = runRow(
      checkout,
      { ...run, verdict: "retired" },
      acceptedRuns(checkout.runs),
    )
    expect(row.verdict).toBe("Unknown")
    expect(row.verdictId).toBe("retired")
    expect(row.tone).toBe("neutral")
  })

  it("names a verdict filter in the runs subtitle", () => {
    expect(runsSubtitle(29)).toBe("29 runs")
    expect(runsSubtitle(1)).toBe("1 run")
    expect(runsSubtitle(29, { count: 7, label: "Kept" })).toBe("7 kept of 29 runs")
    expect(runsSubtitle(29, { count: 1, label: "Within noise" })).toBe(
      "1 within noise of 29 runs",
    )
  })
})
