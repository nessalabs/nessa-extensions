/**
 * The climb's and the exploration map's geometry: pure, no DOM, no experiment.
 * Pixel positions come from here; which points exist, and what they mean,
 * comes from the model (`selections.ts`'s `climb`). Nothing here decides a
 * best. Scales, ticks, and the step line are nessa_ui's, from `kit-stand-in`.
 */
import {
  linearScale,
  niceTicks,
  stepPath,
  type ChartScale,
} from "./kit-stand-in/index.ts"

export const margins = { top: 20, right: 16, bottom: 32, left: 56 }

/** A hundredth of a pixel: finer is invisible and noisy in a path. */
const px = (value: number) => Math.round(value * 100) / 100

/** Elapsed `ms` as a short label: "45m", "2h", "3h 10m". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

const timeSteps = [
  60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  2 * 3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
]

/** Times from `start` to `end` on a round step, about `count` of them. */
export function timeTicks(start: number, end: number, count: number): readonly number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  const span = Math.max(end - start, 1)
  const target = Math.max(2, Math.round(count))
  const step = timeSteps.find((each) => span / each <= target) ?? 86_400_000
  const first = Math.ceil(start / step) * step
  const ticks: number[] = []
  for (let at = first; at <= end + step * 1e-6; at += step) ticks.push(at)
  return ticks.length > 0 ? ticks : [start]
}

/**
 * The noise band around a step series: `noise` above and below, closed.
 * Empty when there is no series or no noise.
 */
export function noiseBand(
  points: readonly { x: number; y: number }[],
  noise: number,
  scale: ChartScale,
  until: number,
): string {
  const finite = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  const first = finite[0]
  const last = finite[finite.length - 1]
  if (first === undefined || last === undefined || !(noise > 0)) return ""
  const end = Math.max(until, last.x)
  let path = `M${px(scale.x(first.x))},${px(scale.y(first.y + noise))}`
  for (const point of finite.slice(1)) {
    path += `H${px(scale.x(point.x))}V${px(scale.y(point.y + noise))}`
  }
  path += `H${px(scale.x(end))}V${px(scale.y(last.y - noise))}`
  for (const point of finite.slice(0, -1).reverse()) {
    path += `H${px(scale.x(point.x))}V${px(scale.y(point.y - noise))}`
  }
  path += `H${px(scale.x(first.x))}Z`
  return path
}

export interface ClimbLayoutInput {
  readonly points: readonly {
    readonly runId: string
    readonly at: number
    readonly value: number
  }[]
  readonly best: readonly { readonly at: number; readonly value: number }[]
  /** Half-width of the band around the best line. Absent, no band. */
  readonly noise?: number
  /** A horizontal line. Absent, no line. */
  readonly reference?: number
  readonly width: number
  readonly height: number
}

export interface ClimbLayout {
  readonly width: number
  readonly height: number
  readonly yTicks: readonly { readonly value: number; readonly y: number }[]
  readonly xTicks: readonly { readonly at: number; readonly x: number }[]
  readonly points: readonly {
    readonly runId: string
    readonly x: number
    readonly y: number
  }[]
  /** The best-so-far step line, in pixels. */
  readonly best: string
  /** The noise band, in pixels. Empty when the series has no noise. */
  readonly band: string
  readonly referenceY?: number
  readonly startedAt: number
}

/**
 * The climb in pixels. The best line is `best` in the order given, carried
 * out to the latest point, so a run that settles without becoming the best
 * does not step it. The y domain is the tick bounds, which contain the
 * points, the band and the reference.
 */
export function climbLayout(input: ClimbLayoutInput): ClimbLayout {
  const width = Math.max(input.width, margins.left + margins.right + 48)
  const height = Math.max(input.height, margins.top + margins.bottom + 48)
  const plotLeft = margins.left
  const plotRight = width - margins.right
  const plotTop = margins.top
  const plotBottom = height - margins.bottom
  const times = [
    ...input.points.map((point) => point.at),
    ...input.best.map((step) => step.at),
  ]
  const startedAt = times.length === 0 ? 0 : Math.min(...times)
  const endedAt = times.length === 0 ? startedAt + 1 : Math.max(...times)
  const values = [
    ...input.points.map((point) => point.value),
    ...input.best.map((step) => step.value),
    ...input.best.flatMap((step) =>
      input.noise === undefined
        ? []
        : [step.value - input.noise, step.value + input.noise],
    ),
    ...(input.reference === undefined ? [] : [input.reference]),
  ]
  const yTicks =
    values.length === 0 ? [] : niceTicks(Math.min(...values), Math.max(...values), 4)
  const low = yTicks[0]
  const high = yTicks[yTicks.length - 1]
  const yDomain: readonly [number, number] =
    low !== undefined && high !== undefined ? [low, high] : [0, 1]
  const xOf = linearScale(
    [startedAt, endedAt === startedAt ? startedAt + 1 : endedAt],
    [plotLeft, plotRight],
  )
  const yOf = linearScale(yDomain, [plotBottom, plotTop])
  const scale = { x: xOf, y: yOf }
  const bestPoints = input.best.map((step) => ({ x: step.at, y: step.value }))
  const xTicks = timeTicks(startedAt, endedAt, 4).map((at) => ({ at, x: xOf(at) }))
  return {
    width,
    height,
    yTicks: yTicks.map((value) => ({ value, y: yOf(value) })),
    xTicks,
    points: input.points.map((point) => ({
      runId: point.runId,
      x: xOf(point.at),
      y: yOf(point.value),
    })),
    best: stepPath(bestPoints, scale, { until: endedAt }),
    band:
      input.noise === undefined ? "" : noiseBand(bestPoints, input.noise, scale, endedAt),
    ...(input.reference === undefined ? {} : { referenceY: yOf(input.reference) }),
    startedAt,
  }
}

export interface MapLayoutInput {
  readonly areas: readonly { readonly id: string }[]
  readonly runs: readonly {
    readonly runId: string
    readonly areaId: string
    readonly at: number
  }[]
  /** Run ids of the thread, in order. Ones with no dot are skipped. */
  readonly thread: readonly string[]
  readonly width: number
  readonly height: number
}

export interface MapLayout {
  readonly width: number
  readonly height: number
  readonly columns: readonly { readonly id: string; readonly x: number }[]
  readonly dots: readonly {
    readonly runId: string
    readonly x: number
    readonly y: number
  }[]
  /** The thread through `thread`, in pixels. */
  readonly thread: string
}

/** Every run in its area's column, and the thread through `thread` in order. */
export function mapLayout(input: MapLayoutInput): MapLayout {
  const width = Math.max(input.width, 160)
  const height = Math.max(input.height, 160)
  if (input.areas.length === 0) {
    return { width, height, columns: [], dots: [], thread: "" }
  }
  // Inset so a column's name, centered on the column, stays inside the chart.
  // Clamped so two or more columns cannot meet and then reverse when the
  // chart is narrower than the inset.
  const padX = Math.min(88, (width - 1) / 2)
  const padTop = 28
  const padBottom = 20
  const span = width - padX * 2
  const columns = input.areas.map((area, index) => ({
    id: area.id,
    x:
      input.areas.length === 1
        ? width / 2
        : padX + (span * index) / (input.areas.length - 1),
  }))
  const columnX = new Map(columns.map((column) => [column.id, column.x]))
  const times = input.runs.map((run) => run.at)
  const start = times.length === 0 ? 0 : Math.min(...times)
  const end = times.length === 0 ? 1 : Math.max(...times)
  const yOf = linearScale(
    [start, end === start ? start + 1 : end],
    [height - padBottom, padTop],
  )
  const dots = input.runs.flatMap((run) => {
    const x = columnX.get(run.areaId)
    return x === undefined ? [] : [{ runId: run.runId, x, y: yOf(run.at) }]
  })
  const at = new Map(dots.map((dot) => [dot.runId, dot]))
  const threadDots = input.thread.flatMap((id) => {
    const dot = at.get(id)
    return dot === undefined ? [] : [dot]
  })
  const thread = threadDots
    .map((dot, index) => `${index === 0 ? "M" : "L"}${px(dot.x)},${px(dot.y)}`)
    .join("")
  return { width, height, columns, dots, thread }
}
