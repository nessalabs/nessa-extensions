/**
 * The app's calls on its own server, through the bridge: `get_experiment`,
 * `list_runs`, `get_run`, and `open_file`. Each answer is read in
 * `host-data.ts` before it is shown. A call the host refuses is shown;
 * nothing here assumes it succeeded. A call that returns after the view has
 * moved on is ignored.
 *
 * A read runs only while its view is on screen. The same experiment and run
 * are not read again when the view is hidden and shown, so a display-mode
 * change does not flash the detail back to loading. A new shown snapshot
 * drops that read in the render it arrives, including when the experiment
 * id is unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { BridgeError, type Bridge, type CallToolResult } from "@nessalabs/app-shell"
import { useBridge } from "@nessalabs/app-shell/react"

import {
  experimentFromResult,
  fetchedRun,
  listedRuns,
  openAnswer,
  type LoadedExperiment,
  type OpenAnswer,
} from "./host-data.ts"
import type { Opening } from "./open-file.ts"
import type { OpenRequest } from "./use-open-file.ts"
import type { Experiment, Run } from "../model/index.ts"

type RecoveredExperiment = Exclude<LoadedExperiment, { status: "absent" }>

const noRuns: readonly Run[] = []

export type RunList =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly runs: readonly Run[] }
  | { readonly status: "failed"; readonly message: string }

export type RunRead =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly run: Run }
  | { readonly status: "failed"; readonly message: string }

const idleList: RunList = { status: "idle" }
const idleRead: RunRead = { status: "idle" }

function failureText(error: unknown, fallback: string): string {
  return error instanceof BridgeError ? error.message : fallback
}

/** Whether this host declared `openLinks` in `ui/initialize`. */
function hostOpensLinks(bridge: Bridge): boolean {
  const connection = bridge.getState().connection
  const capabilities =
    connection.status === "connected"
      ? connection.capabilities
      : connection.status === "tearing-down"
        ? connection.opened?.capabilities
        : undefined
  return capabilities?.openLinks !== undefined
}

type Recovery = {
  readonly opening: CallToolResult
  readonly experimentId: string
  readonly loaded: RecoveredExperiment
}

/** The experiment `get_experiment` returned, or why this opening result cannot show it. */
function recoveredFrom(
  read: LoadedExperiment,
  experimentId: string,
): RecoveredExperiment {
  if (read.status === "absent") {
    return { status: "failed", message: "The result has no experiment." }
  }
  if (read.status === "ready" && read.experiment.id !== experimentId) {
    return { status: "failed", message: "The result is for a different experiment." }
  }
  return read
}

/**
 * `get_experiment` when `opening` carried no experiment. One read per opening
 * result: a later result for the same id is read again. What is shown belongs
 * to that result, so a failure for another result is not shown. A ready
 * experiment whose id is not the one requested is a failure.
 */
export function useRecoveredExperiment(
  experimentId: string | undefined,
  opening: CallToolResult | undefined,
): RecoveredExperiment {
  const bridge = useBridge()
  const [recovery, setRecovery] = useState<Recovery | undefined>(undefined)
  const attempt = useRef<
    { opening: CallToolResult; experimentId: string; done: boolean } | undefined
  >(undefined)
  useEffect(() => {
    if (experimentId === undefined || opening === undefined) return
    const prior = attempt.current
    if (
      prior !== undefined &&
      prior.opening === opening &&
      prior.experimentId === experimentId &&
      prior.done
    ) {
      return
    }
    let current = true
    attempt.current = { opening, experimentId, done: false }
    setRecovery({ opening, experimentId, loaded: { status: "waiting" } })
    bridge.callTool("get_experiment", { experimentId }).then(
      (result) => {
        if (!current) return
        attempt.current = { opening, experimentId, done: true }
        setRecovery({
          opening,
          experimentId,
          loaded: recoveredFrom(experimentFromResult(result), experimentId),
        })
      },
      (error: unknown) => {
        if (!current) return
        attempt.current = { opening, experimentId, done: true }
        setRecovery({
          opening,
          experimentId,
          loaded: {
            status: "failed",
            message: failureText(error, "The experiment could not be loaded."),
          },
        })
      },
    )
    return () => {
      current = false
    }
  }, [bridge, experimentId, opening])
  if (experimentId === undefined || opening === undefined) return { status: "waiting" }
  if (
    recovery === undefined ||
    recovery.opening !== opening ||
    recovery.experimentId !== experimentId
  ) {
    return { status: "waiting" }
  }
  return recovery.loaded
}

/** `list_runs` while `active`. Idle until then, and not read again for the same experiment. */
export function useListedRuns(experiment: Experiment, active: boolean): RunList {
  const bridge = useBridge()
  const [list, setList] = useState<RunList>(idleList)
  const held = useRef<Experiment | undefined>(undefined)
  useEffect(() => {
    if (!active || held.current === experiment) return
    let current = true
    setList({ status: "loading" })
    bridge.callTool("list_runs", { experimentId: experiment.id }).then(
      (result) => {
        if (!current) return
        const listed = listedRuns(experiment, result)
        if (listed.ok) held.current = experiment
        setList(
          listed.ok
            ? { status: "ready", runs: listed.runs }
            : { status: "failed", message: listed.message },
        )
      },
      (error: unknown) => {
        if (!current) return
        setList({
          status: "failed",
          message: failureText(error, "The runs could not be listed."),
        })
      },
    )
    return () => {
      current = false
    }
  }, [active, bridge, experiment])
  return active ? list : idleList
}

/**
 * `get_run` for `runId` while `active`. Idle when no run is open. A run
 * already read for this snapshot is kept: hiding the view does not read it
 * again or return it to loading. `snapshotToken` is the experiment on
 * screen. A different one drops the run in this render, so the previous
 * body is not drawn on the new experiment.
 */
export function useFetchedRun(
  experiment: Experiment,
  runId: string | undefined,
  active: boolean,
  snapshotToken: number,
  alongside: readonly Run[] = noRuns,
): RunRead {
  const bridge = useBridge()
  const [read, setRead] = useState<RunRead>(idleRead)
  const [tracked, setTracked] = useState({ runId, snapshotToken })
  const held = useRef<{ experiment: Experiment; runId: string } | undefined>(undefined)
  // The run on screen, or the snapshot it was read for, changes in this
  // render. Waiting for the effect would show the previous run for a frame.
  const snapshotChanged = tracked.snapshotToken !== snapshotToken
  const runChanged = tracked.runId !== runId
  const cleared: RunRead = runId === undefined ? idleRead : { status: "loading" }
  if (snapshotChanged || runChanged) {
    setTracked({ runId, snapshotToken })
    setRead(cleared)
    if (snapshotChanged || runId === undefined || held.current?.runId !== runId) {
      held.current = undefined
    }
  }
  const visible = snapshotChanged || runChanged ? cleared : read
  useEffect(() => {
    if (!active || runId === undefined) return
    if (held.current?.experiment === experiment && held.current.runId === runId) return
    let current = true
    setRead({ status: "loading" })
    bridge.callTool("get_run", { experimentId: experiment.id, runId }).then(
      (result) => {
        if (!current) return
        const fetched = fetchedRun(experiment, runId, result, alongside)
        if (fetched.ok) held.current = { experiment, runId }
        setRead(
          fetched.ok
            ? { status: "ready", run: fetched.run }
            : { status: "failed", message: fetched.message },
        )
      },
      (error: unknown) => {
        if (!current) return
        setRead({
          status: "failed",
          message: failureText(error, "The run could not be read."),
        })
      },
    )
    return () => {
      current = false
    }
  }, [active, alongside, bridge, experiment, snapshotToken, runId])
  return runId === undefined ? idleRead : visible
}

/** `open_file`, then `ui/open-link` when the host offers it. */
export function useHostOpen(): (request: OpenRequest) => Promise<Opening> {
  const bridge = useBridge()
  return useCallback(
    async (request: OpenRequest): Promise<Opening> => {
      try {
        const result = await bridge.callTool("open_file", {
          experimentId: request.experimentId,
          runId: request.runId,
          ...(request.path === undefined ? {} : { path: request.path }),
        })
        const opening: OpenAnswer = openAnswer(result)
        if (opening.kind === "refused") return opening
        if (!hostOpensLinks(bridge)) {
          return { kind: "refused", reason: "This host doesn't open links." }
        }
        await bridge.openLink(opening.url)
        return { kind: "opened" }
      } catch (error) {
        return { kind: "refused", reason: failureText(error, "Couldn't open this.") }
      }
    },
    [bridge],
  )
}
