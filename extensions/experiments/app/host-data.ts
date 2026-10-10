/**
 * What the app reads from its host, checked before a view draws it.
 *
 * The opening tool result is the experiment when it carries one:
 * `validateExperiment` parses it into a copy, and that copy is the
 * experiment the views read. A result with no experiment — a chat view
 * dropped the structured result and kept the text — is `absent`, and the
 * app loads it with `get_experiment`. `list_runs` and `get_run` re-read the
 * source, so their bodies are what the runs list and the run detail draw —
 * a reason or a score that changed after the opening snapshot would
 * otherwise never show. Each body is `parseRun`'s copy, then checked
 * against this experiment. A listed run that does not parse, or whose
 * verdict, split, guardrail, area, agent, or parent is not here, is
 * skipped, and the rest of the list is drawn. The first copy of an id is
 * the one kept. A listed parent counts only once it has been accepted, so
 * a child of a skipped parent is skipped too. `get_run` still refuses that
 * one run, and the snapshot is not drawn in its place. A parent is the
 * baseline, a run in the snapshot, or an accepted run in this list with a
 * lower number.
 *
 * `open_file` is the one answer the experiment does not carry. A link is
 * `http` or `https` only, as the server already requires: a `javascript:` or
 * `data:` URL is refused here too, and is never handed to `ui/open-link`.
 * A download is refused as well. The spec has no download request, and
 * reporting one as opened would claim a file the sandbox never saved.
 */
import type { CallToolResult, ToolCall } from "@nessalabs/app-shell"

import {
  parseRun,
  runOf,
  validateExperiment,
  type Experiment,
  type Run,
} from "../model/index.ts"

export type LoadedExperiment =
  | { readonly status: "waiting" }
  | { readonly status: "cancelled"; readonly reason: string }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly experiment: Experiment }

export type ListedRuns =
  | { readonly ok: true; readonly runs: readonly Run[]; readonly skipped: number }
  | { readonly ok: false; readonly message: string }

export type FetchedRun =
  | { readonly ok: true; readonly run: Run }
  | { readonly ok: false; readonly message: string }

/** A file the app can offer the host: an http(s) link, or a refusal. */
export type OpenAnswer =
  | { readonly kind: "link"; readonly url: string }
  | { readonly kind: "refused"; readonly reason: string }

/** What the app says when the server offers a download. The spec has no request for one. */
const noDownload = "This view can't download a file."

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
  // A chat view drops a structured result over its bound and keeps the text.
  // That is not a failure: the app reads the experiment with get_experiment.
  if (data === undefined || !Object.hasOwn(data, "experiment")) {
    return { status: "absent" }
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
 * Why `run` is refused on `experiment`, or nothing when it belongs here.
 * A fetched or listed run is refused when its verdict, split, guardrail,
 * area, agent, or parent is missing from this experiment, so it is not drawn.
 */
function unfit(
  experiment: Experiment,
  run: Run,
  listed: ReadonlyMap<string, Run> | undefined,
): string | undefined {
  const { definition, areas, agents } = experiment
  if (!definition.verdicts.some((verdict) => verdict.id === run.verdict)) {
    return `Run ${run.id} names a verdict this experiment does not have.`
  }
  for (const split of Object.keys(run.scores)) {
    if (!definition.splits.some((each) => each.id === split)) {
      return `Run ${run.id} names a split this experiment does not have.`
    }
  }
  for (const guardrail of Object.keys(run.measures)) {
    if (!definition.guardrails.some((each) => each.id === guardrail)) {
      return `Run ${run.id} names a guardrail this experiment does not have.`
    }
  }
  if (run.areaId !== undefined && !areas.some((area) => area.id === run.areaId)) {
    return `Run ${run.id} names an area this experiment does not have.`
  }
  if (run.agentId !== undefined && !agents.some((agent) => agent.id === run.agentId)) {
    return `Run ${run.id} names an agent this experiment does not have.`
  }
  if (!parentHere(experiment, run, listed)) {
    return `Run ${run.id} was not built on this experiment.`
  }
  return undefined
}

/**
 * Whether `run` was built on this experiment. A parent in `listed` counts
 * when that map already holds it and its number is lower. The list pass
 * fills the map in number order, so a skipped parent does not carry its
 * children, even when the child was listed first.
 */
function parentHere(
  experiment: Experiment,
  run: Run,
  listed: ReadonlyMap<string, Run> | undefined,
): boolean {
  if (run.parentId === experiment.baseline.id) return true
  if (runOf(experiment, run.parentId) !== undefined) return true
  const parent = listed?.get(run.parentId)
  return parent !== undefined && parent.number < run.number
}

/** `input` as a run of `experiment`, or why it cannot be drawn. */
function runHere(
  experiment: Experiment,
  input: unknown,
  listed: ReadonlyMap<string, Run> | undefined,
): FetchedRun {
  const parsed = parseRun(input)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const message = unfit(experiment, parsed.run, listed)
  if (message !== undefined) return { ok: false, message }
  return { ok: true, run: parsed.run }
}

/**
 * The runs `list_runs` answered that belong on `experiment`, in the order
 * they arrived. One bad item is skipped: it did not parse, it repeats an
 * id, or its verdict, split, guardrail, area, agent, or parent is not here.
 * The first copy of an id is kept. Acceptance is one pass from lower run
 * numbers to higher, which is parent before child, and a listed parent
 * counts only after that pass has accepted it. `skipped` is how many were
 * left out. The whole answer is refused when the call failed, or when the
 * body is not this experiment's list.
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
  const candidates: Run[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of data.runs) {
    const one = parseRun(item)
    if (!one.ok) {
      skipped += 1
      continue
    }
    if (seen.has(one.run.id)) {
      skipped += 1
      continue
    }
    seen.add(one.run.id)
    candidates.push(one.run)
  }
  // A parent has a lower number, so this order accepts it before its children.
  const accepted = new Map<string, Run>()
  for (const run of [...candidates].sort((a, b) => a.number - b.number)) {
    if (unfit(experiment, run, accepted) !== undefined) {
      skipped += 1
      continue
    }
    accepted.set(run.id, run)
  }
  return {
    ok: true,
    runs: candidates.filter((run) => accepted.has(run.id)),
    skipped,
  }
}

/**
 * The run `get_run` answered, when it is `runId`, or why it cannot be drawn.
 * `alongside` is the run list already accepted, so a parent that arrived in
 * that list counts here too.
 */
export function fetchedRun(
  experiment: Experiment,
  runId: string,
  result: CallToolResult,
  alongside: readonly Run[] = [],
): FetchedRun {
  if (result.isError === true) {
    return { ok: false, message: failed(result, "The run could not be read.") }
  }
  const data = record(result.structuredContent)
  if (data === undefined || data.experimentId !== experiment.id) {
    return { ok: false, message: "The run is not the one that was asked for." }
  }
  const accepted = runHere(
    experiment,
    data.run,
    new Map(alongside.map((run) => [run.id, run])),
  )
  if (!accepted.ok) return accepted
  if (accepted.run.id !== runId) {
    return { ok: false, message: "The run is not the one that was asked for." }
  }
  return accepted
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
    return { kind: "refused", reason: noDownload }
  }
  return { kind: "refused", reason: "Couldn't open this." }
}
