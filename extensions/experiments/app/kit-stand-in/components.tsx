import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react"

import {
  intersectChartRects,
  placeChartTooltip,
  proportionWeights,
  type ChartRect,
  type ChartTooltipSide,
  type ProportionWeighting,
} from "./chart-geometry.ts"
import "../tokens.css"
import "./stand-in.css"

const minus = "\u2212"

export type DeltaTone = "good" | "bad" | "neutral"

export interface DeltaProps extends Omit<ComponentProps<"span">, "children"> {
  value: number
  format: (size: number) => string
  tone?: DeltaTone
}

export function Delta({
  className,
  value,
  format,
  tone = "neutral",
  ...props
}: DeltaProps) {
  const sign = value > 0 ? "+" : value < 0 ? minus : ""
  return (
    <span
      dir="ltr"
      data-slot="delta"
      data-tone={tone}
      className={["delta", className].filter(Boolean).join(" ")}
      {...props}
    >
      {sign}
      {format(Math.abs(value))}
    </span>
  )
}

export type StatusLabelTone = "neutral" | "good" | "bad" | "warning" | "active"

export interface StatusLabelProps extends Omit<ComponentProps<"span">, "children"> {
  tone?: StatusLabelTone
  icon?: ReactNode
  children: ReactNode
}

function Mark({ tone }: { tone: StatusLabelTone }) {
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

export function StatusLabel({
  className,
  tone = "neutral",
  icon,
  children,
  ...props
}: StatusLabelProps) {
  const mark = icon !== undefined ? icon : <Mark tone={tone} />
  return (
    <span
      data-slot="status-label"
      data-tone={tone}
      className={["status", className].filter(Boolean).join(" ")}
      {...props}
    >
      {mark !== null && mark !== false ? (
        <span aria-hidden="true" data-slot="status-label-mark" className="status-mark">
          {mark}
        </span>
      ) : null}
      <span data-slot="status-label-word" className="status-word">
        {children}
      </span>
    </span>
  )
}

export type StatSize = "sm" | "md" | "lg"

export interface StatProps extends Omit<ComponentProps<"div">, "children"> {
  size?: StatSize
  value: ReactNode
  of?: ReactNode
  delta?: ReactNode
  caption: ReactNode
  captionSide?: "top" | "bottom"
  children?: ReactNode
}

export function Stat({
  className,
  size = "md",
  value,
  of,
  delta,
  caption,
  captionSide = "top",
  children,
  ...props
}: StatProps) {
  const captionNode = (
    <span data-slot="stat-caption" className="stat-caption">
      {caption}
    </span>
  )
  return (
    <div
      data-slot="stat"
      data-size={size}
      className={["stat", className].filter(Boolean).join(" ")}
      {...props}
    >
      {captionSide === "top" ? captionNode : null}
      <span data-slot="stat-figure" className="stat-figure">
        <span data-slot="stat-value" className="stat-value">
          {value}
          {of !== undefined && of !== null ? (
            <span data-slot="stat-of" className="stat-of">
              {of}
            </span>
          ) : null}
        </span>
        {delta !== undefined && delta !== null ? (
          <span data-slot="stat-delta">{delta}</span>
        ) : null}
      </span>
      {captionSide === "bottom" ? captionNode : null}
      {children}
    </div>
  )
}

export type MeterTone = "neutral" | "good" | "bad"

interface MeterBaseProps extends Omit<
  ComponentProps<"span">,
  | "children"
  | "role"
  | "aria-label"
  | "aria-labelledby"
  | "aria-valuemin"
  | "aria-valuemax"
  | "aria-valuenow"
  | "aria-valuetext"
> {
  value: number
  valueText?: string
  tone?: MeterTone
}

export type MeterProps = MeterBaseProps &
  (
    | { label: string; "aria-labelledby"?: never }
    | { label?: never; "aria-labelledby": string }
  )

function clampFraction(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function Meter({
  className,
  value,
  label,
  valueText,
  tone = "neutral",
  ...props
}: MeterProps) {
  const fraction = clampFraction(value)
  const percent = Math.round(fraction * 10_000) / 100
  return (
    <span
      data-slot="meter"
      data-tone={tone}
      className={["meter", className].filter(Boolean).join(" ")}
      {...props}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
    >
      <span
        data-slot="meter-fill"
        className="meter-fill"
        style={{ width: `${percent}%` }}
      />
    </span>
  )
}

export type ProportionBarTone =
  | "series-1"
  | "series-2"
  | "series-3"
  | "series-4"
  | "series-5"
  | "series-6"
  | "series-7"
  | "series-8"
  | "neutral"
  | "muted"

export const proportionBarTones: Readonly<Record<ProportionBarTone, string>> =
  Object.freeze({
    "series-1": "var(--nessa-chart-series-1-strong)",
    "series-2": "var(--nessa-chart-series-2-strong)",
    "series-3": "var(--nessa-chart-series-3-strong)",
    "series-4": "var(--nessa-chart-series-4-strong)",
    "series-5": "var(--nessa-chart-series-5-strong)",
    "series-6": "var(--nessa-chart-series-6-strong)",
    "series-7": "var(--nessa-chart-series-7-strong)",
    "series-8": "var(--nessa-chart-series-8-strong)",
    neutral: "color-mix(in oklab, var(--foreground) 40%, transparent)",
    muted: "color-mix(in oklab, var(--foreground) 10%, transparent)",
  })

const ramp: readonly ProportionBarTone[] = [
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "series-7",
  "series-8",
]

export interface ProportionBarSegment {
  id: string
  label: string
  value: number
  tone?: ProportionBarTone
  color?: string
}

export interface ProportionBarProps extends Omit<ComponentProps<"div">, "children"> {
  segments: readonly ProportionBarSegment[]
  weighting?: ProportionWeighting
  max?: number
  legend?: boolean
  formatValue: (value: number, segment: ProportionBarSegment) => string
  summary?: string
  size?: "sm" | "md"
}

function colorOf(segment: ProportionBarSegment, index: number): string {
  if (segment.color) return segment.color
  const fallback = ramp[index % ramp.length] ?? "series-1"
  const tone =
    segment.tone !== undefined && Object.hasOwn(proportionBarTones, segment.tone)
      ? segment.tone
      : fallback
  return proportionBarTones[tone]
}

export function ProportionBar({
  segments,
  weighting = "linear",
  max,
  legend = false,
  formatValue,
  summary,
  size = "md",
  className,
  ...props
}: ProportionBarProps) {
  const weights = proportionWeights(
    segments.map((segment) => segment.value),
    weighting,
  )
  const total = segments.reduce(
    (sum, segment) =>
      Number.isFinite(segment.value) && segment.value > 0 ? sum + segment.value : sum,
    0,
  )
  const fill =
    max !== undefined && Number.isFinite(max) && max > 0
      ? Math.min(total / max, 1)
      : total > 0
        ? 1
        : 0
  const spoken =
    summary ??
    segments
      .map((segment) => `${segment.label} ${formatValue(segment.value, segment)}`)
      .join(", ")
  const named =
    props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined
  return (
    <div
      data-slot="proportion-bar"
      role={named ? "group" : undefined}
      className={["bar", className].filter(Boolean).join(" ")}
      {...props}
    >
      <div
        data-slot="proportion-bar-track"
        role={legend ? undefined : "img"}
        aria-label={legend ? undefined : spoken}
        aria-hidden={legend ? true : undefined}
        className={size === "sm" ? "bar-track bar-track-sm" : "bar-track"}
        style={
          {
            background: max !== undefined ? proportionBarTones.muted : "transparent",
          } satisfies CSSProperties
        }
      >
        <div
          data-slot="proportion-bar-fill"
          className="bar-fill"
          style={{ width: `${fill * 100}%` }}
        >
          {segments.map((segment, index) =>
            (weights[index] ?? 0) > 0 ? (
              <span
                key={segment.id}
                data-slot="proportion-bar-segment"
                data-segment-id={segment.id}
                className="bar-segment"
                style={{
                  flexGrow: weights[index],
                  background: colorOf(segment, index),
                }}
              />
            ) : null,
          )}
        </div>
      </div>
      {legend ? (
        <ul data-slot="proportion-bar-legend" className="bar-legend">
          {segments.map((segment, index) => (
            <li key={segment.id} data-segment-id={segment.id}>
              <span
                aria-hidden="true"
                className="bar-swatch"
                style={{ background: colorOf(segment, index) }}
              />
              <span>{segment.label}</span>
              <span className="bar-legend-value">
                {formatValue(segment.value, segment)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export type ChartTooltipBoundary = Element | RefObject<Element | null> | ChartRect

export interface ChartTooltipProps extends ComponentProps<"div"> {
  anchor: { x: number; y: number }
  boundary?: ChartTooltipBoundary | null
  side?: ChartTooltipSide
  offset?: number
  padding?: number
}

function isRefObject(
  boundary: ChartTooltipBoundary,
): boundary is RefObject<Element | null> {
  return "current" in boundary
}

function boundaryRect(boundary: ChartTooltipBoundary): ChartRect | null {
  if (isRefObject(boundary)) {
    return boundary.current ? boundary.current.getBoundingClientRect() : null
  }
  if ("getBoundingClientRect" in boundary) return boundary.getBoundingClientRect()
  return boundary
}

interface Placement {
  left: number
  top: number
  side: ChartTooltipSide
}

export function ChartTooltip({
  anchor,
  boundary,
  side = "right",
  offset = 12,
  padding = 8,
  className,
  style,
  children,
  ref,
  ...props
}: ChartTooltipProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  useLayoutEffect(() => {
    const card = cardRef.current
    const container = card?.offsetParent
    if (!card || !(container instanceof HTMLElement)) return
    const origin = container.getBoundingClientRect()
    const originX = origin.left + container.clientLeft - container.scrollLeft
    const originY = origin.top + container.clientTop - container.scrollTop
    const root = card.ownerDocument.documentElement
    const viewport: ChartRect = {
      left: 0,
      top: 0,
      width: root.clientWidth,
      height: root.clientHeight,
    }
    const given = boundary ? boundaryRect(boundary) : null
    const placed = placeChartTooltip({
      anchor: { x: originX + anchor.x, y: originY + anchor.y },
      size: { width: card.offsetWidth, height: card.offsetHeight },
      boundary: given ? intersectChartRects(given, viewport) : viewport,
      side,
      offset,
      padding,
    })
    const next = {
      left: placed.x - originX,
      top: placed.y - originY,
      side: placed.side,
    }
    setPlacement((previous) =>
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.side === next.side
        ? previous
        : next,
    )
  }, [anchor.x, anchor.y, boundary, side, offset, padding])
  return (
    <div
      ref={(node) => {
        cardRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      role="tooltip"
      data-slot="chart-tooltip"
      data-side={placement?.side ?? side}
      data-placed={placement ? "true" : "false"}
      className={["chart-card", className].filter(Boolean).join(" ")}
      style={{
        ...style,
        left: placement?.left ?? anchor.x,
        top: placement?.top ?? anchor.y,
      }}
      {...props}
    >
      {children}
    </div>
  )
}
