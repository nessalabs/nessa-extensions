/**
 * A run's change: the summary, how many lines moved, and the files. `VirtualList`
 * windows the rows, so a change of ten thousand files does not mount them.
 * Opening a file, or the whole change, is the state `useOpenFile` already
 * decided; this view only shows it.
 */
import { VirtualList } from "./kit-stand-in/index.ts"
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
  readonly query: string
  readonly listKey: string
  readonly onQuery: (query: string) => void
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
  query,
  listKey,
  onQuery,
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
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            onQuery("")
          }}
        />
      </label>
      <VirtualList
        key={listKey}
        className="change-scroll"
        items={files}
        getKey={(file) => file.key}
        rowHeight={36}
        height={320}
        overscan={6}
      >
        {(file) => {
          const state = shownFor(file.path)
          return (
            <div className="change-file" style={{ height: 36 }}>
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
            </div>
          )
        }}
      </VirtualList>
    </section>
  )
}
