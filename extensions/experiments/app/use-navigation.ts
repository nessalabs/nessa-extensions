/**
 * The experiment's navigation, and Escape. Escape closes the run on screen
 * and leaves focus on the experiment. It does not leave the view: with no
 * run open it does nothing, so a host that shows this fullscreen keeps it.
 * The trail is `navigation.ts`; this hook only drives it.
 */
import { useEffect, useRef, useState } from "react"

import {
  closeRuns,
  followRun,
  navigation,
  openRun,
  popRun,
  selectView,
  trailThrough,
  type Navigation,
  type ViewId,
} from "./navigation.ts"

export function useExperimentNavigation(active: boolean): {
  readonly navigation: Navigation
  readonly surfaceRef: (node: HTMLElement | null) => void
  readonly detailRef: (node: HTMLElement | null) => void
  readonly select: (view: ViewId) => void
  readonly open: (runId: string) => void
  readonly follow: (runId: string) => void
  readonly pop: () => void
  readonly through: (index: number) => void
  readonly close: () => void
} {
  const [current, setCurrent] = useState(navigation)
  const surface = useRef<HTMLElement | null>(null)
  const detail = useRef<HTMLElement | null>(null)
  const trailKey = current.trail.join("\0")

  useEffect(() => {
    if (!active) return
    const target = current.trail.length === 0 ? surface.current : detail.current
    target?.focus()
  }, [active, trailKey, current.trail.length])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || current.trail.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setCurrent((now) => popRun(now))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active, current.trail.length])

  return {
    navigation: current,
    surfaceRef: (node) => {
      surface.current = node
    },
    detailRef: (node) => {
      detail.current = node
    },
    select: (view) => setCurrent((now) => selectView(now, view)),
    open: (runId) => setCurrent((now) => openRun(now, runId)),
    follow: (runId) => setCurrent((now) => followRun(now, runId)),
    pop: () => setCurrent((now) => popRun(now)),
    through: (index) => setCurrent((now) => trailThrough(now, index)),
    close: () => setCurrent((now) => closeRuns(now)),
  }
}
