/**
 * Hover on the climb, and the props `ClimbChart` draws. The series is
 * `climbRead`; the pixels are `climbLayout`. A tick's text is `formatValue`.
 */
import { useMemo, useState } from "react"

import { formatElapsed } from "./geometry.ts"
import { climbLayout } from "./geometry.ts"
import type { ClimbChartProps } from "./climb-chart.tsx"
import { climbRead } from "./reading.ts"
import { seriesInk } from "./stand-in.tsx"
import { useAnchoredCard } from "./use-measure.ts"
import { formatValue, type Experiment } from "../model/index.ts"

export function useClimbChart(
  experiment: Experiment,
  width: number,
  height = 280,
): ClimbChartProps {
  const read = useMemo(() => climbRead(experiment), [experiment])
  const layout = useMemo(
    () =>
      climbLayout({
        points: read.points.map((point) => ({
          runId: point.runId,
          at: point.at,
          value: point.value,
        })),
        best: read.best,
        ...(read.noise === undefined ? {} : { noise: read.noise }),
        ...(read.reference === undefined ? {} : { reference: read.reference.value }),
        width,
        height,
      }),
    [read, width, height],
  )
  const [hovered, setHovered] = useState<string | undefined>()
  const readPoint = read.points.find((point) => point.runId === hovered)
  const placed = layout.points.find((point) => point.runId === hovered)
  const { ref, place } = useAnchoredCard(
    placed === undefined ? undefined : { x: placed.x, y: placed.y },
    { left: 0, top: 0, width: layout.width, height: layout.height },
  )
  const at = new Map(layout.points.map((point) => [point.runId, point]))
  return {
    title: read.title,
    caption: read.caption,
    width: layout.width,
    height: layout.height,
    yTicks: layout.yTicks.map((tick) => ({
      y: tick.y,
      label: formatValue(experiment.definition.metric, tick.value),
    })),
    xTicks: layout.xTicks.map((tick) => ({
      x: tick.x,
      label: formatElapsed(tick.at - layout.startedAt),
    })),
    points: read.points.flatMap((point) => {
      const xy = at.get(point.runId)
      if (xy === undefined) return []
      return [
        {
          runId: point.runId,
          x: xy.x,
          y: xy.y,
          number: point.number,
          verdict: point.verdict,
          tone: point.tone,
          outcome: point.outcome,
          ink: point.hue === undefined ? "var(--foreground)" : seriesInk(point.hue),
        },
      ]
    }),
    best: layout.best,
    band: layout.band,
    ...(read.reference === undefined || layout.referenceY === undefined
      ? {}
      : {
          reference: {
            y: layout.referenceY,
            label: read.reference.label,
            value: read.reference.formatted,
          },
        }),
    ...(readPoint === undefined
      ? {}
      : {
          hover: {
            number: readPoint.number,
            ...(readPoint.summary === undefined ? {} : { summary: readPoint.summary }),
            reason: readPoint.reason,
            verdict: readPoint.verdict,
            tone: readPoint.tone,
            ...(readPoint.area === undefined ? {} : { area: readPoint.area }),
            ...(readPoint.agent === undefined ? {} : { agent: readPoint.agent }),
            scores: readPoint.scores,
          },
        }),
    ...(place === undefined ? {} : { card: place }),
    cardRef: ref,
    onHover: setHovered,
  }
}
