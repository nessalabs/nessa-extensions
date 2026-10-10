/**
 * The runs, in the order the list arrived. The filters stay put; the list
 * has its own height and scrolls inside it. This view holds no state: the
 * filter and the list arrive as props.
 */
import { countLabel } from "./count.ts"
import { Delta } from "./kit-stand-in/index.ts"
import { PageHeading } from "./page-heading.tsx"
import type { RunRow } from "./page-reading.ts"
import type { VerdictRead } from "./reading.ts"
import { VerdictLabel } from "./verdict-label.tsx"
import "./pages.css"

function omittedNote(count: number): string {
  return `${countLabel(count, { one: "run", other: "runs" })} could not be shown`
}

export function RunsView({
  title,
  subtitle,
  verdicts,
  selected,
  onSelect,
  rows,
  onOpenRun,
  runsOpenable,
  omitted,
  status,
  message,
}: {
  readonly title: string
  readonly subtitle?: string
  readonly verdicts: readonly VerdictRead[]
  readonly selected?: string
  readonly onSelect: (verdictId: string | undefined) => void
  readonly rows: readonly RunRow[]
  readonly onOpenRun: (runId: string) => void
  /** A row may be opened. False while the next snapshot is still loading. */
  readonly runsOpenable: boolean
  /** Listed runs this experiment could not draw. */
  readonly omitted: number
  readonly status: "idle" | "loading" | "ready" | "failed"
  readonly message?: string
}) {
  const shown =
    selected === undefined ? rows : rows.filter((row) => row.verdictId === selected)
  return (
    <div className="page">
      <PageHeading title={title} subtitle={subtitle} />
      <div className="runs-filters" role="group" aria-label="Filter by verdict">
        <button
          type="button"
          aria-pressed={selected === undefined}
          onClick={() => onSelect(undefined)}
        >
          All
        </button>
        {verdicts.map((verdict) => (
          <button
            key={verdict.id}
            type="button"
            aria-pressed={selected === verdict.id}
            onClick={() => onSelect(verdict.id)}
          >
            {verdict.label}
          </button>
        ))}
      </div>
      {status === "loading" || status === "idle" ? (
        <p className="page-status" role="status">
          Loading runs…
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="page-status" role="alert">
          {message}
        </p>
      ) : null}
      {status === "ready" && !runsOpenable ? (
        <p className="page-status" role="status">
          Loading the next experiment…
        </p>
      ) : null}
      {status === "ready" && omitted > 0 ? (
        <p className="page-status">{omittedNote(omitted)}</p>
      ) : null}
      {status === "ready" ? (
        <div className="runs-scroll" tabIndex={0} aria-label="Runs">
          {shown.length === 0 ? (
            <p className="page-status">No runs.</p>
          ) : (
            <ul className="run-list">
              {shown.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={!runsOpenable}
                    onClick={() => onOpenRun(row.id)}
                  >
                    <span className="run-number">Run {row.number}</span>
                    <VerdictLabel label={row.verdict} tone={row.tone} />
                    {row.score === undefined ? null : (
                      <span className="run-score">{row.score}</span>
                    )}
                    {row.change === undefined ? null : (
                      <Delta
                        value={row.change.value}
                        tone={row.change.tone}
                        format={() => row.change?.size ?? ""}
                      />
                    )}
                    {row.area === undefined ? null : (
                      <span className="run-area">{row.area}</span>
                    )}
                    <span className="run-reason">{row.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
