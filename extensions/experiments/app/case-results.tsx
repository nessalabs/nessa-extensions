/**
 * A run's cases: the fixed and broken shares, each slice's passing fraction,
 * and the page of cases that moved. The noun and the counts arrive already
 * written. No cases, nothing to mount — the parent omits it.
 */
import { Meter, ProportionBar } from "./kit-stand-in/index.ts"
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
  return (
    <section className="cases">
      <ProportionBar
        aria-label={barLabel}
        formatValue={(value) => String(value)}
        segments={segments.map((segment) => ({
          id: segment.id,
          label: segment.label,
          value: segment.value,
          color: segmentInk[segment.id],
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
            <Meter label={slice.name} value={slice.filled} valueText={slice.text} />
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
