/**
 * A run's cases: the fixed and broken shares, each slice's passing fraction,
 * and the page of cases that moved. The noun and the counts arrive already
 * written. No cases, nothing to mount — the parent omits it.
 */
import { Meter, ProportionBar, shares } from "./stand-in.tsx"
import type { CaseResultsRead } from "./reading.ts"
import "./case-results.css"

const segmentInk = {
  fixed: "var(--nessa-chart-series-1-strong)",
  broken: "var(--nessa-chart-series-2-strong)",
  unchanged: "color-mix(in oklab, var(--foreground) 16%, transparent)",
} as const

export function CaseResults({
  fixed,
  broken,
  barLabel,
  segments,
  slices,
  moved,
}: CaseResultsRead) {
  const widths = shares(segments.map((segment) => segment.value))
  return (
    <section className="cases">
      <ProportionBar
        label={barLabel}
        segments={segments.map((segment, index) => ({
          id: segment.id,
          width: widths[index] ?? 0,
          ink: segmentInk[segment.id],
        }))}
      />
      <p className="cases-summary">
        <span>{fixed}</span>
        <span>{broken}</span>
      </p>
      <ul className="cases-slices">
        {slices.map((slice) => (
          <li key={slice.name}>
            <span className="cases-slice-name">{slice.name}</span>
            <Meter value={slice.filled} valueText={slice.text} />
            <span className="cases-slice-text">{slice.text}</span>
          </li>
        ))}
      </ul>
      {moved.length === 0 ? null : (
        <ul className="cases-moved">
          {moved.map((item) => (
            <li key={item.id}>
              <span className="cases-move" data-move={item.move}>
                {item.move}
              </span>
              <span>{item.title}</span>
              <span className="cases-moved-slice">{item.slice}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
