/** Assemble extension continuation pages before the existing domain readers see an answer. */
import { z } from "zod/v4"
import type { Bridge, CallToolResult } from "@nessalabs/app-shell"

const pageSchema = z.object({
  page: z.object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    offset: z.number().int().nonnegative(),
    total: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    json: z.string().min(1),
    next: z
      .object({ revision: z.string(), offset: z.number().int().positive() })
      .optional(),
  }),
})
const outcomeSchema = z.object({
  text: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
})

/** A stale view stops reading between calls, as well as ignoring the final answer. */
export async function callPaged(
  bridge: Pick<Bridge, "callTool">,
  name: string,
  args: Record<string, unknown>,
  current: () => boolean = () => true,
): Promise<CallToolResult> {
  let result = await bridge.callTool(name, args)
  const pieces: string[] = []
  let offset = 0
  let revision: string | undefined
  let total: number | undefined
  while (result.isError !== true) {
    const body = result.structuredContent
    if (typeof body !== "object" || body === null || !Object.hasOwn(body, "page")) {
      if (pieces.length === 0) return result
      throw new Error("The continuation has no page.")
    }
    const { page } = pageSchema.parse(body)
    revision ??= page.revision
    total ??= page.total
    const end = offset + page.json.length
    if (
      page.offset !== offset ||
      page.revision !== revision ||
      page.total !== total ||
      end > total
    ) {
      throw new Error("The continuation does not belong to this result.")
    }
    pieces.push(page.json)
    if (end === total) {
      if (page.next !== undefined) throw new Error("The final page has a continuation.")
      const outcome = outcomeSchema.parse(JSON.parse(pieces.join("")))
      return {
        content: [{ type: "text", text: outcome.text }],
        ...(outcome.data === undefined ? {} : { structuredContent: outcome.data }),
      }
    }
    if (page.next?.revision !== revision || page.next.offset !== end) {
      throw new Error("The continuation does not advance to the next page.")
    }
    if (!current()) throw new Error("The view stopped reading.")
    offset = end
    result = await bridge.callTool(name, { ...args, continuation: page.next })
  }
  return result
}
