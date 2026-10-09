/**
 * What the app reads from its host, checked before a view draws it.
 *
 * The opening tool result is the experiment: `validateExperiment` parses it
 * into a copy, and that copy is the only experiment the views read. `list_runs`
 * and `get_run` then say which of its runs to show, and in which order. A run
 * they name that the experiment does not have is refused. Their bodies are
 * not drawn: a run is part of the experiment `validateExperiment` made, and
 * splicing a later body in would be a second one.
 *
 * `open_file` is the one answer the experiment does not carry. A link is
 * `http` or `https` only, as the server already requires: a `javascript:` or
 * `data:` URL is refused here too, and is never handed to `ui/open-link`.
 */
import type { CallToolResult, ToolCall } from "@nessalabs/app-shell"

import { runOf, validateExperiment, type Experiment, type Run } from "../model/index.ts"

export type LoadedExperiment =
  | { readonly status: "waiting" }
  | { readonly status: "cancelled"; readonly reason: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly experiment: Experiment }

export type ListedRuns =
  | { readonly ok: true; readonly runs: readonly Run[] }
  | { readonly ok: false; readonly message: string }

export type FetchedRun =
  | { readonly ok: true; readonly run: Run }
  | { readonly ok: false; readonly message: string }

/** A file the app can offer: a link for the host, or contents to download. */
export type OpenAnswer =
  | { readonly kind: "link"; readonly url: string }
  | {
      readonly kind: "download"
      readonly name: string
      readonly mimeType: string
      readonly text: string
    }
  | { readonly kind: "refused"; readonly reason: string }

const cancelled = "The experiment was not loaded."

/** The text a tool result says, when it says any. */
export function resultText(result: CallToolResult): string {
  for (const block of result.content) {
    if (block.type === "text" && block.text.trim() !== "") return block.text
  }
  return ""
}

function failed(result: CallToolResult, fallback: string): string {
  return resultText(result) || fallback
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined
  return Object.fromEntries(Object.entries(value))
}

/** The experiment the tool result carries, or why it does not. */
export function experimentFromResult(result: CallToolResult): LoadedExperiment {
  if (result.isError === true) {
    return {
      status: "failed",
      message: failed(result, "The experiment could not be loaded."),
    }
  }
  const data = record(result.structuredContent)
  if (data === undefined || !Object.hasOwn(data, "experiment")) {
    return { status: "failed", message: "The result has no experiment." }
  }
  const validation = validateExperiment(data.experiment)
  if (validation.kind === "invalid") {
    const message = validation.problems.map((problem) => problem.message).join(" ")
    return {
      status: "failed",
      message: message === "" ? "The experiment is not valid." : message,
    }
  }
  return { status: "ready", experiment: validation.experiment }
}

/** Where the opening tool call stands, as the views render it. */
export function loadExperiment(call: ToolCall): LoadedExperiment {
  switch (call.phase) {
    case "awaiting-input":
    case "streaming-input":
    case "running":
      return { status: "waiting" }
    case "cancelled":
      return { status: "cancelled", reason: call.reason ?? cancelled }
    case "complete":
      return experimentFromResult(call.result)
  }
}

/**
 * The experiment's runs in the order `list_runs` answered, or why that
 * answer cannot be shown.
 */
export function listedRuns(experiment: Experiment, result: CallToolResult): ListedRuns {
  if (result.isError === true) {
    return { ok: false, message: failed(result, "The runs could not be listed.") }
  }
  const data = record(result.structuredContent)
  if (
    data === undefined ||
    data.experimentId !== experiment.id ||
    !Array.isArray(data.runs)
  ) {
    return { ok: false, message: "The run list is not this experiment's." }
  }
  const runs: Run[] = []
  const seen = new Set<string>()
  for (const item of data.runs) {
    const row = record(item)
    const id = row === undefined ? undefined : row.id
    if (typeof id !== "string" || id === "") {
      return { ok: false, message: "A run in the list has no id." }
    }
    const run = runOf(experiment, id)
    if (run === undefined) {
      return { ok: false, message: `Run ${id} is not in this experiment.` }
    }
    if (seen.has(id)) return { ok: false, message: `Run ${id} is listed twice.` }
    seen.add(id)
    runs.push(run)
  }
  return { ok: true, runs }
}

/** The experiment's run `runId`, when `get_run` names it, or why it does not. */
export function fetchedRun(
  experiment: Experiment,
  runId: string,
  result: CallToolResult,
): FetchedRun {
  if (result.isError === true) {
    return { ok: false, message: failed(result, "The run could not be read.") }
  }
  const data = record(result.structuredContent)
  const runRecord = data === undefined ? undefined : record(data.run)
  if (
    data === undefined ||
    data.experimentId !== experiment.id ||
    runRecord === undefined ||
    runRecord.id !== runId
  ) {
    return { ok: false, message: "The run is not the one that was asked for." }
  }
  const run = runOf(experiment, runId)
  if (run === undefined) {
    return { ok: false, message: `Run ${runId} is not in this experiment.` }
  }
  return { ok: true, run }
}

/** `http` or `https` only. Anything else is refused, including `javascript:` and `data:`. */
function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.href
  } catch {
    return undefined
  }
}

function ownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

/** How `open_file` answered, or a refusal a view can show. */
export function openAnswer(result: CallToolResult): OpenAnswer {
  if (result.isError === true) {
    return { kind: "refused", reason: failed(result, "Couldn't open this.") }
  }
  const data = record(result.structuredContent)
  const opening = data === undefined ? undefined : record(data.opening)
  if (opening === undefined || typeof opening.kind !== "string") {
    return { kind: "refused", reason: "Couldn't open this." }
  }
  if (opening.kind === "unavailable") {
    const reason = opening.reason
    if (
      !ownKeys(opening, ["kind", "reason"]) ||
      typeof reason !== "string" ||
      reason.trim() === ""
    ) {
      return { kind: "refused", reason: "Couldn't open this." }
    }
    return { kind: "refused", reason }
  }
  if (opening.kind === "link") {
    const url = httpUrl(opening.url)
    if (!ownKeys(opening, ["kind", "url"]) || url === undefined) {
      return { kind: "refused", reason: "Couldn't open this." }
    }
    return { kind: "link", url }
  }
  if (opening.kind === "download") {
    const { name, mimeType, text } = opening
    if (
      !ownKeys(opening, ["kind", "name", "mimeType", "text"]) ||
      typeof name !== "string" ||
      name.trim() === "" ||
      typeof mimeType !== "string" ||
      mimeType.trim() === "" ||
      typeof text !== "string"
    ) {
      return { kind: "refused", reason: "Couldn't open this." }
    }
    return { kind: "download", name, mimeType, text }
  }
  return { kind: "refused", reason: "Couldn't open this." }
}
