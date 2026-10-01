/**
 * The tool call the app was opened for, as the host's notifications move it:
 * its input, partial then complete, then its result or its cancellation.
 * Pure: `nextToolCall` is the table in this package's README ("The tool
 * call"), and `tool-call.test.ts` has a test per row.
 *
 * The notifications carry no call identity, so "the call" is the current
 * one: a new input after the current call has settled begins the next, as
 * the standard's interactive phase allows.
 */
import type { CallToolResult } from "../protocol/messages.ts"

export type ToolArguments = Record<string, unknown>

export type ToolCall =
  /** Nothing yet: the host has not sent the input. */
  | { phase: "awaiting-input" }
  /** The host is streaming the input; `partial` is its best guess so far. */
  | { phase: "streaming-input"; partial: ToolArguments }
  /** The input is complete and the tool is running. */
  | { phase: "running"; input: ToolArguments }
  /** The tool finished. `input` is absent when the host sent none first. */
  | { phase: "complete"; input?: ToolArguments; result: CallToolResult }
  /** The tool was cancelled. `input` is absent when the host sent none first. */
  | { phase: "cancelled"; input?: ToolArguments; reason?: string }

export type ToolEvent =
  | { type: "input-partial"; arguments: ToolArguments }
  | { type: "input"; arguments: ToolArguments }
  | { type: "result"; result: CallToolResult }
  | { type: "cancelled"; reason?: string }

/**
 * The next state, and whether the event broke the standard's order. An event
 * the standard does not allow in a state either still carries meaning, and
 * is applied (a result before any input is still the result), or carries
 * none, and is ignored (a second settlement of a settled call); both are
 * reported.
 */
export function nextToolCall(
  call: ToolCall,
  event: ToolEvent,
): { call: ToolCall; outOfOrder: boolean } {
  const settled = call.phase === "complete" || call.phase === "cancelled"
  const input = call.phase === "running" ? { input: call.input } : {}
  switch (event.type) {
    case "input-partial":
      // Partials stop once the complete input is sent, until the next call.
      if (call.phase === "running") return { call, outOfOrder: true }
      return {
        call: { phase: "streaming-input", partial: event.arguments },
        outOfOrder: false,
      }
    case "input":
      // The input is sent at most once per call.
      if (call.phase === "running") return { call, outOfOrder: true }
      return { call: { phase: "running", input: event.arguments }, outOfOrder: false }
    case "result":
      if (settled) return { call, outOfOrder: true }
      return {
        call: { phase: "complete", ...input, result: event.result },
        outOfOrder: call.phase !== "running",
      }
    case "cancelled":
      if (settled) return { call, outOfOrder: true }
      return {
        call: {
          phase: "cancelled",
          ...input,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        },
        outOfOrder: false,
      }
  }
}
