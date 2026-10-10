/**
 * The experiment components. Views take props and render. Hooks hold hover,
 * measurement, the file window and opening a file. What a view shows of an
 * experiment is read in `reading.ts`, from the definition and from what the
 * harness decided.
 *
 * The pages import these modules directly. They supply the experiment
 * (validated from the tool result), the width, and `open` — the server's
 * `open_file`, mapped to `{ kind: "opened" }` or `{ kind: "refused", reason }`.
 * Navigation and display mode live in the pages.
 */
export { AreaCard, AreaCards } from "./area-card.tsx"
export { CaseResults } from "./case-results.tsx"
export { ChangeView, type ChangeViewProps } from "./change-view.tsx"
export { ClimbChart, type ClimbChartProps } from "./climb-chart.tsx"
export { ExplorationMap, type ExplorationMapProps } from "./exploration-map.tsx"
export type { Opening, Shown, Target } from "./open-file.ts"
export {
  areaCards,
  caseResults,
  changeRead,
  climbRead,
  mapRead,
  verdicts,
  type AreaCardRead,
  type CaseResultsRead,
  type ChangeRead,
  type ClimbRead,
  type MapRead,
  type VerdictRead,
} from "./reading.ts"
export { useChangeView } from "./use-change.ts"
export { useClimbChart } from "./use-climb.ts"
export { useExplorationMap } from "./use-map.ts"
export { useElementWidth } from "./use-measure.ts"
export { useOpenFile, type OpenRequest, type Schedule } from "./use-open-file.ts"
export { VerdictLabel, VerdictList } from "./verdict-label.tsx"
