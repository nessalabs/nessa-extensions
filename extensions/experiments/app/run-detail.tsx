/**
 * One run, over the view it was opened from: its outcome, its cases, its
 * change, and its lineage (the parent chain, the baseline first). A section
 * the run does not have is omitted. The breadcrumb walks the trail. This
 * view holds no state.
 */
import { Delta } from "./kit-stand-in/index.ts"
import { CaseResults } from "./case-results.tsx"
import { ChangeView, type ChangeViewProps } from "./change-view.tsx"
import type { CaseResultsRead } from "./reading.ts"
import type { GuardrailRead, LineageStep, OutcomeRead } from "./page-reading.ts"
import { VerdictLabel } from "./verdict-label.tsx"
import "./pages.css"

export function RunDetail({
  trailLabel,
  crumbs,
  current,
  onClose,
  outcome,
  cases,
  change,
  lineage,
  onFollow,
  status,
  message,
}: {
  /** The view the run was opened from, the first crumb. */
  readonly trailLabel: string
  readonly crumbs: readonly {
    readonly key: string
    readonly label: string
    readonly onSelect: () => void
  }[]
  readonly current: string
  readonly onClose: () => void
  readonly outcome?: OutcomeRead
  readonly cases?: CaseResultsRead
  readonly change?: ChangeViewProps
  readonly lineage?: readonly LineageStep[]
  readonly onFollow: (runId: string) => void
  readonly status: "loading" | "ready" | "failed"
  readonly message?: string
}) {
  return (
    <div className="page detail">
      <nav className="crumbs" aria-label="Opened run">
        <ol>
          <li>
            <button type="button" onClick={onClose}>
              {trailLabel}
            </button>
          </li>
          {crumbs.map((crumb) => (
            <li key={crumb.key}>
              <button type="button" onClick={crumb.onSelect}>
                {crumb.label}
              </button>
            </li>
          ))}
          <li>
            <span aria-current="page">{current}</span>
          </li>
        </ol>
      </nav>
      {status === "loading" ? (
        <p className="page-status" role="status">
          Loading this run…
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="page-status" role="alert">
          {message}
        </p>
      ) : null}
      {status === "ready" && outcome !== undefined ? (
        <article className="page-section" aria-labelledby="outcome-title">
          <header className="detail-outcome">
            <h2 id="outcome-title" className="page-title">
              Run {outcome.number}
            </h2>
            <VerdictLabel label={outcome.verdict} tone={outcome.tone} />
          </header>
          <p className="detail-reason">{outcome.reason}</p>
          {outcome.score === undefined ? null : (
            <p className="headline">
              <span className="headline-caption">{outcome.scoreLabel}</span>
              <span className="headline-value">{outcome.score}</span>
              {outcome.change === undefined ? null : (
                <Delta
                  value={outcome.change.value}
                  tone={outcome.change.tone}
                  format={() => outcome.change?.size ?? ""}
                />
              )}
            </p>
          )}
          {outcome.guardrails.length === 0 ? null : (
            <ul className="guardrails">
              {outcome.guardrails.map((guardrail) => (
                <Guardrail key={guardrail.id} guardrail={guardrail} />
              ))}
            </ul>
          )}
        </article>
      ) : null}
      {status === "ready" && cases !== undefined ? <CaseResults {...cases} /> : null}
      {status === "ready" && change !== undefined ? <ChangeView {...change} /> : null}
      {status === "ready" && lineage !== undefined && lineage.length > 0 ? (
        <section className="page-section" aria-labelledby="lineage-title">
          <h3 id="lineage-title" className="section-title">
            Lineage
          </h3>
          <ol className="lineage">
            {lineage.map((step) => {
              const runId = step.runId
              return (
                <li key={step.key} aria-current={step.current ? "step" : undefined}>
                  {runId === undefined || step.current ? (
                    <span>{step.label}</span>
                  ) : (
                    <button type="button" onClick={() => onFollow(runId)}>
                      {step.label}
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

function Guardrail({ guardrail }: { readonly guardrail: GuardrailRead }) {
  return (
    <li>
      <span>{guardrail.name}</span>
      {guardrail.value === undefined ? null : <span>{guardrail.value}</span>}
      <span className="guardrail-limit">{guardrail.limit}</span>
    </li>
  )
}
