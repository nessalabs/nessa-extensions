/**
 * What the browser hosts answer for the checkout sample. The bodies are
 * full runs: the app draws `list_runs` and `get_run`, and a body that is
 * only an id is refused.
 */
import { runsNewestFirst, validateExperiment, type Run } from "../../model/index.ts"
import { checkoutSample } from "../../samples/index.ts"

const validated = validateExperiment(checkoutSample(Date.UTC(2026, 9, 1, 9)))
if (validated.kind !== "valid") throw new Error("the checkout sample did not validate")

export const experiment = validated.experiment

function copy(run: Run): Run {
  return JSON.parse(JSON.stringify(run)) as Run
}

export function toolResult(text: string, data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  }
}

export function answerCall(name: string, args: Record<string, unknown> | undefined) {
  if (name === "list_runs") {
    return toolResult("runs", {
      experimentId: experiment.id,
      runs: runsNewestFirst(experiment).map((run) => copy(run)),
    })
  }
  if (name === "get_run") {
    const run = experiment.runs.find((each) => each.id === args?.runId)
    if (run === undefined) {
      return {
        content: [{ type: "text" as const, text: "That run is not in this experiment." }],
        structuredContent: {},
        isError: true,
      }
    }
    return toolResult("run", { experimentId: experiment.id, run: copy(run) })
  }
  if (name === "open_file") {
    return toolResult("opening", {
      opening: {
        kind: "unavailable",
        reason: "The sample records the change, not the file.",
      },
    })
  }
  return {
    content: [{ type: "text" as const, text: "Unknown tool." }],
    structuredContent: {},
    isError: true,
  }
}
