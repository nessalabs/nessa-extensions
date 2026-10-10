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
    expect(experimentFromResult(result({}))).toEqual({ status: "absent" })
    expect(
      experimentFromResult({ content: [{ type: "text", text: "The experiment." }] }),
    ).toEqual({ status: "absent" })
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
  it("draws the listed bodies in the answered order, and skips one that is not a run", () => {
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
    expect(listed.skipped).toBe(0)

    const again = { ...copy(first), reason: "The later copy." }
    const skipped = listedRuns(
      checkout,
      result({
        experimentId: checkout.id,
        runs: [copy(first), { id: "missing" }, again],
      }),
    )
    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    expect(skipped.runs.map((run) => run.id)).toEqual([first.id])
    expect(skipped.runs[0]?.reason).toBe(first.reason)
    expect(skipped.skipped).toBe(2)
  })

  it("accepts a run built on a parent that the same list includes", () => {
    const checkout = experiment()
    const source = checkout.runs[0]
    if (source === undefined) throw new Error("a run")
    const parent = {
      ...copy(source),
      id: "r100",
      number: 100,
      parentId: checkout.baseline.id,
    }
    const child = { ...copy(source), id: "r101", number: 101, parentId: "r100" }
    const listed = listedRuns(
      checkout,
      result({ experimentId: checkout.id, runs: [child, parent] }),
    )
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.runs.map((run) => run.id)).toEqual(["r101", "r100"])
    expect(listed.skipped).toBe(0)

    const fetched = fetchedRun(
      checkout,
      "r101",
      result({ experimentId: checkout.id, run: child }),
      listed.runs,
    )
    expect(fetched.ok).toBe(true)

    const orphan = { ...copy(source), id: "r102", number: 102, parentId: "r999" }
    const dropped = listedRuns(
      checkout,
      result({ experimentId: checkout.id, runs: [orphan] }),
    )
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    expect(dropped.runs).toEqual([])
    expect(dropped.skipped).toBe(1)
    const laterParent = { ...child, parentId: "r100", number: 50 }
    const outOfOrder = listedRuns(
      checkout,
      result({ experimentId: checkout.id, runs: [laterParent, parent] }),
    )
    expect(outOfOrder.ok).toBe(true)
    if (!outOfOrder.ok) return
    expect(outOfOrder.runs.map((run) => run.id)).toEqual(["r100"])
    expect(outOfOrder.skipped).toBe(1)
  })

  it("keeps the good runs when one is bad, and drops a child of that run", () => {
    const checkout = experiment()
    const source = checkout.runs[0]
    if (source === undefined) throw new Error("a run")
    const bad = {
      ...copy(source),
      id: "r100",
      number: 100,
      verdict: "retired",
      parentId: checkout.baseline.id,
    }
    const child = { ...copy(source), id: "r101", number: 101, parentId: "r100" }
    const listed = listedRuns(
      checkout,
      result({
        experimentId: checkout.id,
        runs: [child, ...checkout.runs.map((run) => copy(run)), bad],
      }),
    )
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.runs.map((run) => run.id)).toEqual(checkout.runs.map((run) => run.id))
    expect(listed.skipped).toBe(2)
    expect(listed.runs.some((run) => run.id === "r100" || run.id === "r101")).toBe(false)
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
