import { describe, expect, it } from "vitest"

import { validateExperiment, type Experiment } from "../model/index.ts"
import * as model from "../model/index.ts"
import {
  checkoutSample,
  latencySample,
  scaleCases,
  scaleFiles,
  scaleSample,
} from "./index.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function valid(input: unknown): Experiment {
  const validation = validateExperiment(input)
  if (validation.kind !== "valid") throw new Error(JSON.stringify(validation.problems))
  return validation.experiment
}

describe("the samples", () => {
  it("are each a valid experiment", () => {
    for (const sample of [checkoutSample, latencySample, scaleSample]) {
      expect(validateExperiment(sample(begun)).kind, sample.name).toBe("valid")
    }
  })

  it("read the same every time, and are dated from when they began", () => {
    expect(checkoutSample(begun)).toEqual(checkoutSample(begun))
    const later = checkoutSample(begun + 1000)
    expect(later.runs[0]!.startedAt).toBe(checkoutSample(begun).runs[0]!.startedAt + 1000)
  })

  it("validate into copies frozen at every level, every variant of every union included", () => {
    for (const sample of [checkoutSample, latencySample, scaleSample]) {
      const unfrozen: string[] = []
      const visit = (node: unknown, path: string) => {
        if (node === null || typeof node !== "object") return
        if (!Object.isFrozen(node)) unfrozen.push(path)
        for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`)
      }
      visit(valid(sample(begun)), sample.name)
      expect(unfrozen).toEqual([])
    }
    // The checkout sample has an agent of each kind of activity but diagnosing.
    const kinds = valid(checkoutSample(begun)).agents.map((agent) => agent.activity.kind)
    expect(new Set(kinds)).toEqual(new Set(["evaluating", "drafting", "resting"]))
  })

  it("survive JSON, as a tool's data does", () => {
    for (const sample of [checkoutSample, latencySample, scaleSample]) {
      const experiment = valid(sample(begun))
      expect(valid(JSON.parse(JSON.stringify(experiment)))).toEqual(experiment)
    }
  })

  it("are two kinds: a percent that rises with areas and agents, and a latency that falls with none", () => {
    const checkout = valid(checkoutSample(begun))
    expect(checkout.definition.metric.better).toBe("up")
    expect(checkout.definition.splits).toHaveLength(2)
    expect(checkout.definition.guardrails[0]!.limit.relativeTo).toBe("baseline")
    expect(checkout.areas).toHaveLength(5)
    expect(checkout.agents.length).toBeGreaterThan(0)

    const latency = valid(latencySample(begun))
    expect(latency.definition.metric).toMatchObject({ unit: " ms", better: "down" })
    expect(latency.definition.splits).toHaveLength(1)
    expect(latency.definition.guardrails[0]!.limit).toEqual({
      bound: "at-least",
      value: 97,
    })
    expect(latency.areas).toEqual([])
    expect(latency.agents).toEqual([])
    expect(latency.definition.reference).toBeUndefined()
    expect(latency.definition.budget).toBeUndefined()
  })

  it("include one run at scale: a million cases and ten thousand files", () => {
    const experiment = valid(scaleSample(begun))
    const [run] = experiment.runs
    expect(run!.cases!.total).toBe(scaleCases)
    expect(scaleCases).toBe(1_000_000)
    expect(run!.change!.files).toHaveLength(scaleFiles)
    expect(scaleFiles).toBe(10_000)
    expect(run!.cases!.moved).toHaveLength(200)
  })

  it("are not exported from the model", () => {
    expect(Object.keys(model).filter((name) => /sample/i.test(name))).toEqual([])
  })
})
