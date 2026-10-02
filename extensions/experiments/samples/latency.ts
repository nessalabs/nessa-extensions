/**
 * A second kind of experiment, there to test the definition: p95 latency in
 * milliseconds, lower is better, on one split, with an accuracy guardrail at
 * least a fixed value, and no areas, no agents, no reference and no budget.
 * If a view needs a change to show it, the definition is missing something
 * (nessa-agent ADR 333, "Samples").
 */
import type { ExperimentInput } from "../model/index.ts"
import { changeFor, minutes } from "./generate.ts"

export const latencyExperimentId = "search-latency"

const definition = {
  metric: { id: "p95", name: "p95 latency", unit: " ms", better: "down", decimals: 0 },
  splits: [{ id: "replay", label: "Replayed traffic" }],
  primarySplit: "replay",
  guardrails: [
    {
      id: "accuracy",
      metric: {
        id: "accuracy",
        name: "Answer accuracy",
        unit: "%",
        better: "up",
        decimals: 1,
      },
      limit: { bound: "at-least", value: 97 },
    },
  ],
  verdicts: [
    { id: "faster", label: "Faster", tone: "good", outcome: "kept" },
    { id: "slower", label: "Slower", tone: "bad", outcome: "rejected" },
    { id: "same", label: "No faster", tone: "neutral", outcome: "rejected" },
    { id: "inaccurate", label: "Less accurate", tone: "warning", outcome: "rejected" },
    { id: "measuring", label: "Measuring", tone: "active", outcome: "pending" },
  ],
  noise: 15,
  caseNoun: { one: "request", other: "requests" },
} as const satisfies ExperimentInput["definition"]

/** A run: its summary, its parent's number (0 for the baseline), p95, accuracy and verdict. */
type Planned = readonly [
  summary: string,
  parent: number,
  p95: number,
  accuracy: number,
  verdict: "faster" | "slower" | "same" | "inaccurate",
]

const history: readonly Planned[] = [
  ["Caches the ranking model's embeddings.", 0, 418, 98.1, "faster"],
  ["Shrinks the candidate set from 1,000 to 200.", 1, 341, 96.2, "inaccurate"],
  ["Batches index reads per request.", 1, 371, 98.0, "faster"],
  ["Moves spell-correction after retrieval.", 3, 365, 98.0, "same"],
  ["Compresses the posting lists.", 3, 392, 98.2, "slower"],
  ["Shrinks the candidate set from 1,000 to 500.", 3, 322, 97.6, "faster"],
]

const reasons = {
  faster: "p95 fell past the noise and accuracy held. This is the new best.",
  slower: "p95 rose past the noise. Reverted.",
  same: "p95 moved within the noise. Reverted.",
  inaccurate: "p95 fell, but accuracy dropped below 97%. Reverted.",
} as const

/** The search-latency experiment, begun at `startedAt`. */
export function latencySample(startedAt: number): ExperimentInput {
  const at = (after: number) => startedAt + minutes(after)
  const runs: ExperimentInput["runs"][number][] = history.map(
    ([summary, parent, p95, accuracy, verdict], index) => {
      const number = index + 1
      return {
        id: `l${number}`,
        number,
        startedAt: at(number * 20),
        settledAt: at(number * 20 + 12),
        parentId: parent === 0 ? "baseline" : `l${parent}`,
        scores: { replay: { mean: p95, interval: 6 } },
        measures: { accuracy },
        verdict,
        reason: reasons[verdict],
        change: changeFor(
          `l${number}`,
          summary,
          ["search/src", "search/config"],
          "go",
          2,
        ),
      }
    },
  )
  runs.push({
    id: "l7",
    number: 7,
    startedAt: at(150),
    progress: { done: 18_200, total: 50_000 },
    parentId: "l6",
    scores: {},
    measures: {},
    verdict: "measuring",
    reason: "Replaying traffic against the best so far.",
  })
  return {
    id: latencyExperimentId,
    title: "Bring search p95 down",
    goal: "Cut search's p95 latency while keeping answer accuracy at 97% or more.",
    sessionId: "session-latency",
    startedAt,
    notes: [],
    definition,
    areas: [],
    agents: [],
    baseline: {
      id: "baseline",
      scores: { replay: { mean: 462, interval: 7 } },
      measures: { accuracy: 98.0 },
    },
    runs,
    bestSoFar: ["l1", "l3", "l6"],
  }
}
