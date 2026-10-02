/**
 * The experiments extension: its view and its tools, over a source of
 * experiments (`source.ts`). What each tool does, and who may call it, is
 * the extension's README; negotiation, input parsing and the checks on what
 * a tool answers are the server kit's.
 */
import {
  defineExtension,
  defineTool,
  type Extension,
  type ToolOutcome,
} from "@nessalabs/server-kit"
import { z } from "zod/v4"

import manifest from "../package.json" with { type: "json" }
import { runOf, runsNewestFirst, type Experiment } from "../model/index.ts"
import { readExperiment, readOpening } from "./reading.ts"
import type { ExperimentSource, FileRequest } from "./source.ts"
import {
  experimentText,
  invalidText,
  missingRunText,
  missingText,
  noChangeText,
  openingText,
  runText,
  runsText,
  unchangedPathText,
} from "./text.ts"
import { experimentView } from "./view.ts"

export interface ExperimentsOptions {
  /** Where the experiments come from. */
  readonly source: ExperimentSource
  /** The experiment view's HTML: the built app's. */
  readonly html: () => string | Promise<string>
}

/** A request the tool cannot answer, said as its text; the kit makes it a tool error. */
class Refusal extends Error {
  override readonly name = "Refusal"
}

const experimentId = z.string().min(1).describe("The experiment's id.")
const runId = z.string().min(1).describe("The run's id, within the experiment.")

/** Makes the experiments extension over `source`. */
export function experimentsExtension({ source, html }: ExperimentsOptions): Extension {
  /** The experiment `id`, validated; a refusal when it is missing or invalid. */
  async function experimentOf(id: string, signal: AbortSignal): Promise<Experiment> {
    const reading = await readExperiment(source, id, signal)
    switch (reading.kind) {
      case "ready":
        return reading.experiment
      case "missing":
        throw new Refusal(missingText(id, reading.ids))
      case "invalid":
        throw new Refusal(invalidText(id, reading.problems))
    }
  }

  const showExperiment = async (
    { experimentId }: { experimentId: string },
    { signal }: { signal: AbortSignal },
  ): Promise<ToolOutcome> => {
    const experiment = await experimentOf(experimentId, signal)
    return { text: experimentText(experiment), data: { experiment } }
  }

  return defineExtension({
    name: manifest.name,
    version: manifest.version,
    views: [
      {
        uri: experimentView,
        name: "experiment",
        title: "Experiment",
        description: "An experiment's climb, areas, runs, and run detail.",
        html,
      },
    ],
    tools: [
      defineTool({
        name: "show_experiment",
        title: "Show experiment",
        description:
          "Shows an experiment: its metric, the best version so far, its guardrails, and its runs, newest first. An unknown id answers with the ids there are.",
        input: z.object({ experimentId }),
        effects: "read-only",
        view: experimentView,
        run: showExperiment,
      }),
      defineTool({
        name: "get_experiment",
        title: "Get experiment",
        description: "Reads an experiment again, for the experiment view.",
        input: z.object({ experimentId }),
        effects: "read-only",
        view: experimentView,
        callers: ["app"],
        run: showExperiment,
      }),
      defineTool({
        name: "list_runs",
        title: "List runs",
        description: "Lists an experiment's runs, newest first, for the experiment view.",
        input: z.object({ experimentId }),
        effects: "read-only",
        view: experimentView,
        callers: ["app"],
        run: async ({ experimentId }, { signal }) => {
          const experiment = await experimentOf(experimentId, signal)
          const runs = runsNewestFirst(experiment)
          return {
            text: runsText(experiment, runs),
            data: { experimentId: experiment.id, runs },
          }
        },
      }),
      defineTool({
        name: "get_run",
        title: "Get run",
        description:
          "Reads one run of an experiment in full: its verdict and reason, scores, guardrails, cases, and change, for the experiment view.",
        input: z.object({ experimentId, runId }),
        effects: "read-only",
        view: experimentView,
        callers: ["app"],
        run: async ({ experimentId, runId }, { signal }) => {
          const experiment = await experimentOf(experimentId, signal)
          const run = runOf(experiment, runId)
          if (run === undefined) throw new Refusal(missingRunText(experiment, runId))
          return {
            text: runText(experiment, run),
            data: { experimentId: experiment.id, run },
          }
        },
      }),
      defineTool({
        name: "open_file",
        title: "Open file",
        description:
          "Opens a file a run changed, or with no path the run's whole change: as a link to open, or as contents to download. Says why when it cannot.",
        input: z.object({
          experimentId,
          runId,
          path: z
            .string()
            .min(1)
            .optional()
            .describe(
              "One of the run's changed files; leave it out for the whole change.",
            ),
        }),
        effects: "read-only",
        run: async ({ experimentId, runId, path }, { signal }) => {
          const experiment = await experimentOf(experimentId, signal)
          const run = runOf(experiment, runId)
          if (run === undefined) throw new Refusal(missingRunText(experiment, runId))
          if (run.change === undefined) {
            throw new Refusal(noChangeText(experiment, run))
          }
          if (
            path !== undefined &&
            !run.change.files.some((file) => file.path === path)
          ) {
            throw new Refusal(unchangedPathText(experiment, run, path))
          }
          const request: FileRequest = {
            experimentId: experiment.id,
            runId: run.id,
            ...(path === undefined ? {} : { path }),
          }
          const opening = await readOpening(source, request, signal)
          return { text: openingText(request, opening), data: { ...request, opening } }
        },
      }),
    ],
  })
}
