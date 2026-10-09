/**
 * The experiment view. Inline, it is the card. Fullscreen, it is the
 * surface. The card asks for fullscreen with `ui/request-display-mode`, and
 * only after the host's context says that mode is offered. What is drawn
 * follows the mode the host actually has, including when that is not the
 * mode that was asked for.
 *
 * The experiment is the opening tool result, validated. Later reads go
 * through `tools/call`.
 */
import { useState } from "react"

import { BridgeError, describeFailure } from "@nessalabs/app-shell"
import { useConnection, useDisplayMode, useToolCall } from "@nessalabs/app-shell/react"

import { saveDownload, type DownloadFile } from "./download.ts"
import { ExperimentCard } from "./experiment-card.tsx"
import { loadExperiment } from "./host-data.ts"
import { ExperimentSurface } from "./surface.tsx"
import { useHostOpen } from "./use-host.ts"
import type { Schedule } from "./use-open-file.ts"
import "./tokens.css"

const browserSchedule: Schedule = {
  after(ms, run) {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

export function ExperimentApp({
  save = saveDownload,
  schedule = browserSchedule,
}: {
  readonly save?: (file: DownloadFile) => void
  readonly schedule?: Schedule
} = {}) {
  const connection = useConnection()
  const call = useToolCall()
  const { mode, available, request } = useDisplayMode()
  const open = useHostOpen(save)
  const [notice, setNotice] = useState<string | undefined>()
  const [pending, setPending] = useState<"fullscreen" | "inline" | undefined>()
  const loaded = loadExperiment(call)
  const fullscreen = mode === "fullscreen"

  const ask = async (next: "fullscreen" | "inline") => {
    if (pending !== undefined) return
    const offered = available ?? []
    if (!offered.includes(next)) {
      setNotice(
        describeFailure({
          kind: "display-mode-unavailable",
          mode: next,
          available: offered,
        }),
      )
      return
    }
    setPending(next)
    try {
      const chosen = await request(next)
      setNotice(chosen === next ? undefined : `The host kept the experiment ${chosen}.`)
    } catch (error) {
      setNotice(
        error instanceof BridgeError
          ? error.message
          : "The host did not change the view.",
      )
    } finally {
      setPending(undefined)
    }
  }

  if (connection.status === "failed") {
    return (
      <p className="app-status" role="alert">
        {describeFailure(connection.failure)}
      </p>
    )
  }
  if (
    connection.status === "idle" ||
    connection.status === "connecting" ||
    connection.status === "tearing-down"
  ) {
    return <p className="app-status">Connecting…</p>
  }
  if (connection.status === "torn-down") {
    return <p className="app-status">{connection.reason ?? "This view was closed."}</p>
  }
  if (loaded.status === "waiting") {
    return (
      <p className="app-status" role="status">
        Loading the experiment…
      </p>
    )
  }
  if (loaded.status === "cancelled") {
    return <p className="app-status">{loaded.reason}</p>
  }
  if (loaded.status === "failed") {
    return (
      <p className="app-status" role="alert">
        {loaded.message}
      </p>
    )
  }

  return (
    <div className="experiment">
      <div hidden={fullscreen ? true : undefined}>
        <ExperimentCard
          experiment={loaded.experiment}
          onOpen={() => void ask("fullscreen")}
          pending={pending === "fullscreen"}
          notice={fullscreen ? undefined : notice}
        />
      </div>
      <div hidden={fullscreen ? undefined : true}>
        <ExperimentSurface
          experiment={loaded.experiment}
          active={fullscreen}
          open={open}
          schedule={schedule}
          onInline={() => void ask("inline")}
          inlinePending={pending === "inline"}
          notice={fullscreen ? notice : undefined}
        />
      </div>
    </div>
  )
}
