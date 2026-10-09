/**
 * The experiment inline: where it stands, the best-so-far line, and enough
 * of the swarm to decide whether to look. Opening it asks the host for
 * fullscreen; this view does not assume the host agreed.
 */
import { useMemo } from "react"

import { Delta } from "./kit-stand-in/index.ts"
import { climb } from "../model/index.ts"
import type { Experiment } from "../model/index.ts"
import { areaGains, headline, swarmNow } from "./page-reading.ts"
import { sparkline } from "./sparkline.ts"
import { Sparkline } from "./sparkline.tsx"
import { useElementWidth } from "./use-measure.ts"
import "./card.css"

const sparkHeight = 56

export function ExperimentCard({
  experiment,
  onOpen,
  pending,
  notice,
}: {
  readonly experiment: Experiment
  readonly onOpen: () => void
  readonly pending: boolean
  readonly notice?: string
}) {
  const [frame, width] = useElementWidth<HTMLElement>(320)
  const head = useMemo(() => headline(experiment), [experiment])
  const gains = useMemo(() => areaGains(experiment), [experiment])
  const swarm = useMemo(() => swarmNow(experiment), [experiment])
  const line = useMemo(
    () =>
      sparkline(
        climb(experiment).best.map((step) => ({ at: step.at, value: step.value })),
        width,
        sparkHeight,
      ),
    [experiment, width],
  )
  const leading = swarm.find((agent) => agent.runId !== undefined)
  return (
    <article ref={frame} className="card" aria-label={experiment.title}>
      <header className="card-header">
        <p className="card-kicker">Experiment</p>
        <h1 className="card-title">{experiment.title}</h1>
        <p className="card-goal">{experiment.goal}</p>
      </header>
      <p className="headline">
        {head.value === undefined ? null : (
          <span className="headline-value">{head.value}</span>
        )}
        {head.change === undefined ? null : (
          <Delta
            value={head.change.value}
            tone={head.change.tone}
            format={() => head.change?.size ?? ""}
          />
        )}
      </p>
      <p className="headline-caption">
        {head.title} · {head.subtitle}
        {head.from === undefined ? null : ` · from ${head.from}`}
        {` · ${head.kept}`}
      </p>
      <Sparkline {...line} />
      {gains.length === 0 ? null : (
        <ul className="card-gains" aria-label="Areas">
          {gains.map((gain) => (
            <li key={gain.id}>
              <span>{gain.name}</span>
              <span>{gain.score}</span>
              {gain.change === undefined ? null : (
                <Delta
                  value={gain.change.value}
                  tone={gain.change.tone}
                  format={() => gain.change?.size ?? ""}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {swarm.length === 0 ? null : (
        <p className="card-swarm">
          {leading === undefined
            ? "The swarm is between runs."
            : `${leading.name} · ${leading.detail}`}
        </p>
      )}
      <button type="button" className="card-open" onClick={onOpen} disabled={pending}>
        Open experiment
      </button>
      {notice === undefined ? null : (
        <p className="card-notice" role="status">
          {notice}
        </p>
      )}
    </article>
  )
}
