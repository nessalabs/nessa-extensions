/**
 * The exploration map: one column per area, every run in its area, and the
 * thread through the best-so-far runs in order. No areas, nothing drawn.
 */
import type { Ref } from "react"

import { ChartCard } from "./stand-in.tsx"
import type { Outcome, Tone } from "../model/index.ts"
import "./exploration-map.css"

export interface MapColumnProps {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly ink: string
}

export interface MapDotProps {
  readonly runId: string
  readonly x: number
  readonly y: number
  readonly number: number
  readonly verdict: string
  readonly tone: Tone
  readonly outcome: Outcome
  readonly ink: string
  readonly area: string
}

export interface ExplorationMapProps {
  readonly width: number
  readonly height: number
  readonly columns: readonly MapColumnProps[]
  readonly dots: readonly MapDotProps[]
  readonly thread: string
  readonly hover?: MapDotProps
  readonly card?: { readonly left: number; readonly top: number }
  readonly cardRef: Ref<HTMLDivElement>
  readonly onHover: (runId: string | undefined) => void
  readonly onPick?: (runId: string) => void
}

export function ExplorationMap({
  width,
  height,
  columns,
  dots,
  thread,
  hover,
  card,
  cardRef,
  onHover,
  onPick,
}: ExplorationMapProps) {
  if (columns.length === 0) return null
  return (
    <div className="map" style={{ width, height }}>
      <svg className="map-svg" width={width} height={height} aria-hidden="true">
        {columns.map((column) => (
          <line
            key={column.id}
            className="map-column"
            x1={column.x}
            x2={column.x}
            y1={24}
            y2={height - 16}
          />
        ))}
        {thread === "" ? null : <path className="map-thread" d={thread} />}
      </svg>
      {columns.map((column) => (
        <span
          key={column.id}
          className="map-name"
          style={{ left: column.x, color: column.ink }}
        >
          {column.name}
        </span>
      ))}
      {dots.map((dot) => (
        <button
          key={dot.runId}
          type="button"
          className="map-dot"
          data-outcome={dot.outcome}
          style={{ left: dot.x, top: dot.y, color: dot.ink }}
          aria-label={`${dot.area} #${dot.number} ${dot.verdict}`}
          onPointerEnter={() => onHover(dot.runId)}
          onFocus={() => onHover(dot.runId)}
          onPointerLeave={() => onHover(undefined)}
          onBlur={() => onHover(undefined)}
          onClick={() => onPick?.(dot.runId)}
        />
      ))}
      {hover === undefined || card === undefined ? null : (
        <ChartCard left={card.left} top={card.top} cardRef={cardRef}>
          <p className="map-card-title">
            #{hover.number} {hover.verdict}
          </p>
          <p className="map-card-area">{hover.area}</p>
        </ChartCard>
      )}
    </div>
  )
}
