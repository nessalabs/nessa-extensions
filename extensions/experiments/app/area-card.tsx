/**
 * An area: its name and glyph, the state the harness last gave it, the
 * latest settled score, the runs, and the agents on it. `AreaCards` draws
 * one per area and nothing when there are none.
 */
import { Delta, Stat, StatusLabel } from "./kit-stand-in/index.ts"
import { seriesInk } from "./series.ts"
import type { AreaCardRead } from "./reading.ts"
import "./area-card.css"

export function AreaCard({
  name,
  glyph,
  hue,
  status,
  score,
  change,
  caption,
  runs,
  agents,
}: AreaCardRead) {
  const ink = seriesInk(hue)
  return (
    <article className="area">
      <header className="area-header">
        <svg
          className="area-glyph"
          viewBox="0 0 16 16"
          aria-hidden="true"
          style={{ color: ink }}
        >
          <path d={glyph} />
        </svg>
        <div className="area-heading">
          <h3 className="area-name">{name}</h3>
          {status === undefined ? null : (
            <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
          )}
        </div>
      </header>
      {score === undefined ? null : (
        <Stat
          caption={caption}
          value={score}
          delta={
            change === undefined ? undefined : (
              <Delta value={change.value} tone={change.tone} format={() => change.size} />
            )
          }
        />
      )}
      <ul className="area-runs" aria-label={name} style={{ color: ink }}>
        {runs.map((run) => (
          <li
            key={run.id}
            className="area-run"
            data-outcome={run.outcome}
            data-tone={run.tone}
            title={run.label}
          />
        ))}
      </ul>
      {agents.length === 0 ? null : (
        <ul className="area-agents">
          {agents.map((agent) => (
            <li key={agent.id}>
              <span className="area-agent">{agent.name}</span>
              {agent.status === undefined ? null : (
                <StatusLabel tone={agent.status.tone}>{agent.status.label}</StatusLabel>
              )}
              {agent.note === undefined ? null : (
                <span className="area-note">{agent.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

export function AreaCards({ cards }: { readonly cards: readonly AreaCardRead[] }) {
  if (cards.length === 0) return null
  return (
    <div className="areas">
      {cards.map((card) => (
        <AreaCard key={card.id} {...card} />
      ))}
    </div>
  )
}
