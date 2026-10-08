/**
 * Opening a run's file, or its whole change. One machine owns ADR 333's
 * table: the latest request per target, and the four seconds a refusal is
 * shown. The hook (`use-open-file.ts`) drives it; the view only reads
 * `shown`. `open-file.test.ts` has one test per row of the table.
 *
 *   idle --click--> asked --opened--> idle
 *                      |                 ^
 *                      +--refused--> refused --4s, or click-->
 */

/** How long a refusal stays, in milliseconds. */
export const refusalFor = 4_000

/** What was asked for: one file, or the run's whole change. */
export type Target =
  { readonly kind: "change" } | { readonly kind: "file"; readonly path: string }

/** What the control shows. `asked` adds nothing to the idle control. */
export type Shown =
  | { readonly status: "idle" }
  | { readonly status: "asked" }
  | { readonly status: "refused"; readonly reason: string }

/** How an open finished. The hook's port answers with one of these, and every call does. */
export type Opening =
  { readonly kind: "opened" } | { readonly kind: "refused"; readonly reason: string }

interface Phase {
  readonly request: number
  readonly status: "asked" | "refused"
  readonly reason?: string
}

export interface OpenFileMachine {
  readonly next: number
  readonly phases: ReadonlyMap<string, Phase>
}

/** A machine with nothing asked. */
export function openFileMachine(): OpenFileMachine {
  return { next: 1, phases: new Map() }
}

/** The key a target is remembered by. A file's path is not the change control's key. */
export function targetId(target: Target): string {
  return target.kind === "change" ? "change" : `file:${target.path}`
}

/** What `target` shows. A target with no phase is idle. */
export function shown(machine: OpenFileMachine, target: Target): Shown {
  const phase = machine.phases.get(targetId(target))
  if (phase === undefined) return { status: "idle" }
  if (phase.status === "refused") return { status: "refused", reason: phase.reason ?? "" }
  return { status: "asked" }
}

export interface Click {
  readonly machine: OpenFileMachine
  readonly request: number
}

/**
 * The click: `target` is asked, for a new request, and whatever it showed
 * before — including a refusal — is gone. An earlier request is no longer
 * the latest.
 */
export function click(machine: OpenFileMachine, target: Target): Click {
  const request = machine.next
  const phases = new Map(machine.phases)
  phases.set(targetId(target), { request, status: "asked" })
  return { machine: { next: request + 1, phases }, request }
}

/**
 * An answer. Applied only when `request` is still `target`'s latest: an
 * earlier request's answer changes nothing, whatever phase `target` is in.
 * `opened` returns it to idle. `refused` shows `reason`.
 */
export function answer(
  machine: OpenFileMachine,
  target: Target,
  request: number,
  opening: Opening,
): OpenFileMachine {
  const id = targetId(target)
  const phase = machine.phases.get(id)
  if (phase === undefined || phase.request !== request) return machine
  const phases = new Map(machine.phases)
  if (opening.kind === "opened") phases.delete(id)
  else phases.set(id, { request, status: "refused", reason: opening.reason })
  return { next: machine.next, phases }
}

/**
 * The refusal's four seconds have passed. Applied only when `request` is
 * still the refusal being shown: a click since then, or an open, leaves the
 * phase alone.
 */
export function elapsed(
  machine: OpenFileMachine,
  target: Target,
  request: number,
): OpenFileMachine {
  const id = targetId(target)
  const phase = machine.phases.get(id)
  if (phase === undefined || phase.request !== request || phase.status !== "refused") {
    return machine
  }
  const phases = new Map(machine.phases)
  phases.delete(id)
  return { next: machine.next, phases }
}
