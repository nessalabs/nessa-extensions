/**
 * The overview: the best version, the climb, the path to it (`bestSoFar` in
 * order), the swarm now, and the harness's notes. A section with nothing
 * to show is omitted. This view holds no state.
 */
import { Delta } from "./kit-stand-in/index.ts"
import { ClimbChart, type ClimbChartProps } from "./climb-chart.tsx"
import { PageHeading } from "./page-heading.tsx"
import type { Headline, NoteRead, PathStepRead, SwarmRead } from "./page-reading.ts"
import "./pages.css"

export function Overview({
  title,
  subtitle,
  headline,
  climb,
  path,
  swarm,
  notes,
  onOpenRun,
}: {
  readonly title: string
  readonly subtitle?: string
  readonly headline: Headline
  readonly climb: ClimbChartProps
  readonly path: readonly PathStepRead[]
  readonly swarm: readonly SwarmRead[]
  readonly notes: readonly NoteRead[]
  readonly onOpenRun: (runId: string) => void
}) {
  return (
    <div className="page">
      <PageHeading title={title} subtitle={subtitle} />
      <section className="page-section" aria-label={headline.title}>
        <p className="headline">
          {headline.value === undefined ? null : (
            <span className="headline-value">{headline.value}</span>
          )}
          {headline.change === undefined ? null : (
            <Delta
              value={headline.change.value}
              tone={headline.change.tone}
              format={() => headline.change?.size ?? ""}
            />
          )}
        </p>
        <p className="headline-caption">
          {headline.subtitle}
          {headline.from === undefined ? null : ` · from ${headline.from}`}
          {` · ${headline.kept}`}
        </p>
      </section>
      <ClimbChart {...climb} onOpen={onOpenRun} />
      {path.length === 0 ? null : (
        <section className="page-section" aria-labelledby="path-title">
          <h3 id="path-title" className="section-title">
            Path to the best
          </h3>
          <ol className="path" aria-label="Path to the best">
            {path.map((step) => (
              <li key={step.runId}>
                <button type="button" onClick={() => onOpenRun(step.runId)}>
                  <span className="path-run">Run {step.number}</span>
                  <span className="path-label">{step.label}</span>
                </button>
                {step.gain === undefined ? null : (
                  <Delta
                    value={step.gain.value}
                    tone={step.gain.tone}
                    format={() => step.gain?.size ?? ""}
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {swarm.length === 0 ? null : (
        <section className="page-section" aria-labelledby="swarm-title">
          <h3 id="swarm-title" className="section-title">
            Swarm
          </h3>
          <ul className="swarm">
            {swarm.map((agent) => {
              const runId = agent.runId
              return (
                <li key={agent.id}>
                  <span className="swarm-name">{agent.name}</span>
                  {runId === undefined ? (
                    <span className="swarm-detail">{agent.detail}</span>
                  ) : (
                    <button type="button" onClick={() => onOpenRun(runId)}>
                      {agent.detail}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {notes.length === 0 ? null : (
        <section className="page-section" aria-labelledby="notes-title">
          <h3 id="notes-title" className="section-title">
            Notes
          </h3>
          <ul className="notes">
            {notes.map((note) => {
              const runId = note.runId
              return (
                <li key={note.key} data-tone={note.tone}>
                  {runId === undefined ? (
                    note.text
                  ) : (
                    <button type="button" onClick={() => onOpenRun(runId)}>
                      {note.text}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
