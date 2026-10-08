/**
 * The file list for a run's change, and the props `ChangeView` draws.
 * The query lives here. `VirtualList` windows the rows. Opening a file is
 * `useOpenFile`.
 */
import { useMemo, useState } from "react"

import type { ChangeViewProps } from "./change-view.tsx"
import type { Opening } from "./open-file.ts"
import { changeRead } from "./reading.ts"
import { useOpenFile, type OpenRequest, type Schedule } from "./use-open-file.ts"
import type { Experiment, Run } from "../model/index.ts"

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
  const runId = run?.id
  const [tracked, setTracked] = useState(runId)
  // Reset in this render. An effect would filter the new run with the old
  // query for the frame before it ran.
  if (tracked !== runId) {
    setTracked(runId)
    setQuery("")
  }
  const activeQuery = tracked !== runId ? "" : query

  const files = useMemo(() => {
    if (read === undefined) return []
    const needle = activeQuery.trim().toLowerCase()
    if (needle === "") return read.files
    return read.files.filter((file) => file.path.toLowerCase().includes(needle))
  }, [read, activeQuery])

  if (read === undefined || run === undefined) return undefined
  return {
    summary: read.summary,
    added: read.added,
    removed: read.removed,
    files,
    query: activeQuery,
    listKey: `${run.id}:${activeQuery}`,
    onQuery: setQuery,
    changeShown: opening.shown({ kind: "change" }),
    shownFor: (path) => opening.shown({ kind: "file", path }),
    onOpenFile: (path) => opening.click({ kind: "file", path }),
    onOpenChange: () => opening.click({ kind: "change" }),
  }
}
