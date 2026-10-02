/**
 * The scale sample: one run that moves cases out of a million and touches ten
 * thousand files, on the latency definition, so the views are seen at the
 * size real evaluations reach (nessa-agent ADR 333, "Scale").
 */
import type { ExperimentInput } from "../model/index.ts"
import { casesFor, changeFor, minutes, slicesOf, type SliceKind } from "./generate.ts"
import { latencySample } from "./latency.ts"

export const scaleExperimentId = "search-latency-at-scale"

/** How many cases and files the scale sample's run has. */
export const scaleCases = 1_000_000
export const scaleFiles = 10_000

const slices: readonly SliceKind[] = [
  {
    name: "Navigational",
    share: 0.31,
    titles: ["Brand name, one result", "Exact page title"],
  },
  {
    name: "Informational",
    share: 0.27,
    titles: ["How-to question", "Definition lookup"],
  },
  {
    name: "Transactional",
    share: 0.18,
    titles: ["Product with a size", "Price comparison"],
  },
  { name: "Local", share: 0.12, titles: ["Opening hours", "Nearest store"] },
  { name: "Long tail", share: 0.12, titles: ["Seven-word query", "Misspelt rare term"] },
]

/** The scale sample, begun at `startedAt`. */
export function scaleSample(startedAt: number): ExperimentInput {
  const { definition, baseline } = latencySample(startedAt)
  return {
    id: scaleExperimentId,
    title: "Rewrite search's query planner",
    goal: "Cut search's p95 latency with a new query planner, measured on a million replayed requests.",
    sessionId: "session-latency",
    startedAt,
    notes: [],
    definition,
    areas: [],
    agents: [],
    baseline,
    runs: [
      {
        id: "planner",
        number: 1,
        startedAt: startedAt + minutes(5),
        settledAt: startedAt + minutes(95),
        parentId: baseline.id,
        scores: { replay: { mean: 301, interval: 2 } },
        measures: { accuracy: 98.3 },
        verdict: "faster",
        reason: "p95 fell past the noise and accuracy held. This is the new best.",
        cases: casesFor(
          "planner",
          slices,
          { total: scaleCases, fixed: 41_820, broken: 23_115 },
          slicesOf("baseline", slices, scaleCases, 900_000),
        ).cases,
        change: changeFor(
          "planner",
          "Replaces the query planner across every index, adapter and test.",
          ["search/planner", "search/index", "search/adapters", "search/tests"],
          "go",
          scaleFiles,
        ),
      },
    ],
    bestSoFar: ["planner"],
  }
}
