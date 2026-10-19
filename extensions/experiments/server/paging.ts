/** Extension-owned continuation pages; MCP still carries ordinary tools/call results. */
import { createHash } from "node:crypto"
import { z } from "zod/v4"
import type { ToolOutcome } from "@nessalabs/server-kit"
import { shortText } from "./text.ts"

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

// Small outcomes can travel whole. For pages, spend bytes on the JSON payload
// rather than charging ordinary ASCII as if every character needed escaping.
// 40,000 leaves room for the summary and envelope under the host's 57,344-byte
// bound. paging.test.ts measures the complete result with its double encoding.
const wholeCharacters = 8192
const pageBytes = 40_000

/** End of an ASCII JSON slice after encoding its string value twice. */
function pageEnd(json: string, offset: number): number {
  let end = offset
  let bytes = 0
  while (end < json.length) {
    // JSON.stringify escaped controls and non-ASCII was escaped below. Quotes
    // and backslashes each occupy four bytes after the two enclosing encodings;
    // every other character in this ASCII alphabet occupies one.
    const cost = json[end] === '"' || json[end] === "\\" ? 4 : 1
    if (bytes + cost > pageBytes) break
    bytes += cost
    end++
  }
  return end
}

/** Small answers stay whole; large answers are read without retaining server-side sessions. */
export function pageResult(outcome: ToolOutcome, next?: Continuation): ToolOutcome {
  // Escape non-ASCII code units before splitting: each page is itself valid
  // Unicode, even where the serialized outcome contains a surrogate pair.
  // JSON.parse after assembly recovers the original strings without loss.
  const json = JSON.stringify(outcome).replace(
    /[\u0080-\uffff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
  if (json.length <= wholeCharacters && next === undefined) return outcome
  const revision = createHash("sha256").update(json).digest("hex")
  if (next !== undefined && next.revision !== revision) {
    throw new Error("The source changed while reading. Open the experiment again.")
  }
  const offset = next?.offset ?? 0
  if (offset >= json.length) throw new Error("The page is outside this result.")
  const end = pageEnd(json, offset)
  return {
    text: `${shortText(outcome.text, 1024, "… [summary truncated]")}\nResult characters ${offset} to ${end} of ${json.length}. Follow the continuation when present.`,
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
