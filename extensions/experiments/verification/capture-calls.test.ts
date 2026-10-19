import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { checkoutSample, scaleSample } from "../samples/index.ts"
import { pageResult } from "../server/paging.ts"
import { CaptureCalls } from "./capture-calls.ts"

const fixture = scaleSample(Date.UTC(2026, 9, 1))
const checkoutBytes = Buffer.byteLength(JSON.stringify(checkoutSample(fixture.startedAt)))
const opening = {
  experimentId: fixture.id,
  runId: "planner",
  opening: {
    kind: "unavailable",
    reason: "The sample records changes, not file contents.",
  },
}
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
function send(socket: EventEmitter, tool = "open_file", id: number = 1) {
  socket.emit("framesent", {
    payload: JSON.stringify({
      type: "req",
      method: "mcp.callTool",
      id,
      params: { tool, argumentsJson: JSON.stringify({ experimentId: fixture.id }) },
    }),
  })
}
function answer(socket: EventEmitter, result: unknown, id: number = 1): string {
  const resultJson = JSON.stringify(result, null, 1)
  socket.emit("framereceived", {
    payload: JSON.stringify({
      type: "res",
      id,
      ok: true,
      payload: { resultJson },
    }),
  })
  return resultJson
}
function observer() {
  const calls = new CaptureCalls(fixture, checkoutBytes)
  const socket = new EventEmitter()
  calls.attach(socket)
  return { calls, socket }
}
function fragment(revision = sha256("{}"), offset = 0, total = 2, json = "{}") {
  return { structuredContent: { page: { revision, offset, total, json } } }
}

describe("actual-host call evidence", () => {
  it("reconstructs the complete large experiment and measures the original result text", () => {
    const { calls, socket } = observer()
    const corrupted = observer()
    let id = 0
    for (const [tool, data] of [
      ["get_experiment", { experiment: fixture }],
      ["list_runs", { experimentId: fixture.id, runs: fixture.runs }],
      ["get_run", { experimentId: fixture.id, run: fixture.runs[0] }],
      ["open_file", opening],
    ] as const) {
      let next: { revision: string; offset: number } | undefined
      const pages = []
      do {
        const page = pageResult({ text: 'Reply "\\界', data }, next)
        pages.push(page)
        next = (page.data as { page?: { next?: typeof next } }).page?.next
      } while (next)
      if (tool === "get_experiment") pages.push(pages[0]!)
      for (const page of pages.reverse()) {
        send(socket, tool, ++id)
        const text = answer(
          socket,
          { content: [{ type: "text", text: page.text }], structuredContent: page.data },
          id,
        )
        send(corrupted.socket, tool, id)
        corrupted.socket.emit("framereceived", {
          payload: JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: {
              resultJson: text.replace(
                /"revision": "[a-f0-9]{64}"/g,
                `"revision": "${"a".repeat(64)}"`,
              ),
            },
          }),
        })
        expect(calls.report().calls.at(-1)).toMatchObject({
          bytes: Buffer.byteLength(JSON.stringify(text)),
          resultSha256: sha256(text),
        })
      }
    }
    expect(() => calls.assertComplete()).not.toThrow()
    expect(calls.report()).toMatchObject({
      pending: 0,
      observationErrors: [],
      sampleBytes: 1_009_968,
      runs: 1,
      files: 10_000,
    })
    expect(calls.report().ratio).toBeGreaterThan(10)
    expect(calls.report().maxCallBytes).toBeLessThanOrEqual(57_344)
    expect(calls.report().assembled).toHaveLength(3)
    expect(() => corrupted.calls.assertComplete()).toThrow("revision")
    send(socket, "open_file", id + 1)
    expect(() => calls.assertComplete()).toThrow("pending")
  })

  it("keeps identical request ids on different sockets independent", () => {
    const { calls, socket } = observer()
    const other = new EventEmitter()
    calls.attach(other)
    send(socket)
    answer(other, { structuredContent: opening })
    expect(calls.report()).toMatchObject({ pending: 1, calls: [] })
    answer(socket, { structuredContent: opening })
    expect(calls.report()).toMatchObject({ pending: 0, observationErrors: [] })
    expect(calls.report().calls).toHaveLength(1)
  })

  it("does not count unrelated RPC traffic as experiment evidence", () => {
    const { calls, socket } = observer()
    socket.emit("framesent", {
      payload: JSON.stringify({ type: "req", id: 1, method: "conversation.read" }),
    })
    answer(socket, { structuredContent: opening })
    expect(calls.report()).toMatchObject({ pending: 0, calls: [], observationErrors: [] })
    expect(() => calls.assertComplete()).toThrow("all four")
  })

  it("records malformed traffic and a reused pending request id", () => {
    const { calls, socket } = observer()
    socket.emit("framesent", { payload: "not JSON" })
    send(socket)
    send(socket)
    expect(calls.report().observationErrors).toHaveLength(2)
    expect(calls.report().pending).toBe(1)
    expect(() => calls.assertComplete()).toThrow()
  })

  it.each([
    {
      name: "oversized reply",
      result: {
        content: [{ type: "text", text: "x".repeat(60_000) }],
        structuredContent: opening,
      },
    },
    { name: "tool error", result: { isError: true, structuredContent: opening } },
    {
      name: "wrong reconstructed data",
      result: { structuredContent: { ...opening, runId: "wrong" } },
    },
    {
      name: "malformed page",
      result: { structuredContent: { page: { json: "wrong" } } },
    },
  ])("rejects $name rather than claiming a browser pass", ({ result }) => {
    const { calls, socket } = observer()
    send(socket)
    answer(socket, result)
    expect(calls.report().observationErrors).not.toHaveLength(0)
    expect(() => calls.assertComplete()).toThrow()
  })

  it("rejects gateway refusal and keeps an unanswered call pending", () => {
    const { calls, socket } = observer()
    send(socket)
    expect(() => calls.assertComplete()).toThrow("pending")
    socket.emit("framereceived", {
      payload: JSON.stringify({
        type: "res",
        id: 1,
        ok: false,
        error: { code: "refused" },
      }),
    })
    expect(calls.report()).toMatchObject({ pending: 0 })
    expect(calls.report().observationErrors).not.toHaveLength(0)
    expect(() => calls.assertComplete()).toThrow()
  })

  it.each([
    { name: "gap", part: fragment(sha256("xx"), 1, 2, "x") },
    { name: "changed revision", part: fragment("a".repeat(64)) },
  ])("rejects an assembly with a $name", ({ part }) => {
    const { calls, socket } = observer()
    send(socket, "get_experiment")
    answer(socket, part)
    expect(() => calls.assertComplete()).toThrow()
  })

  it.each([
    { name: "conflicting totals", part: fragment(sha256("{}"), 0, 3) },
    { name: "conflicting duplicate", part: fragment(sha256("{}"), 0, 2, "[]") },
  ])("records $name even when both pages use the same revision", ({ part }) => {
    const { calls, socket } = observer()
    send(socket, "get_experiment", 1)
    answer(socket, fragment(), 1)
    send(socket, "get_experiment", 2)
    answer(socket, part, 2)
    expect(calls.report().observationErrors).not.toHaveLength(0)
    expect(() => calls.assertComplete()).toThrow()
  })

  it("refuses a small substitute for the realistic fixture", () => {
    expect(
      () => new CaptureCalls(checkoutSample(fixture.startedAt), checkoutBytes),
    ).toThrow("complete large fixture")
    expect(
      () => new CaptureCalls(fixture, Buffer.byteLength(JSON.stringify(fixture))),
    ).toThrow("complete large fixture")
    expect(() => new CaptureCalls(fixture, 0)).toThrow("complete large fixture")
    const run = fixture.runs[0]!
    const fewerFiles = {
      ...fixture,
      runs: [{ ...run, change: { ...run.change!, files: run.change!.files.slice(1) } }],
    }
    expect(() => new CaptureCalls(fewerFiles, checkoutBytes)).toThrow(
      "complete large fixture",
    )
  })
})
