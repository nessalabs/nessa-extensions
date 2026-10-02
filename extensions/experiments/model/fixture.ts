/**
 * Test support: the smallest experiment that has one of everything, valid, as
 * a fresh plain object each call so a test can break one thing in it.
 *
 * - The definition: metric `score` (up, 1 decimal), splits `a` and `b` (`b`
 *   primary), guardrail `g` (at most 1.5 times the baseline's), verdicts
 *   `keep` (kept), `drop` (rejected) and `wait` (pending), noise 0.5.
 * - The baseline `base`; area `x`; agent `ag` evaluating `r3`.
 * - `r1` kept (from the baseline), `r2` dropped (from `r1`), `r3` waiting
 *   (from `r1`) with progress. `bestSoFar` is `["r1"]`.
 */
import type { ExperimentInput } from "./experiment.ts"

/** When the fixture's experiment starts. */
export const start = 1_000_000

/** `T` with every field writable, at every level. */
export type Writable<T> = T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T

/** The fixture's type, with every field writable, for a test to break. */
export type Fixture = Writable<ExperimentInput>

/** A fresh copy of the fixture. */
export function fixture(): Fixture {
  return {
    id: "exp",
    title: "Fixture",
    goal: "Hold every rule.",
    sessionId: "session-1",
    startedAt: start,
    notes: [{ tone: "good", text: "r1 is the best.", at: start + 30, runId: "r1" }],
    definition: {
      metric: {
        id: "score",
        name: "Score",
        unit: "%",
        deltaUnit: " pts",
        better: "up",
        decimals: 1,
      },
      splits: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      primarySplit: "b",
      guardrails: [
        {
          id: "g",
          metric: { id: "cost", name: "Cost", unit: "¢", better: "down", decimals: 2 },
          limit: { bound: "at-most", value: 1.5, relativeTo: "baseline" },
        },
      ],
      verdicts: [
        { id: "keep", label: "Kept", tone: "good", outcome: "kept" },
        { id: "drop", label: "Dropped", tone: "bad", outcome: "rejected" },
        { id: "wait", label: "Waiting", tone: "active", outcome: "pending" },
      ],
      noise: 0.5,
      reference: { value: 90, label: "Ceiling" },
      budget: { runs: 10 },
      caseNoun: { one: "case", other: "cases" },
    },
    areas: [{ id: "x", name: "Area X", glyph: "M1 1h14v14H1z", hue: 1 }],
    agents: [
      {
        id: "ag",
        name: "Agent",
        since: start,
        brief: "Try things.",
        areaId: "x",
        model: "a-model",
        activity: { kind: "evaluating", runId: "r3" },
      },
    ],
    baseline: {
      id: "base",
      scores: { a: { mean: 50 }, b: { mean: 50, interval: 1 } },
      measures: { g: 10 },
    },
    runs: [
      {
        id: "r1",
        number: 1,
        startedAt: start + 10,
        settledAt: start + 20,
        parentId: "base",
        scores: { a: { mean: 55 }, b: { mean: 54, interval: 1 } },
        measures: { g: 11 },
        verdict: "keep",
        reason: "Better.",
        areaId: "x",
        agentId: "ag",
        cases: {
          total: 100,
          fixed: 3,
          broken: 1,
          slices: [
            { name: "s1", total: 60, passingBefore: 30, passingAfter: 32 },
            { name: "s2", total: 40, passingBefore: 20, passingAfter: 20 },
          ],
          moved: [
            { id: "c1", title: "Case 1", slice: "s1", move: "fixed" },
            { id: "c2", title: "Case 2", slice: "s2", move: "broken" },
          ],
        },
        change: {
          summary: "Changes two files.",
          files: [
            { path: "a.ts", status: "modified", added: 3, removed: 1 },
            { path: "b.ts", status: "added", added: 10, removed: 0 },
          ],
        },
      },
      {
        id: "r2",
        number: 2,
        startedAt: start + 15,
        settledAt: start + 40,
        parentId: "r1",
        scores: { b: { mean: 53 } },
        measures: {},
        verdict: "drop",
        reason: "Worse.",
      },
      {
        id: "r3",
        number: 3,
        startedAt: start + 50,
        progress: { done: 5, total: 10 },
        parentId: "r1",
        scores: {},
        measures: {},
        verdict: "wait",
        reason: "Evaluating.",
        agentId: "ag",
      },
    ],
    bestSoFar: ["r1"],
  }
}
