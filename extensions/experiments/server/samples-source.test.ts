import { describe, expect, it } from "vitest"

import { validateExperiment } from "../model/index.ts"
import {
  checkoutExperimentId,
  checkoutSample,
  latencyExperimentId,
  scaleExperimentId,
} from "../samples/index.ts"
import { samplesSource } from "./samples-source.ts"

const startedAt = Date.UTC(2026, 0, 1)
const signal = new AbortController().signal

describe("samplesSource", () => {
  const source = samplesSource(startedAt)

  it("has the three samples, each valid and dated from startedAt", async () => {
    expect(await source.ids(signal)).toEqual([
      checkoutExperimentId,
      latencyExperimentId,
      scaleExperimentId,
    ])
    for (const id of await source.ids(signal)) {
      const validation = validateExperiment(await source.experiment(id, signal))
      expect(validation.kind).toBe("valid")
      expect(validation.kind === "valid" && validation.experiment.startedAt).toBe(
        startedAt,
      )
    }
    expect(await source.experiment(checkoutExperimentId, signal)).toEqual(
      checkoutSample(startedAt),
    )
  })

  it("has nothing for any other id, an inherited key's included", async () => {
    for (const id of ["nope", "__proto__", "constructor", "toString"]) {
      expect(await source.experiment(id, signal)).toBeUndefined()
    }
  })

  it("says it cannot open a file, since the samples have none", async () => {
    expect(
      await source.openFile(
        { experimentId: checkoutExperimentId, runId: "r1", path: "a.ts" },
        signal,
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "The samples record what a run changed, not the files' contents.",
    })
  })
})
