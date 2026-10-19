import { describe, expect, it } from "vitest"
import { overHttp, overStdio, apps } from "@nessalabs/server-kit/testing"
import type { CallToolResult } from "@nessalabs/app-shell"

import { callPaged } from "../app/paged-call.ts"
import { checkoutSample, scaleSample } from "../samples/index.ts"
import { experimentsExtension } from "./extension.ts"
import { pageResult } from "./paging.ts"
import { placeholderHtml } from "./view.ts"

/** Mirrors app_calls.rs: Value::to_string(), then serde_json::to_string(&text). */
function carriedBytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify(JSON.stringify(result)))
}
const hostLimit = 57_344
const startedAt = Date.UTC(2026, 9, 1)

function wire(outcome: ReturnType<typeof pageResult>): CallToolResult {
  return {
    content: [{ type: "text", text: outcome.text }],
    structuredContent: outcome.data as Record<string, unknown>,
  }
}

describe("bounded continuation results", () => {
  it.each(["a", '"', "\\", "\n", "\u0000", "\ud800", "界", "😀"])(
    "bounds every page of escaped %j",
    async (character) => {
      const outcome = {
        text: character.repeat(24_000),
        data: { value: character.repeat(24_000) },
      }
      let calls = 0
      const result = await callPaged(
        {
          callTool: async (_name, args) => {
            const result = wire(
              pageResult(
                outcome,
                args?.continuation as { revision: string; offset: number } | undefined,
              ),
            )
            expect(carriedBytes(result)).toBeLessThanOrEqual(hostLimit)
            calls++
            return result
          },
        },
        "get_experiment",
        {},
      )
      expect(calls).toBeGreaterThan(1)
      expect(result).toEqual(wire(outcome))
    },
  )

  it("rejects a changed source and an offset outside the result", () => {
    const original = { text: "a".repeat(20_000) }
    const page = pageResult(original).data as {
      page: { next: { revision: string; offset: number } }
    }
    expect(() => pageResult({ text: "b".repeat(20_000) }, page.page.next)).toThrow(
      "source changed",
    )
    expect(() => pageResult(original, { ...page.page.next, offset: 30_000 })).toThrow(
      "outside",
    )
  })

  it.each([overStdio, overHttp])(
    "reads an experiment over ten times checkout through the real transport",
    async (connect) => {
      const sample = scaleSample(startedAt)
      expect(Buffer.byteLength(JSON.stringify(sample))).toBeGreaterThan(
        10 * Buffer.byteLength(JSON.stringify(checkoutSample(startedAt))),
      )
      const connection = await connect(
        experimentsExtension({
          source: {
            ids: async () => [sample.id],
            experiment: async () => sample,
            openFile: async () => ({
              kind: "download",
              name: "large.diff",
              mimeType: "text/plain",
              text: '"\\界'.repeat(50_000),
            }),
          },
          html: () => placeholderHtml,
        }),
        { era: "modern", mimeTypes: apps },
      )
      const measurements: { tool: string; bytes: number }[] = []
      try {
        const bridge = {
          callTool: async (name: string, args?: Record<string, unknown>) => {
            const result = (await connection.client.callTool({
              name,
              arguments: args,
            })) as CallToolResult
            measurements.push({ tool: name, bytes: carriedBytes(result) })
            expect(measurements.at(-1)!.bytes).toBeLessThanOrEqual(hostLimit)
            return result
          },
        }
        const experiment = await callPaged(bridge, "get_experiment", {
          experimentId: sample.id,
        })
        expect(experiment.structuredContent).toEqual({ experiment: sample })
        const runs = await callPaged(bridge, "list_runs", { experimentId: sample.id })
        expect(runs.structuredContent).toEqual({
          experimentId: sample.id,
          runs: sample.runs,
        })
        const run = await callPaged(bridge, "get_run", {
          experimentId: sample.id,
          runId: "planner",
        })
        expect(run.structuredContent).toEqual({
          experimentId: sample.id,
          run: sample.runs[0],
        })
        const file = await callPaged(bridge, "open_file", {
          experimentId: sample.id,
          runId: "planner",
        })
        expect(file.structuredContent).toMatchObject({
          opening: { text: '"\\界'.repeat(50_000) },
        })
        for (const tool of ["get_experiment", "list_runs", "get_run", "open_file"]) {
          expect(
            measurements.filter((call) => call.tool === tool).length,
          ).toBeGreaterThan(1)
        }
      } finally {
        await connection.close()
      }
    },
    60_000,
  )
})
