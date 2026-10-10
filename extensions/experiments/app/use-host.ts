/**
 * The app's calls on its own server, through the bridge: `list_runs`,
 * `get_run`, and `open_file`. Each answer is read in `host-data.ts` before
 * it is shown. A call the host refuses is shown; nothing here assumes it
 * succeeded. A call that returns after the view has moved on is ignored.
 *
 * A read runs only while its view is on screen. The same experiment and run
 * are not read again when the view is hidden and shown, so a display-mode
 * change does not flash the detail back to loading.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { BridgeError, type Bridge } from "@nessalabs/app-shell"
import { useBridge } from "@nessalabs/app-shell/react"

import {
  experimentFromResult,
  fetchedRun,
  listedRuns,
  openAnswer,
  type LoadedExperiment,
  type OpenAnswer,
} from "./host-data.ts"

type RecoveredExperiment = Exclude<LoadedExperiment, { status: "absent" }>
import type { Opening } from "./open-file.ts"
import type { OpenRequest } from "./use-open-file.ts"
import type { Experiment, Run } from "../model/index.ts"

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

/**
 * `get_experiment` when the opening result carried no experiment. One read
 * per id. A result that still has no experiment is a failure the view shows.
 */
export function useRecoveredExperiment(
  experimentId: string | undefined,
): RecoveredExperiment {
  const bridge = useBridge()
  const [loaded, setLoaded] = useState<RecoveredExperiment>({ status: "waiting" })
  const held = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (experimentId === undefined || held.current === experimentId) return
    let current = true
    setLoaded({ status: "waiting" })
    bridge.callTool("get_experiment", { experimentId }).then(
      (result) => {
        if (!current) return
        const read = experimentFromResult(result)
        const settled: RecoveredExperiment =
          read.status === "absent"
            ? { status: "failed", message: "The result has no experiment." }
            : read
        if (settled.status === "ready") held.current = experimentId
        setLoaded(settled)
      },
      (error: unknown) => {
        if (!current) return
        setLoaded({
          status: "failed",
          message: failureText(error, "The experiment could not be loaded."),
        })
      },
    )
    return () => {
      current = false
    }
  }, [bridge, experimentId])
  return experimentId === undefined ? { status: "waiting" } : loaded
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
 * already read for this experiment is kept: hiding the view does not read
 * it again or return it to loading.
 */
export function useFetchedRun(
  experiment: Experiment,
  runId: string | undefined,
  active: boolean,
): RunRead {
  const bridge = useBridge()
  const [read, setRead] = useState<RunRead>(idleRead)
  const [tracked, setTracked] = useState(runId)
  const held = useRef<{ experiment: Experiment; runId: string } | undefined>(undefined)
  // The run on screen changes in this render. Waiting for the effect would
  // show the previous run for a frame.
  if (tracked !== runId) {
    setTracked(runId)
    setRead(runId === undefined ? idleRead : { status: "loading" })
    if (
      held.current !== undefined &&
      (runId === undefined || held.current.runId !== runId)
    ) {
      held.current = undefined
    }
  }
  useEffect(() => {
    if (!active || runId === undefined) return
    if (held.current?.experiment === experiment && held.current.runId === runId) return
    let current = true
    setRead({ status: "loading" })
    bridge.callTool("get_run", { experimentId: experiment.id, runId }).then(
      (result) => {
        if (!current) return
        const fetched = fetchedRun(experiment, runId, result)
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
  }, [active, bridge, experiment, runId])
  return runId === undefined ? idleRead : read
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
