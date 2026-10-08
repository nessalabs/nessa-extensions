/**
 * The open-file table, driven. `open` is the port — #7 calls the server's
 * `open_file` and maps its answer — and `schedule` is the clock, so a test
 * fires the four seconds itself. A rejection from the port is a refusal too:
 * every click settles, and the view shows the sentence rather than waiting.
 */
import { useEffect, useRef, useState } from "react"

import {
  answer,
  click as ask,
  elapsed,
  openFileMachine,
  refusalFor,
  shown,
  targetId,
  type Opening,
  type Shown,
  type Target,
} from "./open-file.ts"

export interface OpenRequest {
  readonly experimentId: string
  readonly runId: string
  readonly path?: string
}

export interface Schedule {
  /** Runs `run` after `ms`, and returns a function that cancels it. */
  after(ms: number, run: () => void): () => void
}

const unsettled: Opening = { kind: "refused", reason: "Couldn't open this." }

export function useOpenFile(options: {
  experimentId: string
  runId: string
  open: (request: OpenRequest) => Promise<Opening>
  schedule: Schedule
}): {
  readonly shown: (target: Target) => Shown
  readonly click: (target: Target) => void
} {
  const machine = useRef(openFileMachine())
  const timers = useRef(new Map<string, () => void>())
  const generation = useRef(0)
  const mounted = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [, setVersion] = useState(0)
  const identity = `${options.experimentId}\0${options.runId}`
  const [tracked, setTracked] = useState(identity)
  // A new run is idle in this render. An answer still in flight no longer
  // matches the generation it was asked in. Cancelling its timer is a side
  // effect, so the effect keyed on this identity does that.
  if (tracked !== identity) {
    setTracked(identity)
    generation.current += 1
    machine.current = openFileMachine()
  }
  const commit = (next: ReturnType<typeof openFileMachine>) => {
    machine.current = next
    setVersion((version) => version + 1)
  }

  const settle = (target: Target, request: number, opening: Opening, born: number) => {
    if (!mounted.current || born !== generation.current) return
    const next = answer(machine.current, target, request, opening)
    if (next === machine.current) return
    commit(next)
    if (opening.kind !== "refused") return
    const id = targetId(target)
    const cancel = optionsRef.current.schedule.after(refusalFor, () => {
      timers.current.delete(id)
      if (!mounted.current || born !== generation.current) return
      const cleared = elapsed(machine.current, target, request)
      if (cleared !== machine.current) commit(cleared)
    })
    timers.current.set(id, cancel)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const cancel of timers.current.values()) cancel()
      timers.current.clear()
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const cancel of timers.current.values()) cancel()
      timers.current.clear()
    }
  }, [identity])

  const click = (target: Target) => {
    const id = targetId(target)
    timers.current.get(id)?.()
    timers.current.delete(id)
    const asked = ask(machine.current, target)
    const born = generation.current
    commit(asked.machine)
    const { experimentId, runId, open } = optionsRef.current
    const path = target.kind === "file" ? target.path : undefined
    void open({ experimentId, runId, ...(path === undefined ? {} : { path }) }).then(
      (opening) => settle(target, asked.request, opening, born),
      () => settle(target, asked.request, unsettled, born),
    )
  }

  return { shown: (target) => shown(machine.current, target), click }
}
