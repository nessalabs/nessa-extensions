/**
 * Stand-ins for the nessa_ui primitives these views draw with, until
 * `@nessalabs/ui` is on npm (nessalabs/nessa_ui#115). Each one follows that
 * package's contract for the part the views use, and nothing else:
 *
 * - `Delta` adds the sign and does not judge. `format` is called with the
 *   absolute value, never a negative and never `-0`. The digits are whatever
 *   `format` returns, which for a metric is `Change.size` from `metric.ts`.
 * - `StatusLabel` is a mark and a word. The word is the verdict's label; the
 *   tone is the verdict's tone. The mark is decorative.
 * - `Stat` is a formatted figure, an optional delta, and a caption.
 * - `Meter` fills a fraction the caller computed. It does not judge it.
 * - `ProportionBar` sizes segments by their share of the positive values.
 * - `ChartCard` is the hover card, already placed by `placeCard`.
 *
 * When the package publishes, these are replaced by its exports and this
 * file goes. The views' props do not change.
 */
import type { ReactNode, Ref } from "react"

import type { Area } from "../model/index.ts"
import type { ChangeTone } from "../model/index.ts"
import type { Tone } from "../model/index.ts"
import "./tokens.css"
import "./stand-in.css"

const minus = "\u2212"

const series = {
  1: "var(--nessa-chart-series-1)",
  2: "var(--nessa-chart-series-2)",
  3: "var(--nessa-chart-series-3)",
  4: "var(--nessa-chart-series-4)",
  5: "var(--nessa-chart-series-5)",
} as const satisfies Record<Area["hue"], string>

const seriesStrong = {
  1: "var(--nessa-chart-series-1-strong)",
  2: "var(--nessa-chart-series-2-strong)",
  3: "var(--nessa-chart-series-3-strong)",
  4: "var(--nessa-chart-series-4-strong)",
  5: "var(--nessa-chart-series-5-strong)",
} as const satisfies Record<Area["hue"], string>

/** The series ink for an area's hue. `strong` is the step a thin bar uses. */
export function seriesInk(hue: Area["hue"], strong = false): string {
  return strong ? seriesStrong[hue] : series[hue]
}

export function Delta({
  value,
  format,
  tone = "neutral",
}: {
  value: number
  format: (size: number) => string
  tone?: ChangeTone
}) {
  const sign = value > 0 ? "+" : value < 0 ? minus : ""
  return (
    <span dir="ltr" data-slot="delta" data-tone={tone} className="delta">
      {sign}
      {format(Math.abs(value))}
    </span>
  )
}

function Mark({ tone }: { tone: Tone }) {
  if (tone === "good") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.2 6.2 4.8 8.8 9.8 3.2" />
      </svg>
    )
  }
  if (tone === "bad") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 3l6 6M9 3 3 9" />
      </svg>
    )
  }
  if (tone === "warning") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.8 11 10.2H1L6 1.8z" />
      </svg>
    )
  }
  if (tone === "active") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="2.2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6h7" />
    </svg>
  )
}

export function StatusLabel({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span data-slot="status-label" data-tone={tone} className="status">
      <span aria-hidden="true" data-slot="status-label-mark" className="status-mark">
        <Mark tone={tone} />
      </span>
      <span data-slot="status-label-word" className="status-word">
        {children}
      </span>
    </span>
  )
}

export function Stat({
  value,
  delta,
  caption,
}: {
  value: ReactNode
  delta?: ReactNode
  caption: string
}) {
  return (
    <div data-slot="stat" className="stat">
      <span data-slot="stat-caption" className="stat-caption">
        {caption}
      </span>
      <span data-slot="stat-figure" className="stat-figure">
        <span data-slot="stat-value" className="stat-value">
          {value}
        </span>
        {delta}
      </span>
    </div>
  )
}

/** `value` is a fraction from 0 to 1. Anything else reads as empty or full. */
export function Meter({
  value,
  valueText,
  tone = "neutral",
}: {
  value: number
  valueText: string
  tone?: "neutral" | "good" | "bad"
}) {
  const filled = !Number.isFinite(value) ? 0 : Math.min(1, Math.max(0, value))
  return (
    <span
      data-slot="meter"
      data-tone={tone}
      className="meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(filled * 100)}
      aria-valuetext={valueText}
    >
      <span className="meter-fill" style={{ width: `${filled * 100}%` }} />
    </span>
  )
}

export function ProportionBar({
  segments,
  label,
}: {
  segments: readonly {
    readonly id: string
    readonly width: number
    readonly ink: string
  }[]
  label: string
}) {
  return (
    <div data-slot="proportion-bar" className="bar" role="img" aria-label={label}>
      {segments.map((segment) => (
        <span
          key={segment.id}
          className="bar-segment"
          style={{ width: `${segment.width * 100}%`, background: segment.ink }}
        />
      ))}
    </div>
  )
}

/** Shares of the positive values, in order, summing to 1. A non-positive value weighs 0. */
export function shares(values: readonly number[]): readonly number[] {
  const positive = values.map((value) =>
    Number.isFinite(value) && value > 0 ? value : 0,
  )
  const total = positive.reduce((sum, value) => sum + value, 0)
  if (total === 0) return positive.map(() => 0)
  return positive.map((value) => value / total)
}

export function ChartCard({
  left,
  top,
  cardRef,
  children,
}: {
  left: number
  top: number
  cardRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div
      data-slot="chart-tooltip"
      role="tooltip"
      ref={cardRef}
      className="chart-card"
      style={{ left, top }}
    >
      {children}
    </div>
  )
}
