/**
 * The experiment fullscreen: the header, the view selector, the views, and
 * a run opened over them. The view underneath stays mounted, so closing the
 * run finds its scroll and its filter. Navigation and Escape are
 * `useExperimentNavigation`. Runs and the open run are read with `tools/call`.
 */
import { useMemo, useState, type KeyboardEvent } from "react"

import { areaCards, caseResults, verdicts } from "./reading.ts"
import { AreasPage } from "./areas-page.tsx"
import { Overview } from "./overview.tsx"
import {
  headline,
  lineageSteps,
  noteReads,
  outcomeRead,
  pathSteps,
  runRow,
  runsSubtitle,
  swarmNow,
} from "./page-reading.ts"
import { RunDetail } from "./run-detail.tsx"
import { RunsView } from "./runs-view.tsx"
import { useChangeView } from "./use-change.ts"
import { useClimbChart } from "./use-climb.ts"
import { useFetchedRun, useListedRuns } from "./use-host.ts"
import { useExplorationMap } from "./use-map.ts"
import { useElementWidth } from "./use-measure.ts"
import { useExperimentNavigation } from "./use-navigation.ts"
import type { ViewId } from "./navigation.ts"
import type { Opening } from "./open-file.ts"
import type { OpenRequest, Schedule } from "./use-open-file.ts"
import { runOf, type Experiment } from "../model/index.ts"
import "./pages.css"

const labels = {
  overview: "Overview",
  areas: "Areas",
  runs: "Runs",
} as const satisfies Record<ViewId, string>

function runLabel(experiment: Experiment, id: string): string {
  const run = runOf(experiment, id)
  return run === undefined ? "Run" : `Run ${run.number}`
}

export function ExperimentSurface({
  experiment,
  active,
  open,
  schedule,
  onInline,
  inlinePending,
  notice,
}: {
  readonly experiment: Experiment
  readonly active: boolean
  readonly open: (request: OpenRequest) => Promise<Opening>
  readonly schedule: Schedule
  readonly onInline: () => void
  readonly inlinePending: boolean
  readonly notice?: string
}) {
  const nav = useExperimentNavigation(active)
  const [frame, width] = useElementWidth<HTMLDivElement>(720)
  const climb = useClimbChart(experiment, width)
  const map = useExplorationMap(experiment, width)
  const [verdict, setVerdict] = useState<string | undefined>(undefined)
  const [filtered, setFiltered] = useState(experiment.id)
  if (filtered !== experiment.id) {
    setFiltered(experiment.id)
    setVerdict(undefined)
  }
  const available: readonly ViewId[] =
    experiment.areas.length === 0 ? ["overview", "runs"] : ["overview", "areas", "runs"]
  const view = available.includes(nav.navigation.view) ? nav.navigation.view : "overview"
  const openId = nav.navigation.trail.at(-1)
  const listed = useListedRuns(experiment, view === "runs")
  const fetched = useFetchedRun(experiment, openId)
  const detailRun = fetched.status === "ready" ? fetched.run : undefined
  const change = useChangeView({ experiment, run: detailRun, open, schedule })
  const head = useMemo(() => headline(experiment), [experiment])
  const path = useMemo(() => pathSteps(experiment), [experiment])
  const swarm = useMemo(() => swarmNow(experiment), [experiment])
  const notes = useMemo(() => noteReads(experiment), [experiment])
  const cards = useMemo(() => areaCards(experiment), [experiment])
  const labelsOfVerdicts = useMemo(() => verdicts(experiment), [experiment])
  const rows = useMemo(
    () =>
      listed.status === "ready" ? listed.runs.map((run) => runRow(experiment, run)) : [],
    [experiment, listed],
  )
  const outcome = detailRun === undefined ? undefined : outcomeRead(experiment, detailRun)
  const cases = detailRun === undefined ? undefined : caseResults(experiment, detailRun)
  const line = openId === undefined ? undefined : lineageSteps(experiment, openId)
  const crumbs = nav.navigation.trail.slice(0, -1).map((id, index) => ({
    key: `${index}:${id}`,
    label: runLabel(experiment, id),
    onSelect: () => nav.through(index),
  }))

  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = available.indexOf(view)
    const next = (() => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const step = event.key === "ArrowRight" ? 1 : -1
        return available[(index + step + available.length) % available.length]
      }
      if (event.key === "Home") return available[0]
      if (event.key === "End") return available.at(-1)
      return undefined
    })()
    if (next === undefined || next === view) return
    event.preventDefault()
    nav.select(next)
    const tab = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-view="${next}"]`,
    )
    tab?.focus()
  }

  return (
    <section
      ref={nav.surfaceRef}
      className="surface"
      tabIndex={-1}
      aria-label={experiment.title}
    >
      <header className="surface-header">
        <div className="surface-titles">
          <h1 className="surface-title">{experiment.title}</h1>
          <p className="surface-goal">{experiment.goal}</p>
        </div>
        <button
          type="button"
          className="surface-back"
          onClick={onInline}
          disabled={inlinePending}
          aria-label="Show the experiment inline"
        >
          Back
        </button>
      </header>
      {notice === undefined ? null : (
        <p className="card-notice" role="status">
          {notice}
        </p>
      )}
      <div
        className="views"
        role="tablist"
        aria-label="Experiment"
        onKeyDown={onTabsKeyDown}
      >
        {available.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`view-${id}`}
            data-view={id}
            aria-selected={view === id}
            aria-controls={`panel-${id}`}
            tabIndex={view === id ? 0 : -1}
            onClick={() => nav.select(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div ref={frame} className="surface-body">
        <div hidden={openId !== undefined}>
          <div
            role="tabpanel"
            id="panel-overview"
            aria-labelledby="view-overview"
            hidden={view !== "overview" ? true : undefined}
          >
            <Overview
              title="Overview"
              subtitle={`${head.title} · ${head.subtitle}`}
              headline={head}
              climb={climb}
              path={path}
              swarm={swarm}
              notes={notes}
              onOpenRun={nav.open}
            />
          </div>
          {available.includes("areas") ? (
            <div
              role="tabpanel"
              id="panel-areas"
              aria-labelledby="view-areas"
              hidden={view !== "areas" ? true : undefined}
            >
              <AreasPage title="Areas" map={map} cards={cards} onOpenRun={nav.open} />
            </div>
          ) : null}
          <div
            role="tabpanel"
            id="panel-runs"
            aria-labelledby="view-runs"
            hidden={view !== "runs" ? true : undefined}
          >
            <RunsView
              title="Runs"
              subtitle={runsSubtitle(experiment)}
              verdicts={labelsOfVerdicts}
              selected={verdict}
              onSelect={setVerdict}
              rows={rows}
              onOpenRun={nav.open}
              status={listed.status === "idle" ? "loading" : listed.status}
              message={listed.status === "failed" ? listed.message : undefined}
            />
          </div>
        </div>
        {openId === undefined ? null : (
          <div ref={nav.detailRef} className="detail-focus" tabIndex={-1}>
            <RunDetail
              trailLabel={labels[view]}
              crumbs={crumbs}
              current={runLabel(experiment, openId)}
              onClose={nav.close}
              outcome={outcome}
              cases={cases}
              change={change}
              lineage={line}
              onFollow={nav.follow}
              status={fetched.status === "idle" ? "loading" : fetched.status}
              message={fetched.status === "failed" ? fetched.message : undefined}
            />
          </div>
        )}
      </div>
    </section>
  )
}
