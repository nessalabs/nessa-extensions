import { toUSVString } from "node:util"
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
  it("keeps the standalone explanation on every page for clients without assembly", () => {
    const outcome = {
      text: "Can't open this file: the artifact expired.",
      data: { opening: { kind: "unavailable", reason: "x".repeat(30_000) } },
    }
    let next: { revision: string; offset: number } | undefined
    let pages = 0
    do {
      const result = pageResult(outcome, next)
      expect(result.text).toContain(outcome.text)
      expect(carriedBytes(wire(result))).toBeLessThanOrEqual(hostLimit)
      next = (result.data as { page: { next?: typeof next } }).page.next
      pages++
    } while (next !== undefined)
    expect(pages).toBeGreaterThan(1)
  })

  it.each([8180, 8181, 8182, 8183])(
    "keeps each page Unicode-safe at shifted boundary %s",
    async (padding) => {
      const outcome = { text: "a".repeat(padding) + "😀" + "界".repeat(100) }
      let pages = 0
      const result = await callPaged(
        {
          callTool: async (_name, args) => {
            const answer = wire(
              pageResult(
                outcome,
                args?.continuation as { revision: string; offset: number } | undefined,
              ),
            )
            const page = (answer.structuredContent as { page: { json: string } }).page
            expect(toUSVString(page.json)).toBe(page.json)
            expect(Buffer.byteLength(page.json)).toBe(page.json.length)
            expect(carriedBytes(answer)).toBeLessThanOrEqual(hostLimit)
            pages++
            return answer
          },
        },
        "get_experiment",
        {},
      )
      expect(pages).toBeGreaterThan(1)
      expect(result).toEqual(wire(outcome))
    },
  )

  it.each([overStdio, overHttp])(
    "keeps malformed-source failures bounded before and between pages",
    async (connect) => {
      const sample = checkoutSample(startedAt)
      let invalid = false
      const malformed = { ...sample, ["x".repeat(60_000)]: true }
      const connection = await connect(
        experimentsExtension({
          source: {
            ids: async () => [sample.id],
            experiment: async () => (invalid ? malformed : sample),
            openFile: async () => {
              throw new Error("a".repeat(4095) + "😀" + "\\\\".repeat(60_000))
            },
          },
          html: () => placeholderHtml,
        }),
        { era: "modern", mimeTypes: apps },
      )
      try {
        const first = await connection.client.callTool({
          name: "get_experiment",
          arguments: { experimentId: sample.id },
        })
        expect(first.isError).toBeFalsy()
        const next = (first.structuredContent as { page: { next: unknown } }).page.next
        invalid = true
        for (const continuation of [undefined, next]) {
          const result = await connection.client.callTool({
            name: "get_experiment",
            arguments: {
              experimentId: sample.id,
              ...(continuation === undefined ? {} : { continuation }),
            },
          })
          expect(result.isError).toBe(true)
          expect(carriedBytes(result)).toBeLessThanOrEqual(hostLimit)
          expect(result.content).toMatchObject([
            { text: expect.stringContaining("diagnostic truncated") },
          ])
        }
        invalid = false
        const file = await connection.client.callTool({
          name: "open_file",
          arguments: {
            experimentId: sample.id,
            runId: sample.runs.find((run) => run.change !== undefined)!.id,
          },
        })
        expect(file.isError).toBe(true)
        expect(carriedBytes(file)).toBeLessThanOrEqual(hostLimit)
        const text = (file.content as { text: string }[])[0]!.text
        expect(toUSVString(text)).toBe(text)
      } finally {
        await connection.close()
      }
    },
  )

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
            const text = (result.content as { text: string }[])[0]!.text
            expect(toUSVString(text)).toBe(text)
            const page = result.structuredContent as { page?: { json: string } }
            if (page.page !== undefined) {
              expect(toUSVString(page.page.json)).toBe(page.page.json)
              expect(Buffer.byteLength(page.page.json)).toBe(page.page.json.length)
            }
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
