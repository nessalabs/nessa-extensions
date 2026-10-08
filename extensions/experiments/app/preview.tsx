/**
 * Mounts each component for one experiment: the climb, the map, the area
 * cards, the verdicts, one run's cases and one run's change. State stays in
 * the hooks; each view receives props. The component tests render this.
 * #7's pages do the same wiring for navigation, which this preview does not.
 */
import { useMemo } from "react"

import { AreaCards } from "./area-card.tsx"
import { CaseResults } from "./case-results.tsx"
import { ChangeView } from "./change-view.tsx"
import { ClimbChart } from "./climb-chart.tsx"
import { ExplorationMap } from "./exploration-map.tsx"
import {
  areaCards,
  caseResults,
  runWithCases,
  runWithChange,
  verdicts,
} from "./reading.ts"
import { useChangeView } from "./use-change.ts"
import { useClimbChart } from "./use-climb.ts"
import { useElementWidth } from "./use-measure.ts"
import { useExplorationMap } from "./use-map.ts"
import type { OpenRequest, Schedule } from "./use-open-file.ts"
import { VerdictList } from "./verdict-label.tsx"
import type { Opening } from "./open-file.ts"
import type { Experiment } from "../model/index.ts"
import "./preview.css"

export function ExperimentPreview({
  experiment,
  open,
  schedule,
}: {
  experiment: Experiment
  open: (request: OpenRequest) => Promise<Opening>
  schedule: Schedule
}) {
  const [frame, width] = useElementWidth<HTMLDivElement>(720)
  const climb = useClimbChart(experiment, width)
  const map = useExplorationMap(experiment, width)
  const cards = useMemo(() => areaCards(experiment), [experiment])
  const labels = useMemo(() => verdicts(experiment), [experiment])
  const casesRun = useMemo(() => runWithCases(experiment), [experiment])
  const cases = useMemo(
    () => (casesRun === undefined ? undefined : caseResults(experiment, casesRun)),
    [experiment, casesRun],
  )
  const changeRun = useMemo(() => runWithChange(experiment), [experiment])
  const change = useChangeView({ experiment, run: changeRun, open, schedule })
  return (
    <div className="preview" data-ready="">
      <div ref={frame} className="preview-frame">
        <section className="preview-part" data-component="climb">
          <ClimbChart {...climb} />
        </section>
        <section className="preview-part" data-component="map">
          <ExplorationMap {...map} />
        </section>
        <section className="preview-part" data-component="areas">
          <AreaCards cards={cards} />
        </section>
        <section className="preview-part" data-component="verdicts">
          <VerdictList verdicts={labels} />
        </section>
        <section className="preview-part" data-component="cases">
          {cases === undefined ? null : <CaseResults {...cases} />}
        </section>
        <section className="preview-part" data-component="change">
          {change === undefined ? null : <ChangeView {...change} />}
        </section>
      </div>
    </div>
  )
}
