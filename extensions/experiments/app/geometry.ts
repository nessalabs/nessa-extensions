/**
 * The climb's and the exploration map's geometry: pure, no DOM, no experiment.
 * Pixel positions come from here; which points exist, and what they mean,
 * comes from the model (`selections.ts`'s `climb` and `bestSoFar`). Nothing
 * here decides a best.
 *
 * The 1-2-5 ticks (`axisTicks`) and the step-after path (`stepAfter`) are
 * nessa_ui's `niceTicks` and `stepPath`
 * (`packages/react/src/lib/chart-geometry.ts`), copied here while
 * `@nessalabs/ui` is not on npm (nessalabs/nessa_ui#115). The noise band,
 * the map's columns, and where a card sits are this chart's own.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface AxisScale {
  readonly x: (value: number) => number
  readonly y: (value: number) => number
}

/** A rectangle in the chart's own coordinates. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export const margins = { top: 20, right: 16, bottom: 32, left: 56 }

/** A hundredth of a pixel: finer is invisible and noisy in a path. */
const px = (value: number) => Math.round(value * 100) / 100

/**
 * A linear map from a data interval onto a pixel interval. A domain of no
 * width maps every value to the middle of the range.
 */
export function linear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [from, to] = domain
  const [start, end] = range
  const span = to - from
  if (span === 0 || !Number.isFinite(span)) {
    const middle = (start + end) / 2
    return () => middle
  }
  const slope = (end - start) / span
  return (value) => start + (value - from) * slope
}

/**
 * Ascending ticks that bound `[min, max]`, on a 1-2-5 step, about `count`
 * intervals. Equal bounds are widened so a flat series still has an axis.
 * A non-finite bound gives no ticks.
 */
export function axisTicks(min: number, max: number, count: number): readonly number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  let low = Math.min(min, max)
  let high = Math.max(min, max)
  if (low === high) {
    const pad = low === 0 ? 0.5 : Math.abs(low) * 0.1
    low -= pad
    high += pad
  }
  const intervals = Math.min(
    6,
    Math.max(2, Math.round(Number.isFinite(count) ? count : 2)),
  )
  const raw = (high - low) / intervals
  if (!(raw > 0) || !Number.isFinite(raw)) return [low, high]
  const exponent = Math.floor(Math.log10(raw))
  const magnitude = 10 ** exponent
  const error = raw / magnitude
  const factor =
    error >= Math.sqrt(50)
      ? 10
      : error >= Math.sqrt(10)
        ? 5
        : error >= Math.sqrt(2)
          ? 2
          : 1
  const step = factor * magnitude
  if (!(step > 0) || !Number.isFinite(step)) return [low, high]
  const first = Math.floor(low / step + 1e-9)
  const last = Math.ceil(high / step - 1e-9)
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 24) {
    return [low, high]
  }
  const places = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const scale = 10 ** places
  const ticks: number[] = []
  for (let index = first; index <= last; index += 1) {
    ticks.push(Math.round(index * step * scale) / scale)
  }
  return ticks
}

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
 * An SVG step-after path through `points` in the order given: each value
 * holds until the next point, then the line steps. Carried on to `until`
 * when that is later than the last point. Empty when nothing is finite.
 */
export function stepAfter(
  points: readonly Point[],
  scale: AxisScale,
  until?: number,
): string {
  const finite = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  const first = finite[0]
  if (first === undefined) return ""
  let path = `M${px(scale.x(first.x))},${px(scale.y(first.y))}`
  for (const point of finite.slice(1)) {
    path += `H${px(scale.x(point.x))}V${px(scale.y(point.y))}`
  }
  const last = finite[finite.length - 1]
  if (
    last !== undefined &&
    until !== undefined &&
    Number.isFinite(until) &&
    until > last.x
  ) {
    path += `H${px(scale.x(until))}`
  }
  return path
}

/**
 * The noise band around a step series: `noise` above and below, closed.
 * Empty when there is no series or no noise.
 */
export function noiseBand(
  points: readonly Point[],
  noise: number,
  scale: AxisScale,
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
    values.length === 0 ? [] : axisTicks(Math.min(...values), Math.max(...values), 4)
  const yDomain: readonly [number, number] =
    yTicks.length >= 2 ? [yTicks[0] ?? 0, yTicks[yTicks.length - 1] ?? 1] : [0, 1]
  const xOf = linear(
    [startedAt, endedAt === startedAt ? startedAt + 1 : endedAt],
    [plotLeft, plotRight],
  )
  const yOf = linear(yDomain, [plotBottom, plotTop])
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
    best: stepAfter(bestPoints, scale, endedAt),
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
  const yOf = linear(
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

/**
 * Where a card sits so it stays inside `bounds`: to the right of `anchor`
 * when it fits, otherwise to the left, then clamped. A card larger than the
 * bounds is pinned to the top-left padding.
 */
export function placeCard(options: {
  readonly anchor: Point
  readonly card: { readonly width: number; readonly height: number }
  readonly bounds: Box
  readonly gap?: number
  readonly padding?: number
}): { readonly left: number; readonly top: number } {
  const gap = options.gap ?? 12
  const padding = options.padding ?? 8
  const { anchor, card, bounds } = options
  const minX = bounds.left + padding
  const minY = bounds.top + padding
  const maxX = bounds.left + bounds.width - padding - card.width
  const maxY = bounds.top + bounds.height - padding - card.height
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(value, Math.max(low, high)))
  let left = anchor.x + gap
  if (left > maxX) left = anchor.x - gap - card.width
  return {
    left: clamp(left, minX, maxX),
    top: clamp(anchor.y - card.height / 2, minY, maxY),
  }
}

/**
 * The slice of a list of `total` rows of `row` pixels that `viewport` shows
 * at `scrollTop`, plus `overscan` rows each side. `end` is exclusive.
 */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  row: number,
  total: number,
  overscan: number,
): { readonly start: number; readonly end: number } {
  if (total <= 0 || row <= 0) return { start: 0, end: 0 }
  const shown = viewport > 0 ? viewport : row
  const start = Math.max(0, Math.floor(Math.max(scrollTop, 0) / row) - overscan)
  const end = Math.min(
    total,
    Math.ceil((Math.max(scrollTop, 0) + shown) / row) + overscan,
  )
  return { start, end: Math.max(start, end) }
}
