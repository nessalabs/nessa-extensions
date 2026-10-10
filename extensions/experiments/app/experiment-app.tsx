/**
 * The experiment view. Inline, it is the card. Fullscreen, it is the
 * surface. The card asks for fullscreen with `ui/request-display-mode`, and
 * only after the host's context says that mode is offered. What is drawn
 * follows the mode the host applied to this view. A host that answers with
 * another mode — Nessa keeps this card inline and opens the full view as
 * its own view — is drawn as that mode, not told it failed.
 *
 * The experiment is the opening tool result, validated once per result.
 * When that result has no experiment, the app loads it with `get_experiment`.
 * Later reads go through `tools/call`, and only while this view is showing.
 */
import { useMemo, useState } from "react"

import { BridgeError, describeFailure } from "@nessalabs/app-shell"
import { useConnection, useDisplayMode, useToolCall } from "@nessalabs/app-shell/react"

import { ExperimentCard } from "./experiment-card.tsx"
import { loadExperiment } from "./host-data.ts"
import { ExperimentSurface } from "./surface.tsx"
import { useHostOpen, useRecoveredExperiment } from "./use-host.ts"
import type { Schedule } from "./use-open-file.ts"
import "./tokens.css"

const browserSchedule: Schedule = {
  after(ms, run) {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

export function ExperimentApp({
  schedule = browserSchedule,
}: { readonly schedule?: Schedule } = {}) {
  const connection = useConnection()
  const call = useToolCall()
  const { mode, available, request } = useDisplayMode()
  const open = useHostOpen()
  const [notice, setNotice] = useState<string | undefined>()
  const [pending, setPending] = useState<"fullscreen" | "inline" | undefined>()
  // `loadExperiment` returns a new copy. Memoizing on the result keeps that
  // copy across a display-mode render, so a run read does not start again.
  const phase = call.phase
  const result = call.phase === "complete" ? call.result : undefined
  const reason = call.phase === "cancelled" ? call.reason : undefined
  const opening = useMemo(() => loadExperiment(call), [call, phase, reason, result])
  const asked =
    call.phase === "running" || call.phase === "complete" || call.phase === "cancelled"
      ? call.input?.experimentId
      : undefined
  const experimentId = typeof asked === "string" && asked !== "" ? asked : undefined
  const recovered = useRecoveredExperiment(
    opening.status === "absent" ? experimentId : undefined,
    opening.status === "absent" ? result : undefined,
  )
  const loaded =
    opening.status === "absent"
      ? experimentId === undefined
        ? { status: "failed" as const, message: "The result has no experiment." }
        : recovered
      : opening
  const fullscreen = mode === "fullscreen"

  const ask = async (next: "fullscreen" | "inline") => {
    if (pending !== undefined) return
    if (available !== undefined && !available.includes(next)) {
      setNotice(
        next === "fullscreen"
          ? "This host doesn't offer a full view."
          : "This host doesn't offer an inline view.",
      )
      return
    }
    setPending(next)
    try {
      await request(next)
      setNotice(undefined)
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
