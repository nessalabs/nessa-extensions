/**
 * The file window for a run's change, and the props `ChangeView` draws.
 * The query, the scroll position and which rows are mounted live here. The
 * view paints the slice it is given. Opening a file is `useOpenFile`.
 */
import { useEffect, useMemo, useState } from "react"

import { visibleRange } from "./geometry.ts"
import type { ChangeViewProps } from "./change-view.tsx"
import type { Opening } from "./open-file.ts"
import { changeRead } from "./reading.ts"
import { useOpenFile, type OpenRequest, type Schedule } from "./use-open-file.ts"
import type { Experiment, Run } from "../model/index.ts"

const rowHeight = 36
const viewport = 320
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
  useEffect(() => {
    setQuery("")
    setScrollTop(0)
  }, [runId])

  const files = useMemo(() => {
    if (read === undefined) return []
    const needle = query.trim().toLowerCase()
    if (needle === "") return read.files
    return read.files.filter((file) => file.path.toLowerCase().includes(needle))
  }, [read, query])

  if (read === undefined || run === undefined) return undefined
  const range = visibleRange(scrollTop, viewport, rowHeight, files.length, overscan)
  return {
    summary: read.summary,
    added: read.added,
    removed: read.removed,
    files: files.slice(range.start, range.end),
    total: files.length,
    start: range.start,
    rowHeight,
    viewport,
    query,
    listKey: `${run.id}:${query}`,
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
