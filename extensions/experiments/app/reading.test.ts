import { describe, expect, it } from "vitest"

import { metricChange, validateExperiment, type ExperimentInput } from "../model/index.ts"
import { checkoutSample, latencySample, scaleSample } from "../samples/index.ts"
import {
  areaCards,
  caseResults,
  changeRead,
  climbRead,
  mapRead,
  runWithCases,
  verdicts,
} from "./reading.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function experiment(sample: (startedAt: number) => ExperimentInput) {
  const result = validateExperiment(sample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

describe("climbRead", () => {
  it("names the checkout metric, its primary split and its reference", () => {
    const read = climbRead(experiment(checkoutSample))
    expect(read.title).toBe("Resolution rate")
    expect(read.caption).toBe("Test")
    expect(read.reference?.label).toBe("Best model, max effort")
    expect(read.reference?.formatted).toBe("81.5%")
    const kept = read.points.find((point) => point.outcome === "kept")
    expect(kept?.scores.find((score) => score.label === "Test")?.change?.tone).toBe(
      "good",
    )
  })

  it("reads a latency regression against its parent, so one still ahead of the baseline is bad", () => {
    const latency = experiment(latencySample)
    const read = climbRead(latency)
    expect(read.title).toBe("p95 latency")
    expect(read.caption).toBe("Replayed traffic")
    expect(read.reference).toBeUndefined()
    expect(read.points.map((point) => point.runId)).not.toContain("l7")
    const slower = read.points.find((point) => point.runId === "l5")
    expect(slower?.verdict).toBe("Slower")
    expect(slower?.scores[0]?.change?.tone).toBe("bad")
    expect(metricChange(latency, 462, 392).tone).toBe("good")
  })
})

describe("areas, the map and the verdicts", () => {
  it("uses the checkout definition's names", () => {
    const checkout = experiment(checkoutSample)
    expect(areaCards(checkout).map((card) => card.name)).toContain("System prompt")
    expect(mapRead(checkout).areas.map((area) => area.name)).toContain("System prompt")
    expect(verdicts(checkout).map((verdict) => verdict.label)).toContain("Kept")
    expect(verdicts(checkout).map((verdict) => verdict.label)).toContain("Too costly")
  })

  it("is empty for a latency experiment, which defines none", () => {
    const latency = experiment(latencySample)
    expect(areaCards(latency)).toEqual([])
    expect(mapRead(latency).areas).toEqual([])
    expect(mapRead(latency).runs).toEqual([])
    expect(verdicts(latency).map((verdict) => verdict.label)).toEqual([
      "Faster",
      "Slower",
      "No faster",
      "Less accurate",
      "Measuring",
    ])
  })
})

describe("cases and changes", () => {
  it("writes the checkout case noun and a latency experiment's requests at scale", () => {
    const checkout = experiment(checkoutSample)
    const checkoutRun = runWithCases(checkout)
    if (checkoutRun === undefined) throw new Error("checkout has a run with cases")
    expect(caseResults(checkout, checkoutRun)?.fixed).toMatch(/test cases? fixed/)

    const latency = experiment(latencySample)
    expect(latency.runs.every((run) => caseResults(latency, run) === undefined)).toBe(
      true,
    )

    const scale = experiment(scaleSample)
    const run = scale.runs[0]
    if (run === undefined) throw new Error("the scale sample has its run")
    expect(caseResults(scale, run)?.fixed).toMatch(/requests fixed/)
    expect(changeRead(run)?.files).toHaveLength(10_000)
  })
})
