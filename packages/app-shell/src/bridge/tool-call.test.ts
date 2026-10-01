/**
 * One test per row of the README's table "The tool call": every phase, every
 * event.
 */
import { describe, expect, it } from "vitest"

import { nextToolCall, type ToolCall, type ToolEvent } from "./tool-call.ts"

const a = { city: "Oslo" }
const b = { city: "Lima" }
const result = { content: [{ type: "text" as const, text: "ok" }] }
const other = { content: [{ type: "text" as const, text: "other" }] }

const phases: Record<ToolCall["phase"], ToolCall> = {
  "awaiting-input": { phase: "awaiting-input" },
  "streaming-input": { phase: "streaming-input", partial: { city: "Os" } },
  running: { phase: "running", input: a },
  complete: { phase: "complete", input: a, result },
  cancelled: { phase: "cancelled", input: a, reason: "stopped" },
}

const events: Record<ToolEvent["type"], ToolEvent> = {
  "input-partial": { type: "input-partial", arguments: { city: "Li" } },
  input: { type: "input", arguments: b },
  result: { type: "result", result: other },
  cancelled: { type: "cancelled", reason: "the person stopped it" },
}

/** The table: for each phase and event, the next call and whether the order broke the standard. */
const table: [ToolCall["phase"], ToolEvent["type"], ToolCall | "unchanged", boolean][] = [
  [
    "awaiting-input",
    "input-partial",
    { phase: "streaming-input", partial: { city: "Li" } },
    false,
  ],
  ["awaiting-input", "input", { phase: "running", input: b }, false],
  ["awaiting-input", "result", { phase: "complete", result: other }, true],
  [
    "awaiting-input",
    "cancelled",
    { phase: "cancelled", reason: "the person stopped it" },
    false,
  ],
  [
    "streaming-input",
    "input-partial",
    { phase: "streaming-input", partial: { city: "Li" } },
    false,
  ],
  ["streaming-input", "input", { phase: "running", input: b }, false],
  ["streaming-input", "result", { phase: "complete", result: other }, true],
  [
    "streaming-input",
    "cancelled",
    { phase: "cancelled", reason: "the person stopped it" },
    false,
  ],
  ["running", "input-partial", "unchanged", true],
  ["running", "input", "unchanged", true],
  ["running", "result", { phase: "complete", input: a, result: other }, false],
  [
    "running",
    "cancelled",
    { phase: "cancelled", input: a, reason: "the person stopped it" },
    false,
  ],
  [
    "complete",
    "input-partial",
    { phase: "streaming-input", partial: { city: "Li" } },
    false,
  ],
  ["complete", "input", { phase: "running", input: b }, false],
  ["complete", "result", "unchanged", true],
  ["complete", "cancelled", "unchanged", true],
  [
    "cancelled",
    "input-partial",
    { phase: "streaming-input", partial: { city: "Li" } },
    false,
  ],
  ["cancelled", "input", { phase: "running", input: b }, false],
  ["cancelled", "result", "unchanged", true],
  ["cancelled", "cancelled", "unchanged", true],
]

describe("nextToolCall", () => {
  it("has a row for every phase and event", () => {
    const rows = new Set(table.map(([phase, event]) => `${phase} ${event}`))
    for (const phase of Object.keys(phases)) {
      for (const event of Object.keys(events))
        expect(rows.has(`${phase} ${event}`)).toBe(true)
    }
    expect(rows.size).toBe(table.length)
  })

  for (const [phase, event, expected, outOfOrder] of table) {
    it(`${phase} + ${event} → ${expected === "unchanged" ? "unchanged" : expected.phase}${outOfOrder ? ", reported" : ""}`, () => {
      const from = phases[phase]
      const next = nextToolCall(from, events[event])
      if (expected === "unchanged") expect(next.call).toBe(from)
      else expect(next.call).toEqual(expected)
      expect(next.outOfOrder).toBe(outOfOrder)
    })
  }

  it("cancels without a reason when the host gives none", () => {
    expect(nextToolCall(phases.running, { type: "cancelled" }).call).toEqual({
      phase: "cancelled",
      input: a,
    })
  })
})
