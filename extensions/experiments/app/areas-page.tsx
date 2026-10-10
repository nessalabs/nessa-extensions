/**
 * The areas: the exploration map, then one card each. No areas, nothing —
 * the surface does not offer the view. This view holds no state.
 */
import { AreaCards } from "./area-card.tsx"
import { ExplorationMap, type ExplorationMapProps } from "./exploration-map.tsx"
import { PageHeading } from "./page-heading.tsx"
import type { AreaCardRead } from "./reading.ts"
import "./pages.css"

export function AreasPage({
  title,
  subtitle,
  map,
  cards,
  onOpenRun,
}: {
  readonly title: string
  readonly subtitle?: string
  readonly map: ExplorationMapProps
  readonly cards: readonly AreaCardRead[]
  readonly onOpenRun: (runId: string) => void
}) {
  return (
    <div className="page">
      <PageHeading title={title} subtitle={subtitle} />
      <ExplorationMap {...map} onOpen={onOpenRun} />
      <AreaCards cards={cards} onOpenRun={onOpenRun} />
    </div>
  )
}
