/**
 * Where the experiment is open: which view, and the runs opened over it.
 * The last of `trail` is the run on screen. Following a run's lineage adds
 * to the trail, so stepping back returns to the run it was opened from.
 * Pure: `use-navigation.ts` drives it, and Escape is that hook's.
 */

export const views = ["overview", "areas", "runs"] as const
export type ViewId = (typeof views)[number]

export interface Navigation {
  readonly view: ViewId
  readonly trail: readonly string[]
}

export function navigation(): Navigation {
  return { view: "overview", trail: [] }
}

/** The view under the trail. The trail stays, so closing a run finds it. */
export function selectView(current: Navigation, view: ViewId): Navigation {
  if (current.view === view) return current
  return { view, trail: current.trail }
}

/** Opens `runId` over the view, as the only run on the trail. */
export function openRun(current: Navigation, runId: string): Navigation {
  if (current.trail.length === 1 && current.trail[0] === runId) return current
  return { view: current.view, trail: [runId] }
}

/**
 * Opens `runId` after the run on screen. The same run again changes
 * nothing, so a lineage control for the run already shown does not grow
 * the trail.
 */
export function followRun(current: Navigation, runId: string): Navigation {
  if (current.trail.at(-1) === runId) return current
  return { view: current.view, trail: [...current.trail, runId] }
}

/** Closes the run on screen. An empty trail stays empty. */
export function popRun(current: Navigation): Navigation {
  if (current.trail.length === 0) return current
  return { view: current.view, trail: current.trail.slice(0, -1) }
}

/**
 * The trail through `index`, which is a run already on it. An index past
 * the end leaves the trail as it is.
 */
export function trailThrough(current: Navigation, index: number): Navigation {
  if (index < 0 || index >= current.trail.length) return current
  const trail = current.trail.slice(0, index + 1)
  if (trail.length === current.trail.length) return current
  return { view: current.view, trail }
}

/** Closes every run. The view underneath is what's left. */
export function closeRuns(current: Navigation): Navigation {
  if (current.trail.length === 0) return current
  return { view: current.view, trail: [] }
}
