import { describe, expect, it, vi } from "vitest"
import type { CallToolResult } from "@nessalabs/app-shell"
import { callPaged } from "./paged-call.ts"

const revision = "a".repeat(64)
const first = { revision, offset: 0, total: 4, json: "ab", next: { revision, offset: 2 } }
function result(page: unknown): CallToolResult {
  return { content: [], structuredContent: { page } }
}

describe("continuation validation", () => {
  it("rejects a continuation after a complete valid outcome", async () => {
    const json = JSON.stringify({ text: "valid" })
    const callTool = vi.fn(async () =>
      result({
        revision,
        offset: 0,
        total: json.length,
        json,
        next: { revision, offset: json.length },
      }),
    )
    await expect(callPaged({ callTool }, "get_experiment", {})).rejects.toThrow(
      "final page",
    )
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it.each(["revision", "total", "offset"])(
    "rejects a changed %s even when the assembled JSON is valid",
    async (field) => {
      const json = JSON.stringify({ text: "valid" })
      const firstPage = {
        revision,
        offset: 0,
        total: json.length,
        json: json.slice(0, 5),
        next: { revision, offset: 5 },
      }
      const lastPage = {
        revision,
        offset: 5,
        total: json.length,
        json: json.slice(5),
        [field]:
          field === "revision" ? "b".repeat(64) : field === "total" ? json.length + 1 : 6,
      }
      const callTool = vi
        .fn()
        .mockResolvedValueOnce(result(firstPage))
        .mockResolvedValueOnce(result(lastPage))
      await expect(callPaged({ callTool }, "get_experiment", {})).rejects.toThrow(
        "does not belong",
      )
    },
  )

  it("refuses a missing later page and a malformed assembled outcome", async () => {
    const missing = vi
      .fn()
      .mockResolvedValueOnce(result(first))
      .mockResolvedValueOnce({ content: [] })
    await expect(callPaged({ callTool: missing }, "get_experiment", {})).rejects.toThrow(
      "no page",
    )
    const malformed = { revision, offset: 0, total: 2, json: "{}" }
    await expect(
      callPaged({ callTool: async () => result(malformed) }, "get_experiment", {}),
    ).rejects.toThrow()
  })

  it("assembles valid pages and preserves the original arguments", async () => {
    const json = JSON.stringify({ text: "loaded", data: { value: "a\ud800b" } })
    const half = Math.floor(json.length / 2)
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(
        result({
          revision,
          offset: 0,
          total: json.length,
          json: json.slice(0, half),
          next: { revision, offset: half },
        }),
      )
      .mockResolvedValueOnce(
        result({ revision, offset: half, total: json.length, json: json.slice(half) }),
      )
    expect(
      await callPaged({ callTool }, "get_run", { experimentId: "a/b", runId: "run" }),
    ).toEqual({
      content: [{ type: "text", text: "loaded" }],
      structuredContent: { value: "a\ud800b" },
    })
    expect(callTool.mock.calls[1]).toEqual([
      "get_run",
      { experimentId: "a/b", runId: "run", continuation: { revision, offset: half } },
    ])
  })

  it.each([
    { ...first, offset: 1 },
    { ...first, total: 1 },
    { ...first, next: undefined },
    { ...first, next: { revision, offset: 0 } },
    { ...first, next: { revision, offset: 3 } },
    { ...first, next: { revision: "b".repeat(64), offset: 2 } },
    { ...first, json: "" },
    { ...first, total: 0 },
  ])("refuses malformed or nonadvancing pages before the next call", async (page) => {
    const callTool = vi.fn(async () => result(page))
    await expect(callPaged({ callTool }, "get_experiment", {})).rejects.toThrow()
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...first, offset: 2, json: "cd", next: undefined, revision: "b".repeat(64) },
    { ...first, offset: 2, json: "cd", next: undefined, total: 5 },
    { ...first, offset: 2, json: "cd" },
    { ...first, offset: 2, json: "cd", next: undefined }, // invalid assembled JSON
  ])("does not accept contradictory or invalid final pages", async (page) => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(result(first))
      .mockResolvedValueOnce(result(page))
    await expect(callPaged({ callTool }, "get_experiment", {})).rejects.toThrow()
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("stops between pages when the view has moved on", async () => {
    const callTool = vi.fn(async () => result(first))
    await expect(
      callPaged({ callTool }, "get_experiment", {}, () => false),
    ).rejects.toThrow("stopped reading")
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("shows a server refusal from a later page instead of a partial experiment", async () => {
    const refusal = {
      content: [{ type: "text", text: "The source changed." }],
      isError: true,
    }
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(result(first))
      .mockResolvedValueOnce(refusal)
    expect(await callPaged({ callTool }, "get_experiment", {})).toBe(refusal)
  })
})
