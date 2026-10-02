/**
 * The checkout-support hill-climb: six agents in five areas improving a
 * support agent's resolution rate, in percent, higher is better, on a train
 * and a test split, with a cost guardrail relative to the baseline. Each run
 * is written as a change against the best version when it was made, and its
 * scores derived from that, so lineage and numbers agree. Dated from
 * `startedAt`.
 */
import type { ExperimentInput } from "../model/index.ts"
import { casesFor, changeFor, minutes, type SliceKind } from "./generate.ts"

type RunInput = ExperimentInput["runs"][number]

export const checkoutExperimentId = "checkout-hillclimb"

const areas = [
  {
    id: "prompt",
    name: "System prompt",
    glyph: "M3 4.5h10M3 8h10M3 11.5h6",
    hue: 1,
    folders: ["prompts/system", "prompts/snippets"],
    extension: "md",
  },
  {
    id: "tools",
    name: "Tool descriptions",
    glyph:
      "M10.6 2.6a3 3 0 0 0-2.8 4L3.2 11.2a1.1 1.1 0 0 0 1.6 1.6l4.6-4.6a3 3 0 0 0 4-2.8l-1.7 1.7-1.7-.5-.5-1.7z",
    hue: 2,
    folders: ["tools/schemas", "tools/descriptions"],
    extension: "json",
  },
  {
    id: "retrieval",
    name: "Policy retrieval",
    glyph: "M3.1 7a3.9 3.9 0 1 0 7.8 0a3.9 3.9 0 1 0-7.8 0M10 10l3.3 3.3",
    hue: 3,
    folders: ["retrieval/src", "retrieval/index", "retrieval/tests"],
    extension: "ts",
  },
  {
    id: "model",
    name: "Model & effort",
    glyph:
      "M6.1 4.5h3.8a1.6 1.6 0 0 1 1.6 1.6v3.8a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6V6.1a1.6 1.6 0 0 1 1.6-1.6zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
    hue: 4,
    folders: ["config/models", "config/routing"],
    extension: "yaml",
  },
  {
    id: "harness",
    name: "Harness",
    glyph:
      "M12.6 7A4.7 4.7 0 0 0 4.2 4.6M4.2 2.4v2.4h2.4M3.4 9a4.7 4.7 0 0 0 8.4 2.4m0 2.2v-2.2H9.4",
    hue: 5,
    folders: [
      "harness/src/turn",
      "harness/src/tools",
      "harness/src/errors",
      "harness/tests",
    ],
    extension: "ts",
  },
] as const

type AreaId = (typeof areas)[number]["id"]

const areasById = Object.fromEntries(areas.map((area) => [area.id, area])) as Record<
  AreaId,
  (typeof areas)[number]
>

const agents = [
  { id: "wren", name: "Wren", areaId: "prompt", model: "claude-opus-5-5" },
  { id: "tamsin", name: "Tamsin", areaId: "prompt", model: "claude-opus-5-5" },
  { id: "juno", name: "Juno", areaId: "tools", model: "claude-sonnet-5-5" },
  { id: "orla", name: "Orla", areaId: "retrieval", model: "claude-sonnet-5-5" },
  { id: "pike", name: "Pike", areaId: "model", model: "claude-opus-5-5" },
  { id: "sable", name: "Sable", areaId: "harness", model: "claude-sonnet-5-5" },
] as const

type AgentId = (typeof agents)[number]["id"]

const slices: readonly SliceKind[] = [
  {
    name: "Refunds",
    share: 0.24,
    titles: ["Refund for a damaged item", "Refund outside the 30-day window"],
  },
  {
    name: "Where is my order",
    share: 0.18,
    titles: ["Order shows delivered but never arrived", "Tracking stuck for a week"],
  },
  { name: "Partial refunds", share: 0.12, titles: ["Refund one item of three"] },
  { name: "Escalations", share: 0.1, titles: ["Refund over $200 without a manager"] },
  { name: "Cancellations", share: 0.1, titles: ["Cancel after dispatch"] },
  { name: "Address changes", share: 0.09, titles: ["Change address after dispatch"] },
  { name: "Promo codes", share: 0.09, titles: ["Code rejected at checkout"] },
  { name: "Account & login", share: 0.08, titles: ["Order placed as a guest"] },
]

type Settled = "kept" | "overfit" | "regressed" | "flat" | "costly"

/** A settled run: its area, agent, summary, train and test gains, verdict, start, and cost change. */
type Planned = readonly [
  area: AreaId,
  agent: AgentId,
  summary: string,
  train: number,
  test: number,
  verdict: Settled,
  startedAfter: number,
  costChange?: number,
]

/** In the order they were made; gains against the best when each was made. */
const history: readonly Planned[] = [
  ["prompt", "wren", "States the 30-day refund window up front.", 1.4, 0.9, "flat", 8],
  [
    "tools",
    "juno",
    "Renames search_orders to find_orders_by_customer.",
    0.6,
    -0.3,
    "flat",
    14,
  ],
  [
    "prompt",
    "tamsin",
    "Adds an escalation checklist for refunds over $200.",
    3.6,
    3.1,
    "kept",
    19,
  ],
  [
    "retrieval",
    "orla",
    "Splits policy docs into titled 300-token chunks.",
    1.1,
    0.4,
    "flat",
    25,
  ],
  ["model", "pike", "Runs the agent at high effort.", 2.4, 2.0, "costly", 30, 0.64],
  ["harness", "sable", "Retries lookup_order once on timeout.", 0.8, 0.5, "flat", 36],
  ["tools", "juno", "Says when lookup_order beats search_orders.", 2.9, 2.3, "kept", 41],
  [
    "prompt",
    "wren",
    "Adds two refund conversations as examples.",
    3.8,
    -0.6,
    "overfit",
    47,
  ],
  [
    "retrieval",
    "orla",
    "Reranks policy chunks by section title.",
    -1.2,
    -1.9,
    "regressed",
    52,
  ],
  ["harness", "sable", "Runs order lookups in parallel.", 2.2, 1.9, "kept", 58],
  [
    "model",
    "pike",
    "Runs the agent at medium effort.",
    -3.4,
    -4.1,
    "regressed",
    63,
    -0.38,
  ],
  [
    "prompt",
    "tamsin",
    "Asks for the order number before anything else.",
    0.4,
    0.2,
    "flat",
    69,
  ],
  [
    "tools",
    "juno",
    "Documents issue_refund's partial-amount field.",
    1.9,
    1.6,
    "kept",
    74,
  ],
  [
    "retrieval",
    "orla",
    "Includes each policy's effective date in its chunk.",
    0.3,
    -0.2,
    "flat",
    80,
  ],
  ["prompt", "wren", "Quotes policy text verbatim.", 2.6, 0.1, "overfit", 85],
  [
    "harness",
    "sable",
    "Surfaces tool errors to the model as text.",
    0.9,
    0.6,
    "flat",
    91,
  ],
  ["model", "pike", "Runs escalations only at high effort.", 1.1, 0.7, "flat", 96, 0.22],
  [
    "prompt",
    "tamsin",
    "Confirms the resolution back to the customer.",
    1.8,
    1.4,
    "kept",
    102,
  ],
  [
    "tools",
    "juno",
    "Merges get_shipment into lookup_order.",
    -0.8,
    -1.4,
    "regressed",
    107,
  ],
  [
    "retrieval",
    "orla",
    "Retrieves policy by intent, not by keywords.",
    1.5,
    1.2,
    "kept",
    113,
  ],
  ["harness", "sable", "Caps tool calls per turn at 12.", -0.2, 0.1, "flat", 118, -0.05],
  [
    "model",
    "pike",
    "Routes status checks to a smaller model.",
    -0.4,
    -0.6,
    "flat",
    124,
    -0.31,
  ],
  [
    "prompt",
    "tamsin",
    "Handles 'where is my order' before refunds.",
    2.3,
    1.8,
    "kept",
    146,
  ],
  [
    "harness",
    "sable",
    "Streams tool results into the context.",
    -0.9,
    -2.0,
    "regressed",
    151,
  ],
  [
    "prompt",
    "wren",
    "Orders rules: safety, policy, then tone.",
    1.9,
    0.4,
    "overfit",
    173,
  ],
]

/** Being evaluated now: area, agent, summary, start, and cases done. */
const live: readonly (readonly [AreaId, AgentId, string, number, number])[] = [
  ["prompt", "tamsin", "Asks one clarifying question when intent is unclear.", 181, 3920],
  ["tools", "juno", "Describes error codes in lookup_order's schema.", 183, 6160],
  ["harness", "sable", "Validates refund amounts before calling the tool.", 184, 7000],
]

/** Written, waiting for an evaluator. */
const queued: readonly (readonly [AreaId, AgentId, string])[] = [
  ["retrieval", "orla", "Searches by keywords and embeddings together."],
]

const verdicts = [
  { id: "kept", label: "Kept", tone: "good", outcome: "kept" },
  { id: "overfit", label: "Overfit", tone: "warning", outcome: "rejected" },
  { id: "regressed", label: "Regressed", tone: "bad", outcome: "rejected" },
  { id: "flat", label: "Within noise", tone: "neutral", outcome: "rejected" },
  { id: "costly", label: "Too costly", tone: "warning", outcome: "rejected" },
  { id: "evaluating", label: "Evaluating", tone: "active", outcome: "pending" },
  { id: "queued", label: "Queued", tone: "neutral", outcome: "pending" },
] as const

const reasons: Record<Settled, string> = {
  kept: "Train and test both rose clear of the noise. This is the new best.",
  overfit:
    "Train rose but test did not: it learned the train cases, not the task. Reverted.",
  regressed: "Test fell past the noise. Reverted.",
  flat: "Test moved within the noise: no detectable change. Reverted.",
  costly: "Test rose, but cost per task went past the limit. Reverted.",
}

const testCases = 2400
const round = (value: number, decimals: number) => Number(value.toFixed(decimals))

/** The checkout-support hill-climb, begun at `startedAt`. */
export function checkoutSample(startedAt: number): ExperimentInput {
  const at = (after: number) => startedAt + minutes(after)
  const areaOf = (areaId: AreaId) => areasById[areaId]
  const fileCount = (number: number, areaId: AreaId) =>
    number === 16 ? 214 : areaId === "harness" ? 3 + (number % 12) : 1 + (number % 3)

  const baseline = {
    id: "baseline",
    scores: { train: { mean: 57.9, interval: 2.4 }, test: { mean: 58.3, interval: 1.9 } },
    measures: { cost: 5.2 },
  }
  let best: { id: string; train: number; test: number; cost: number } = {
    id: baseline.id,
    train: 57.9,
    test: 58.3,
    cost: 5.2,
  }
  const runs: RunInput[] = []
  const kept: { id: string; settledAt: number }[] = []
  history.forEach(
    (
      [areaId, agentId, summary, train, test, verdict, startedAfter, costChange],
      index,
    ) => {
      const number = index + 1
      const id = `r${number}`
      const parent = best
      const area = areaOf(areaId)
      const trainMean = round(parent.train + train, 1)
      const testMean = round(parent.test + test, 1)
      const cost = round(
        parent.cost * (1 + (costChange ?? (number % 5) * 0.01 - 0.02)),
        2,
      )
      // Run 20's keep was decided after reruns, so it settled late: after
      // runs made after it, and before the next keep.
      const settledAt = at(startedAfter + 4 + (number % 5) + (number === 20 ? 24 : 0))
      const net = Math.round((test / 100) * testCases)
      const churn = 12 + (number % 7) * 3
      runs.push({
        id,
        number,
        startedAt: at(startedAfter),
        settledAt,
        parentId: parent.id,
        scores: {
          train: { mean: trainMean, interval: 2.1 + (number % 4) * 0.1 },
          test: { mean: testMean, interval: round(1.7 + (number % 3) * 0.1, 1) },
        },
        measures: { cost },
        verdict,
        reason: reasons[verdict],
        areaId,
        agentId,
        cases: casesFor(id, slices, {
          total: testCases,
          fixed: Math.max(net, 0) + churn,
          broken: Math.max(-net, 0) + churn,
          passing: Math.round((parent.test / 100) * testCases),
        }),
        change: changeFor(
          id,
          summary,
          area.folders,
          area.extension,
          fileCount(number, areaId),
        ),
      })
      if (verdict === "kept") {
        best = { id, train: trainMean, test: testMean, cost }
        kept.push({ id, settledAt })
      }
    },
  )
  let number = runs.length
  for (const [areaId, agentId, summary, startedAfter, done] of live) {
    number += 1
    const area = areaOf(areaId)
    runs.push({
      id: `r${number}`,
      number,
      startedAt: at(startedAfter),
      progress: { done, total: 8400 },
      parentId: best.id,
      scores: {},
      measures: {},
      verdict: "evaluating",
      reason: "Being evaluated against the best so far.",
      areaId,
      agentId,
      change: changeFor(`r${number}`, summary, area.folders, area.extension, 2),
    })
  }
  for (const [areaId, agentId, summary] of queued) {
    number += 1
    const area = areaOf(areaId)
    runs.push({
      id: `r${number}`,
      number,
      startedAt: at(186),
      parentId: best.id,
      scores: {},
      measures: {},
      verdict: "queued",
      reason: "Written and waiting for a free evaluator.",
      areaId,
      agentId,
      change: changeFor(`r${number}`, summary, area.folders, area.extension, 1),
    })
  }
  const evaluating = (agentId: AgentId) =>
    runs.find((run) => run.agentId === agentId && run.verdict === "evaluating")

  return {
    id: checkoutExperimentId,
    title: "Hill-climb checkout support",
    goal: "Raise the checkout support agent's resolution rate without raising its cost per task by more than 10%.",
    sessionId: "session-checkout",
    startedAt,
    notes: [
      {
        tone: "good",
        text: "An escalation checklist is the first keep.",
        at: at(26),
        runId: "r3",
      },
      {
        tone: "warning",
        text: "Three prompt changes in a row overfit; the prompt area is trying examples instead of rules.",
        at: at(180),
      },
      {
        tone: "neutral",
        text: "Run 20's keep held after two reruns.",
        at: at(141),
        runId: "r20",
      },
    ],
    definition: {
      metric: {
        id: "resolution",
        name: "Resolution rate",
        unit: "%",
        deltaUnit: " pts",
        better: "up",
        decimals: 1,
      },
      splits: [
        { id: "train", label: "Train" },
        { id: "test", label: "Test" },
      ],
      primarySplit: "test",
      guardrails: [
        {
          id: "cost",
          metric: {
            id: "cost",
            name: "Cost per task",
            unit: "¢",
            better: "down",
            decimals: 2,
          },
          limit: { bound: "at-most", value: 1.1, relativeTo: "baseline" },
        },
      ],
      verdicts: [...verdicts],
      noise: 1,
      reference: { value: 81.5, label: "Best model, max effort" },
      budget: { runs: 60 },
      caseNoun: { one: "test case", other: "test cases" },
    },
    areas: areas.map(({ id, name, glyph, hue }) => ({ id, name, glyph, hue })),
    agents: agents.map(({ id, name, areaId, model }) => {
      const run = evaluating(id)
      return {
        id,
        name,
        since: run === undefined ? at(175) : run.startedAt,
        brief: `Improve the ${areaOf(areaId).name.toLowerCase()} of the checkout support agent, one change at a time, from the best version so far.`,
        areaId,
        model,
        activity:
          run !== undefined
            ? { kind: "evaluating", runId: run.id }
            : id === "pike"
              ? { kind: "resting", note: "Out of ideas for model and effort." }
              : { kind: "drafting", note: "Writing the next change." },
      }
    }),
    baseline,
    runs,
    bestSoFar: kept.sort((a, b) => a.settledAt - b.settledAt).map((each) => each.id),
  }
}
