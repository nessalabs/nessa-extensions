/**
 * Hover on the map, and the props `ExplorationMap` draws. The thread is
 * `bestSoFar` in order; a run with no area is not a dot, so the thread skips it.
 */
import { useMemo, useState } from "react"

import { mapLayout } from "./geometry.ts"
import type { ExplorationMapProps } from "./exploration-map.tsx"
import { mapRead } from "./reading.ts"
import { seriesInk } from "./series.ts"
import type { Experiment } from "../model/index.ts"

export function useExplorationMap(
  experiment: Experiment,
  width: number,
  height = 280,
): ExplorationMapProps {
  const read = useMemo(() => mapRead(experiment), [experiment])
  const layout = useMemo(
    () =>
      mapLayout({
        areas: read.areas,
        runs: read.runs.map((run) => ({
          runId: run.runId,
          areaId: run.areaId,
          at: run.at,
        })),
        thread: read.thread,
        width,
        height,
      }),
    [read, width, height],
  )
  const [hovered, setHovered] = useState<string | undefined>()
  const readDot = read.runs.find((run) => run.runId === hovered)
  const placed = layout.dots.find((dot) => dot.runId === hovered)
  const at = new Map(layout.dots.map((dot) => [dot.runId, dot]))
  const columnX = new Map(layout.columns.map((column) => [column.id, column.x]))
  return {
    width: layout.width,
    height: layout.height,
    columns: read.areas.flatMap((area) => {
      const x = columnX.get(area.id)
      if (x === undefined) return []
      return [{ id: area.id, name: area.name, x, ink: seriesInk(area.hue) }]
    }),
    dots: read.runs.flatMap((run) => {
      const xy = at.get(run.runId)
      if (xy === undefined) return []
      return [
        {
          runId: run.runId,
          x: xy.x,
          y: xy.y,
          number: run.number,
          verdict: run.verdict,
          tone: run.tone,
          outcome: run.outcome,
          ink: seriesInk(run.hue),
          area: run.area,
        },
      ]
    }),
    thread: layout.thread,
    ...(readDot === undefined || placed === undefined
      ? {}
      : {
          hover: {
            runId: readDot.runId,
            x: placed.x,
            y: placed.y,
            number: readDot.number,
            verdict: readDot.verdict,
            tone: readDot.tone,
            outcome: readDot.outcome,
            ink: seriesInk(readDot.hue),
            area: readDot.area,
          },
        }),
    onHover: setHovered,
  }
}
