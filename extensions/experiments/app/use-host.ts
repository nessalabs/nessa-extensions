/**
 * The app's calls on its own server, through the bridge: `list_runs`,
 * `get_run`, and `open_file`. Each answer is read in `host-data.ts` before
 * it is shown. A call the host refuses is shown; nothing here assumes it
 * succeeded. A call that returns after the view has moved on is ignored.
 */
import { useCallback, useEffect, useState } from "react"

import { BridgeError, type CallToolResult } from "@nessalabs/app-shell"
import { useBridge } from "@nessalabs/app-shell/react"

import type { DownloadFile } from "./download.ts"
import { fetchedRun, listedRuns, openAnswer, type OpenAnswer } from "./host-data.ts"
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

function failureText(error: unknown, fallback: string): string {
  return error instanceof BridgeError ? error.message : fallback
}

async function call(
  bridge: ReturnType<typeof useBridge>,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return bridge.callTool(name, args)
}

/** `list_runs` while `active`. Idle until then. */
export function useListedRuns(experiment: Experiment, active: boolean): RunList {
  const bridge = useBridge()
  const [list, setList] = useState<RunList>({ status: "idle" })
  useEffect(() => {
    if (!active) return
    let current = true
    setList({ status: "loading" })
    call(bridge, "list_runs", { experimentId: experiment.id }).then(
      (result) => {
        if (!current) return
        const listed = listedRuns(experiment, result)
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
  return active ? list : { status: "idle" }
}

/** `get_run` for `runId`. Idle when no run is open. */
export function useFetchedRun(
  experiment: Experiment,
  runId: string | undefined,
): RunRead {
  const bridge = useBridge()
  const [read, setRead] = useState<RunRead>({ status: "idle" })
  const [tracked, setTracked] = useState(runId)
  // The run on screen changes in this render. Waiting for the effect would
  // show the previous run for a frame.
  if (tracked !== runId) {
    setTracked(runId)
    setRead(runId === undefined ? { status: "idle" } : { status: "loading" })
  }
  useEffect(() => {
    if (runId === undefined) return
    let current = true
    setRead({ status: "loading" })
    call(bridge, "get_run", { experimentId: experiment.id, runId }).then(
      (result) => {
        if (!current) return
        const fetched = fetchedRun(experiment, runId, result)
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
  }, [bridge, experiment, runId])
  return runId === undefined ? { status: "idle" } : read
}

/** `open_file`, then the host's `ui/open-link` or `save` for a download. */
export function useHostOpen(
  save: (file: DownloadFile) => void,
): (request: OpenRequest) => Promise<Opening> {
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
        if (opening.kind === "link") {
          await bridge.openLink(opening.url)
          return { kind: "opened" }
        }
        save({ name: opening.name, mimeType: opening.mimeType, text: opening.text })
        return { kind: "opened" }
      } catch (error) {
        return { kind: "refused", reason: failureText(error, "Couldn't open this.") }
      }
    },
    [bridge, save],
  )
}
