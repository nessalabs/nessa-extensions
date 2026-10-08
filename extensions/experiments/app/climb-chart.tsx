/**
 * The climb. It draws the layout it is given: the best-so-far step line, the
 * noise band, the reference, and one point per settled run. Hover arrives as
 * props; `useClimbChart` owns it. The card places itself.
 */
import { margins } from "./geometry.ts"
import { ChartTooltip, Delta } from "./kit-stand-in/index.ts"
import type { Formatted, Tone } from "../model/index.ts"
import type { ScoreRead } from "./reading.ts"
import "./climb-chart.css"

export interface ClimbPointProps {
  readonly runId: string
  readonly x: number
  readonly y: number
  readonly number: number
  readonly verdict: string
  readonly tone: Tone
  readonly outcome: "kept" | "rejected" | "pending"
  readonly ink: string
}

export interface ClimbHover {
  readonly number: number
  readonly summary?: string
  readonly reason: string
  readonly verdict: string
  readonly tone: Tone
  readonly area?: string
  readonly agent?: string
  readonly scores: readonly ScoreRead[]
}

export interface ClimbChartProps {
  readonly title: string
  readonly caption: string
  readonly width: number
  readonly height: number
  readonly yTicks: readonly { readonly y: number; readonly label: Formatted }[]
  readonly xTicks: readonly { readonly x: number; readonly label: string }[]
  readonly points: readonly ClimbPointProps[]
  readonly best: string
  readonly band: string
  readonly reference?: {
    readonly y: number
    readonly label: string
    readonly value: Formatted
  }
  readonly hover?: ClimbHover
  readonly anchor?: { readonly x: number; readonly y: number }
  readonly onHover: (runId: string | undefined) => void
}

export function ClimbChart({
  title,
  caption,
  width,
  height,
  yTicks,
  xTicks,
  points,
  best,
  band,
  reference,
  hover,
  anchor,
  onHover,
}: ClimbChartProps) {
  return (
    <figure className="climb" style={{ width }}>
      <figcaption className="climb-caption">
        <span className="climb-title">{title}</span>
        <span className="climb-split">{caption}</span>
        {reference === undefined ? null : (
          <span className="climb-reference-label">
            {reference.label} {reference.value}
          </span>
        )}
      </figcaption>
      <div className="climb-plot" style={{ height }}>
        <svg
          className="climb-svg"
          width={width}
          height={height}
          role="img"
          aria-label={title}
        >
          {yTicks.map((tick) => (
            <g key={tick.y}>
              <line
                className="climb-grid"
                x1={margins.left}
                x2={width - margins.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text
                className="climb-tick"
                x={48}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text
              key={tick.x}
              className="climb-tick climb-tick-x"
              x={tick.x}
              y={height - 12}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          {band === "" ? null : <path className="climb-band" d={band} />}
          {reference === undefined ? null : (
            <line
              className="climb-reference"
              x1={margins.left}
              x2={width - margins.right}
              y1={reference.y}
              y2={reference.y}
            />
          )}
          {best === "" ? null : <path className="climb-best" d={best} />}
        </svg>
        {points.map((point) => (
          <button
            key={point.runId}
            type="button"
            className="climb-point"
            data-outcome={point.outcome}
            data-tone={point.tone}
            style={{ left: point.x, top: point.y, color: point.ink }}
            aria-label={`#${point.number} ${point.verdict}`}
            onPointerEnter={() => onHover(point.runId)}
            onFocus={() => onHover(point.runId)}
            onPointerLeave={() => onHover(undefined)}
            onBlur={() => onHover(undefined)}
          />
        ))}
        {hover === undefined || anchor === undefined ? null : (
          <ChartTooltip anchor={anchor}>
            <p className="climb-card-title">
              <span>#{hover.number}</span>
              <span data-tone={hover.tone}>{hover.verdict}</span>
            </p>
            {hover.summary === undefined ? null : <p>{hover.summary}</p>}
            <p className="climb-card-reason">{hover.reason}</p>
            {hover.area === undefined && hover.agent === undefined ? null : (
              <p className="climb-card-who">
                {hover.area}
                {hover.area !== undefined && hover.agent !== undefined ? " · " : ""}
                {hover.agent}
              </p>
            )}
            <ul className="climb-scores">
              {hover.scores.map((score) => (
                <li key={score.label}>
                  <span>{score.label}</span>
                  <span className="climb-score">{score.value}</span>
                  {score.change === undefined ? null : (
                    <Delta
                      value={score.change.value}
                      tone={score.change.tone}
                      format={() => score.change?.size ?? ""}
                    />
                  )}
                </li>
              ))}
            </ul>
          </ChartTooltip>
        )}
      </div>
    </figure>
  )
}
