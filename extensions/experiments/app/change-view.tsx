/**
 * A run's change: the summary, how many lines moved, and the files. The list
 * shows the window it is given, so a change of ten thousand files does not
 * mount them. Opening a file, or the whole change, is the state `useOpenFile`
 * already decided; this view only shows it.
 */
import type { Ref } from "react"

import type { ChangeFileRead } from "./reading.ts"
import type { Shown } from "./open-file.ts"
import "./change-view.css"

const minus = "\u2212"

const statusWord = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
} as const satisfies Record<ChangeFileRead["status"], string>

export interface ChangeViewProps {
  readonly summary: string
  readonly added: string
  readonly removed: string
  readonly files: readonly ChangeFileRead[]
  readonly total: number
  readonly start: number
  readonly rowHeight: number
  readonly scrollRef: Ref<HTMLDivElement>
  readonly query: string
  readonly listKey: string
  readonly onQuery: (query: string) => void
  readonly onScroll: (scrollTop: number) => void
  readonly changeShown: Shown
  readonly shownFor: (path: string) => Shown
  readonly onOpenFile: (path: string) => void
  readonly onOpenChange: () => void
}

function refusal(shown: Shown) {
  return shown.status === "refused" ? (
    <span className="change-refusal" role="status" title={shown.reason}>
      {shown.reason}
    </span>
  ) : null
}

export function ChangeView({
  summary,
  added,
  removed,
  files,
  total,
  start,
  rowHeight,
  scrollRef,
  query,
  listKey,
  onQuery,
  onScroll,
  changeShown,
  shownFor,
  onOpenFile,
  onOpenChange,
}: ChangeViewProps) {
  return (
    <section className="change">
      <header className="change-header">
        <h3 className="change-summary">{summary}</h3>
        <p className="change-stat">
          <span className="change-added">+{added}</span>
          <span className="change-removed">
            {minus}
            {removed}
          </span>
        </p>
        <button type="button" className="change-open" onClick={onOpenChange}>
          Open change
        </button>
        {refusal(changeShown)}
      </header>
      <label className="change-find">
        <span className="change-find-label">Find a file</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} />
      </label>
      <div
        key={listKey}
        ref={scrollRef}
        className="change-scroll"
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        <div style={{ height: total * rowHeight }}>
          <ul
            className="change-files"
            style={{ transform: `translateY(${start * rowHeight}px)` }}
          >
            {files.map((file) => {
              const state = shownFor(file.path)
              return (
                <li key={file.key} className="change-file" style={{ height: rowHeight }}>
                  <span className="change-status">{statusWord[file.status]}</span>
                  <span className="change-path">{file.path}</span>
                  <span className="change-lines">
                    <span className="change-added">+{file.added}</span>
                    <span className="change-removed">
                      {minus}
                      {file.removed}
                    </span>
                  </span>
                  <span className="change-action">
                    <button
                      type="button"
                      className="change-open"
                      onClick={() => onOpenFile(file.path)}
                    >
                      Open
                    </button>
                    {refusal(state)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}
