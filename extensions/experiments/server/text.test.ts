import { describe, expect, it } from "vitest"

import { validateExperiment, type Experiment, type Problem } from "../model/index.ts"
import { checkoutSample, latencySample, scaleSample } from "../samples/index.ts"
import {
  downloadShown,
  experimentText,
  filesNamed,
  invalidText,
  openingText,
  problemsNamed,
  runText,
} from "./text.ts"

const startedAt = Date.UTC(2026, 0, 1)

function validated(input: unknown): Experiment {
  const validation = validateExperiment(input)
  if (validation.kind !== "valid") {
    throw new Error(JSON.stringify(validation.problems, null, 2))
  }
  return validation.experiment
}

describe("experimentText", () => {
  it("says what the experiment is, its best version, and each run, on its own", () => {
    expect(experimentText(validated(latencySample(startedAt)))).toBe(
      [
        "Bring search p95 down (experiment search-latency)",
        "Goal: Cut search's p95 latency while keeping answer accuracy at 97% or more.",
        "Metric: p95 latency, lower is better, on Replayed traffic; a change within 15 ms is noise.",
        "Baseline: 462 ms.",
        "Best: run 6 (l6), 322 ms on Replayed traffic, −140 ms on the baseline (better).",
        "Guardrail: Answer accuracy, at least 97.0%.",
        "Runs: 7; 3 kept, 3 rejected, 1 pending.",
        "",
        "Runs, newest first:",
        "- run 7 (l7): Measuring, not scored on Replayed traffic yet. Replaying traffic against the best so far.",
        "- run 6 (l6): Faster, 322 ms on Replayed traffic. p95 fell past the noise and accuracy held. This is the new best.",
        "- run 5 (l5): Slower, 392 ms on Replayed traffic. p95 rose past the noise. Reverted.",
        "- run 4 (l4): No faster, 365 ms on Replayed traffic. p95 moved within the noise. Reverted.",
        "- run 3 (l3): Faster, 371 ms on Replayed traffic. p95 fell past the noise and accuracy held. This is the new best.",
        "- run 2 (l2): Less accurate, 341 ms on Replayed traffic. p95 fell, but accuracy dropped below 97%. Reverted.",
        "- run 1 (l1): Faster, 418 ms on Replayed traffic. p95 fell past the noise and accuracy held. This is the new best.",
      ].join("\n"),
    )
  })

  it("says the reference, the budget, the areas and the agents when there are any", () => {
    const text = experimentText(validated(checkoutSample(startedAt)))
    expect(text).toContain("\nReference: Best model, max effort, 81.5%.\n")
    expect(text).toMatch(
      /\nRuns: 29 of a budget of 60; 7 kept, 18 rejected, 4 pending\.\n/,
    )
    expect(text).toContain(
      "\nAreas: System prompt, Tool descriptions, Policy retrieval, Model & effort, Harness.\nAgents: 6.\n",
    )
  })

  it("says while the baseline is being scored, and a limit relative to it is not measured yet", () => {
    const sample = checkoutSample(startedAt)
    const text = experimentText(
      validated({
        ...sample,
        notes: [],
        agents: [],
        baseline: { ...sample.baseline, scores: {}, measures: {} },
        runs: [],
        bestSoFar: [],
      }),
    )
    expect(text).toContain(
      "\nBaseline: being scored.\nBest: the baseline; no run has been kept yet.\n",
    )
    expect(text).toContain(
      "\nGuardrail: Cost per task, relative to the baseline, which is not measured yet.\n",
    )
    expect(text).not.toContain("Runs, newest first")
  })
})

describe("runText", () => {
  const scale = validated(scaleSample(startedAt))
  const run = scale.runs[0]!

  it("says the run in full, naming its first files and counting the rest", () => {
    const lines = runText(scale, run).split("\n")
    expect(lines.slice(0, 7)).toEqual([
      "Run 1 (planner) of Rewrite search's query planner (experiment search-latency-at-scale): Faster.",
      "Reason: p95 fell past the noise and accuracy held. This is the new best.",
      "Built on the baseline. Started 2026-01-01T00:05:00.000Z, settled 2026-01-01T01:35:00.000Z.",
      "Replayed traffic: 301 ms ± 2 ms, −161 ms on the baseline (better).",
      "Answer accuracy: 98.3%, +0.3% on the baseline (better).",
      "Requests: 1,000,000; 64,935 moved, 41,820 fixed and 23,115 broken.",
      expect.stringMatching(
        /^Change: Replaces the query planner across every index, adapter and test\. 10,000 files, [\d,]+ lines added and [\d,]+ removed:$/,
      ),
    ])
    const files = lines.slice(7)
    expect(files).toHaveLength(filesNamed + 1)
    expect(files.slice(0, filesNamed)).toEqual(
      run
        .change!.files.slice(0, filesNamed)
        .map(
          (file) => `- ${file.path} (${file.status}, +${file.added} −${file.removed})`,
        ),
    )
    expect(files.at(-1)).toBe("…and 9,980 more")
  })

  it("says what a run was built on, and how far its evaluation is", () => {
    const checkout = validated(checkoutSample(startedAt))
    const evaluating = checkout.runs.find((each) => each.progress !== undefined)!
    const text = runText(checkout, evaluating)
    const parent = checkout.runs.find((each) => each.id === evaluating.parentId)
    expect(text).toContain(
      `\nBuilt on ${parent === undefined ? "the baseline" : `run ${parent.number} (${parent.id})`}. Started `,
    )
    expect(text).toContain(
      `\nProgress: ${evaluating.progress!.done.toLocaleString("en-US")} of ${evaluating.progress!.total.toLocaleString("en-US")}.\n`,
    )
  })
})

describe("invalidText", () => {
  it("names the first problems and counts the rest", () => {
    const problems: Problem[] = Array.from({ length: problemsNamed + 3 }, (_, at) => ({
      rule: "run-ids-unique",
      path: ["runs", at, "id"],
      message: "is taken",
    }))
    const lines = invalidText("x", problems).split("\n")
    expect(lines[0]).toBe(`Experiment "x" can't be shown: it is not a valid experiment.`)
    expect(lines[1]).toBe("- run-ids-unique at runs.0.id: is taken")
    expect(lines).toHaveLength(problemsNamed + 2)
    expect(lines.at(-1)).toBe("…and 3 more")
  })
})

describe("openingText", () => {
  it("shows a download's first characters and counts the rest", () => {
    const text = "a".repeat(downloadShown + 5)
    expect(
      openingText(
        { experimentId: "x", runId: "r1", path: "a.txt" },
        { kind: "download", name: "a.txt", mimeType: "text/plain", text },
      ),
    ).toBe(
      `Ready to download a.txt in run r1 as a.txt (text/plain):\n\n${"a".repeat(downloadShown)}\n…and 5 more characters`,
    )
  })
})
