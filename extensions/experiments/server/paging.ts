/** Extension-owned continuation pages; MCP still carries ordinary tools/call results. */
import { createHash } from "node:crypto"
import { z } from "zod/v4"
import type { ToolOutcome } from "@nessalabs/server-kit"

/** A continuation identifies both a position and the source revision it belongs to. */
export const continuation = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    offset: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .optional()
  .describe(
    "Repeat the same tool and arguments with the previous page next value; omit for a fresh read.",
  )

type Continuation = z.infer<typeof continuation>

// A small UTF-16 slice also bounds escaped controls and surrogate halves.
// paging.test.ts measures the complete result using the host's double encoding.
const pageCharacters = 8192

/** Small answers stay whole; large answers are read without retaining server-side sessions. */
export function pageResult(outcome: ToolOutcome, next?: Continuation): ToolOutcome {
  const json = JSON.stringify(outcome)
  if (json.length <= pageCharacters && next === undefined) return outcome
  const revision = createHash("sha256").update(json).digest("hex")
  if (next !== undefined && next.revision !== revision) {
    throw new Error("The source changed while reading. Open the experiment again.")
  }
  const offset = next?.offset ?? 0
  if (offset >= json.length) throw new Error("The page is outside this result.")
  const end = Math.min(offset + pageCharacters, json.length)
  return {
    text: `Result characters ${offset} to ${end} of ${json.length}. Follow the continuation when present.`,
    data: {
      page: {
        revision,
        offset,
        total: json.length,
        json: json.slice(offset, end),
        ...(end === json.length ? {} : { next: { revision, offset: end } }),
      },
    },
  }
}
