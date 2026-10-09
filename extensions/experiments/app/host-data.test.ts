import { describe, expect, it } from "vitest"

import type { CallToolResult } from "@nessalabs/app-shell"

import { validateExperiment, type Experiment } from "../model/index.ts"
import { checkoutSample } from "../samples/index.ts"
import {
  experimentFromResult,
  fetchedRun,
  listedRuns,
  loadExperiment,
  openAnswer,
} from "./host-data.ts"

const begun = Date.UTC(2026, 9, 1, 9)

function experiment(): Experiment {
  const result = validateExperiment(checkoutSample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

function result(data: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: isError ? "It failed." : "Ready." }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  }
}

describe("the tool result", () => {
  it("validates the experiment and refuses one that is not", () => {
    const checkout = experiment()
    const loaded = experimentFromResult(result({ experiment: checkout }))
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") return
    expect(loaded.experiment.id).toBe(checkout.id)
    expect(loaded.experiment).not.toBe(checkout)

    expect(experimentFromResult(result({}, true)).status).toBe("failed")
    expect(experimentFromResult(result({}))).toMatchObject({
      status: "failed",
      message: "The result has no experiment.",
    })
    expect(experimentFromResult(result({ experiment: { id: "nope" } })).status).toBe(
      "failed",
    )
  })

  it("waits, then reads a result, and keeps a cancellation", () => {
    expect(loadExperiment({ phase: "running", input: {} }).status).toBe("waiting")
    expect(loadExperiment({ phase: "cancelled", reason: "Stopped." })).toEqual({
      status: "cancelled",
      reason: "Stopped.",
    })
  })
})

function copy(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

describe("runs named by a later call", () => {
  it("draws the listed bodies, in the answered order, and refuses one that is not a run", () => {
    const checkout = experiment()
    const [first, second] = checkout.runs
    if (first === undefined || second === undefined) throw new Error("two runs")
    const fresh = { ...copy(second), reason: "Fresh from the server." }
    const listed = listedRuns(
      checkout,
      result({ experimentId: checkout.id, runs: [fresh, copy(first)] }),
    )
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.runs.map((run) => run.id)).toEqual([second.id, first.id])
    expect(listed.runs[0]?.reason).toBe("Fresh from the server.")
    expect(listed.runs[0]).not.toBe(second)

    expect(
      listedRuns(
        checkout,
        result({ experimentId: checkout.id, runs: [{ id: "missing" }] }),
      ).ok,
    ).toBe(false)
    expect(
      listedRuns(
        checkout,
        result({ experimentId: checkout.id, runs: [copy(first), copy(first)] }),
      ).ok,
    ).toBe(false)
  })

  it("draws the run get_run returned, and refuses a body that is not that run", () => {
    const checkout = experiment()
    const run = checkout.runs[0]
    if (run === undefined) throw new Error("a run")
    const fetched = fetchedRun(
      checkout,
      run.id,
      result({
        experimentId: checkout.id,
        run: { ...copy(run), reason: "Fresh from the server." },
      }),
    )
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) return
    expect(fetched.run.reason).toBe("Fresh from the server.")
    expect(fetched.run).not.toBe(run)
    expect(
      fetchedRun(
        checkout,
        run.id,
        result({ experimentId: checkout.id, run: { id: run.id } }),
      ).ok,
    ).toBe(false)
    expect(
      fetchedRun(checkout, run.id, result({ experimentId: checkout.id, run: copy(run) }))
        .ok,
    ).toBe(true)
    const other = checkout.runs[1]
    if (other === undefined) throw new Error("another run")
    expect(
      fetchedRun(
        checkout,
        run.id,
        result({ experimentId: checkout.id, run: copy(other) }),
      ).ok,
    ).toBe(false)
  })
})

describe("open_file", () => {
  it("accepts an http link, refuses a download, and refuses a javascript URL", () => {
    expect(
      openAnswer(result({ opening: { kind: "link", url: "https://example.com/a" } })),
    ).toEqual({ kind: "link", url: "https://example.com/a" })
    expect(
      openAnswer(
        result({
          opening: {
            kind: "download",
            name: "a.diff",
            mimeType: "text/plain",
            text: "diff",
          },
        }),
      ),
    ).toEqual({ kind: "refused", reason: "This view can't download a file." })
    expect(
      openAnswer(result({ opening: { kind: "link", url: "javascript:alert(1)" } })).kind,
    ).toBe("refused")
    expect(
      openAnswer(result({ opening: { kind: "link", url: "data:text/plain,hi" } })).kind,
    ).toBe("refused")
    expect(
      openAnswer(result({ opening: { kind: "unavailable", reason: "No file." } })),
    ).toEqual({
      kind: "refused",
      reason: "No file.",
    })
    expect(
      openAnswer(result({ opening: { kind: "link", url: "https://x", extra: 1 } })).kind,
    ).toBe("refused")
  })
})
