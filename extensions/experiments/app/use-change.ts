/**
 * The file window for a run's change, and the props `ChangeView` draws.
 * The query, the scroll position and which rows are mounted live here. The
 * view paints the slice it is given. Opening a file is `useOpenFile`.
 */
import { useCallback, useMemo, useRef, useState } from "react"

import { visibleRange } from "./geometry.ts"
import type { ChangeViewProps } from "./change-view.tsx"
import type { Opening } from "./open-file.ts"
import { changeRead } from "./reading.ts"
import { useOpenFile, type OpenRequest, type Schedule } from "./use-open-file.ts"
import type { Experiment, Run } from "../model/index.ts"

const rowHeight = 36
const overscan = 6

export function useChangeView(options: {
  experiment: Experiment
  run: Run | undefined
  open: (request: OpenRequest) => Promise<Opening>
  schedule: Schedule
}): ChangeViewProps | undefined {
  const { experiment, run, open, schedule } = options
  const read = useMemo(() => (run === undefined ? undefined : changeRead(run)), [run])
  const opening = useOpenFile({
    experimentId: experiment.id,
    runId: run?.id ?? "",
    open,
    schedule,
  })
  const [query, setQuery] = useState("")
  const [scrollTop, setScrollTop] = useState(0)
  const runId = run?.id
  const [tracked, setTracked] = useState(runId)
  // Reset in this render. An effect would filter the new run with the old
  // query for the frame before it ran.
  if (tracked !== runId) {
    setTracked(runId)
    setQuery("")
    setScrollTop(0)
  }
  const activeQuery = tracked !== runId ? "" : query
  const activeScroll = tracked !== runId ? 0 : scrollTop
  const [viewport, setViewport] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (node === null) return
    const measure = () => {
      const next = node.clientHeight
      setViewport((current) => (current === next ? current : next))
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const watching = new ResizeObserver(measure)
    watching.observe(node)
    observer.current = watching
  }, [])

  const files = useMemo(() => {
    if (read === undefined) return []
    const needle = activeQuery.trim().toLowerCase()
    if (needle === "") return read.files
    return read.files.filter((file) => file.path.toLowerCase().includes(needle))
  }, [read, activeQuery])

  if (read === undefined || run === undefined) return undefined
  const range = visibleRange(activeScroll, viewport, rowHeight, files.length, overscan)
  return {
    summary: read.summary,
    added: read.added,
    removed: read.removed,
    files: files.slice(range.start, range.end),
    total: files.length,
    start: range.start,
    rowHeight,
    scrollRef,
    query: activeQuery,
    listKey: `${run.id}:${activeQuery}`,
    onQuery: (next) => {
      setQuery(next)
      setScrollTop(0)
    },
    onScroll: setScrollTop,
    changeShown: opening.shown({ kind: "change" }),
    shownFor: (path) => opening.shown({ kind: "file", path }),
    onOpenFile: (path) => opening.click({ kind: "file", path }),
    onOpenChange: () => opening.click({ kind: "change" }),
  }
}
