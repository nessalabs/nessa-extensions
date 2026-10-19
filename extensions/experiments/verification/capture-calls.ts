/** Passive evidence from the actual Nessa gateway, separate from fake-host calls. */
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { z } from "zod/v4"
import type { ExperimentInput } from "../model/index.ts"

const id = z.union([z.string(), z.number().int().safe()])
const request = z.object({
  id,
  params: z.object({ tool: z.string(), argumentsJson: z.string().optional() }),
})
const page = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().nonnegative().safe(),
  total: z.number().int().positive().safe(),
  json: z.string().min(1),
})
const reply = z.object({
  ok: z.literal(true),
  payload: z.object({ resultJson: z.string() }),
})
const result = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()),
})
type Frame = { payload: string | Buffer }
interface Socket {
  on(event: "framesent" | "framereceived", listener: (frame: Frame) => void): unknown
}
type Request = { tool: string; arguments: unknown }
type Assembly = {
  tool: string
  revision: string
  total: number
  pieces: Map<number, string>
}
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

export class CaptureCalls {
  private readonly pending: Map<string | number, Request>[] = []
  private readonly errors: string[] = []
  private readonly calls: object[] = []
  private readonly assemblies = new Map<string, Assembly>()
  private readonly complete = new Set<string>()
  private readonly expected: Map<string, unknown>
  private maximum = 0
  private readonly sampleBytes: number
  private readonly ratio: number
  private readonly checkoutBytes: number

  constructor(fixture: ExperimentInput, checkoutBytes: number) {
    const run = fixture.runs[0]
    this.sampleBytes = Buffer.byteLength(JSON.stringify(fixture))
    this.checkoutBytes = checkoutBytes
    this.ratio = this.sampleBytes / checkoutBytes
    if (
      !Number.isSafeInteger(checkoutBytes) ||
      checkoutBytes <= 0 ||
      this.ratio < 10 ||
      fixture.runs.length !== 1 ||
      run?.change?.files.length !== 10_000
    )
      throw new Error("The actual-host capture requires the complete large fixture")
    this.expected = new Map<string, unknown>([
      ["get_experiment", { experiment: fixture }],
      ["list_runs", { experimentId: fixture.id, runs: fixture.runs }],
      ["get_run", { experimentId: fixture.id, run }],
      [
        "open_file",
        {
          experimentId: fixture.id,
          runId: run.id,
          opening: {
            kind: "unavailable",
            reason: "The sample records changes, not file contents.",
          },
        },
      ],
    ])
  }

  /** A request id belongs to its original socket, not every connection on a page. */
  attach(socket: Socket): void {
    const pending = new Map<string | number, Request>()
    const connection = this.pending.push(pending) - 1
    const observe =
      (read: (value: Record<string, unknown>) => void) =>
      ({ payload }: Frame) => {
        try {
          const value: unknown = JSON.parse(String(payload))
          if (value !== null && typeof value === "object" && !Array.isArray(value))
            read(value as Record<string, unknown>)
        } catch (error) {
          this.errors.push(String(error))
        }
      }
    socket.on(
      "framesent",
      observe((value) => {
        if (value.type !== "req" || value.method !== "mcp.callTool") return
        const parsed = request.parse(value)
        if (pending.has(parsed.id))
          throw new Error("An app request reused a pending socket id")
        if (!this.expected.has(parsed.params.tool))
          throw new Error("Unexpected actual-host app tool")
        pending.set(parsed.id, {
          tool: parsed.params.tool,
          arguments: JSON.parse(parsed.params.argumentsJson ?? "{}"),
        })
      }),
    )
    socket.on(
      "framereceived",
      observe((value) => {
        if (value.type !== "res") return
        const parsedId = id.safeParse(value.id)
        if (!parsedId.success) return
        const held = pending.get(parsedId.data)
        if (!held) return
        pending.delete(parsedId.data)
        const text = reply.parse(value).payload.resultJson
        // This is the original value.to_string() from the host. Its enforced
        // carried size is one further JSON string encoding, not two more.
        const bytes = Buffer.byteLength(JSON.stringify(text))
        this.maximum = Math.max(this.maximum, bytes)
        this.calls.push({
          connection,
          id: parsedId.data,
          ...held,
          bytes,
          resultSha256: sha256(text),
        })
        if (bytes > 57_344) throw new Error("An actual-host reply exceeds 57,344 bytes")
        const answered = result.parse(JSON.parse(text))
        if (answered.isError === true)
          throw new Error("The actual-host app tool returned an error")
        if (!Object.hasOwn(answered.structuredContent, "page")) {
          this.checkData(held.tool, answered.structuredContent)
          return
        }
        const part = page.parse(answered.structuredContent.page)
        if (part.offset + part.json.length > part.total)
          throw new Error("A captured page exceeds its total")
        const key = JSON.stringify([held.tool, part.revision])
        let assembly = this.assemblies.get(key)
        if (!assembly) {
          assembly = {
            tool: held.tool,
            revision: part.revision,
            total: part.total,
            pieces: new Map(),
          }
          this.assemblies.set(key, assembly)
        }
        if (assembly.total !== part.total)
          throw new Error("Captured page totals disagree")
        const previous = assembly.pieces.get(part.offset)
        if (previous !== undefined && previous !== part.json)
          throw new Error("Captured duplicate pages disagree")
        assembly.pieces.set(part.offset, part.json)
      }),
    )
  }

  private checkData(tool: string, data: unknown): void {
    if (!isDeepStrictEqual(data, this.expected.get(tool)))
      throw new Error(`The actual host reconstructed the wrong ${tool} data`)
    this.complete.add(tool)
  }

  /** Checks are made before the browser is closed, while its request owner exists. */
  assertComplete(): void {
    for (const assembly of this.assemblies.values()) {
      let json = ""
      for (const [offset, piece] of [...assembly.pieces].sort((a, b) => a[0] - b[0])) {
        if (offset !== json.length) throw new Error("Captured pages are not contiguous")
        json += piece
      }
      if (json.length !== assembly.total || sha256(json) !== assembly.revision)
        throw new Error("The actual-host revision is incomplete or changed")
      this.checkData(
        assembly.tool,
        z.object({ data: z.unknown() }).parse(JSON.parse(json)).data,
      )
    }
    if (this.pending.some((held) => held.size > 0) || this.errors.length > 0)
      throw new Error("Actual-host calls are pending or have observation errors")
    if (this.complete.size !== this.expected.size)
      throw new Error("The actual host did not reconstruct all four tool results")
  }

  report() {
    return {
      sampleBytes: this.sampleBytes,
      checkoutBytes: this.checkoutBytes,
      ratio: this.ratio,
      runs: 1,
      files: 10_000,
      calls: this.calls,
      pending: this.pending.reduce((count, held) => count + held.size, 0),
      observationErrors: this.errors,
      maxCallBytes: this.maximum,
      assembled: [...this.assemblies.values()].map((held) => ({
        tool: held.tool,
        revision: held.revision,
        characters: held.total,
        pages: held.pieces.size,
      })),
    }
  }
}
