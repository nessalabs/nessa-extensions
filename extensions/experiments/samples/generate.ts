/**
 * What the samples are made from: a seeded random sequence, so each reads the
 * same every time, and the cases and changes of a run at any size.
 */
import { movedCount, movedPageSize, type ExperimentInput } from "../model/index.ts"

type RunInput = ExperimentInput["runs"][number]
export type CasesInput = NonNullable<RunInput["cases"]>
export type ChangeInput = NonNullable<RunInput["change"]>

const minute = 60_000

/** `count` minutes, in milliseconds. */
export const minutes = (count: number) => count * minute

/** A small deterministic random sequence in [0, 1), from `seed`. */
export function seeded(seed: string): () => number {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1)
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619)
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507)
    state = Math.imul(state ^ (state >>> 13), 3266489909)
    state ^= state >>> 16
    return (state >>> 0) / 4294967296
  }
}

/** A kind of case: its name, its share of the suite, and a few of its titles. */
export interface SliceKind {
  readonly name: string
  readonly share: number
  readonly titles: readonly string[]
}

/** `count` split by `weights`, in whole numbers that add up to it. */
function spread(count: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((total, each) => total + each, 0)
  const parts = weights.map((weight) => Math.floor((weight / sum) * count))
  parts[0] += count - parts.reduce((total, each) => total + each, 0)
  return parts
}

/**
 * `count` split by `weights` in whole numbers, none above its `cap`: in
 * proportion, then what is left to each with room, heaviest first. Short of
 * `count` only when every cap is reached.
 */
function spreadWithin(
  count: number,
  weights: readonly number[],
  caps: readonly number[],
): number[] {
  const sum = weights.reduce((total, each) => total + each, 0)
  const room = weights.map((weight, index) => ({
    weight,
    cap: caps[index] ?? 0,
    part: Math.min(caps[index] ?? 0, Math.floor((weight / sum) * count)),
  }))
  let left = count - room.reduce((total, each) => total + each.part, 0)
  for (const each of [...room].sort((a, b) => b.weight - a.weight)) {
    const more = Math.min(left, each.cap - each.part)
    each.part += more
    left -= more
  }
  return room.map((each) => each.part)
}

/** What passed before a run: its parent's slices, or, for the baseline's, a count. */
export type Before =
  | { readonly passing: number }
  | {
      readonly slices: readonly { readonly name: string; readonly passingAfter: number }[]
    }

/**
 * A run's cases: `total` of them in `kinds`' slices; passing before as
 * `before` says, so a run's slices start where its parent's ended; about
 * `fixed` and `broken` of them moved, in each slice no more than it has room
 * for; and one page of the moved — at most `movedPageSize`, in proportion —
 * each in the slice it moved in. The slices cover the cases once, so each
 * agrees with the run (the rule `slice-coherent`).
 *
 * `version` is what is known of the cases of the version the run is built on,
 * shared by every run built on it: a case one of them fixed was failing in
 * it, one broken was passing, so no sibling says otherwise. This run's moves
 * add to it, and what it returns is what is known of the run's own cases.
 */
export function casesFor(
  seed: string,
  kinds: readonly SliceKind[],
  counts: { readonly total: number; readonly fixed: number; readonly broken: number },
  before: Before,
  version: CaseStates = new Map(),
): { readonly cases: CasesInput; readonly states: CaseStates } {
  const random = seeded(`cases-${seed}`)
  const { total } = counts
  const weights = kinds.map((kind) => kind.share * (0.7 + random() * 0.6))
  const sizes = spread(
    total,
    kinds.map((kind) => kind.share),
  )
  const passingBy =
    "slices" in before
      ? kinds.map(
          (kind) =>
            before.slices.find((slice) => slice.name === kind.name)?.passingAfter ?? 0,
        )
      : spread(before.passing, weights).map((each, index) =>
          Math.min(each, sizes[index] ?? 0),
        )
  // A fixed case failed before; a broken one passed.
  const fixedBy = spreadWithin(
    counts.fixed,
    weights,
    sizes.map((size, index) => size - (passingBy[index] ?? 0)),
  )
  const brokenBy = spreadWithin(counts.broken, weights, passingBy)
  const fixed = fixedBy.reduce((sum, each) => sum + each, 0)
  const broken = brokenBy.reduce((sum, each) => sum + each, 0)
  const slices = kinds.map((kind, index) => {
    const passingBefore = passingBy[index] ?? 0
    return {
      name: kind.name,
      total: sizes[index] ?? 0,
      passingBefore,
      passingAfter: passingBefore + (fixedBy[index] ?? 0) - (brokenBy[index] ?? 0),
    }
  })
  const moved = movedCount({ fixed, broken })
  const pageFixed =
    moved === 0 ? 0 : Math.min(fixed, Math.round((movedPageSize * fixed) / moved))
  const pageBroken = Math.min(broken, movedPageSize - pageFixed)
  // A case is one of the suite: its number places it in a slice, by the
  // slices' sizes, and names it, so it is the same case in every run. A case
  // passing in the version is not fixed, and one failing is not broken.
  const starts = sizes.map((_, index) =>
    sizes.slice(0, index).reduce((sum, each) => sum + each, 0),
  )
  const seen = new Map<string, "passing" | "failing" | "listed">(version)
  const page: CasesInput["moved"][number][] = []
  // Round the slices, each listing no more than it moved.
  for (const [move, listed, by] of [
    ["fixed", pageFixed, fixedBy],
    ["broken", pageBroken, brokenBy],
  ] as const) {
    const left = [...by]
    let slice = 0
    for (let each = 0; each < listed; each += 1) {
      while (left[slice % kinds.length] === 0) slice += 1
      const index = slice % kinds.length
      left[index] = (left[index] ?? 0) - 1
      const kind = kinds[index]
      const size = sizes[index] ?? 0
      const start = starts[index] ?? 0
      // A free case in the slice, from a random place, in order.
      let offset = Math.floor(random() * size)
      for (let tries = 0; tries < size; tries += 1) {
        const id = caseIdOf(start + ((offset + tries) % size))
        const was = seen.get(id)
        if (was === "listed" || was === (move === "fixed" ? "passing" : "failing"))
          continue
        offset = (offset + tries) % size
        break
      }
      const number = start + offset
      const id = caseIdOf(number)
      seen.set(id, "listed")
      version.set(id, move === "fixed" ? "failing" : "passing")
      page.push({ id, title: titleOf(kind, number), slice: kind.name, move })
      slice += 1
    }
  }
  const after: CaseStates = new Map(version)
  for (const each of page)
    after.set(each.id, each.move === "fixed" ? "passing" : "failing")
  page.sort((a, b) => a.id.localeCompare(b.id))
  return { cases: { total, fixed, broken, slices, moved: page }, states: after }
}

/** The id of the suite's case `number` (from 0). */
const caseIdOf = (number: number) => `C-${String(number + 1).padStart(7, "0")}`

/** The title of the suite's case `number`, one of its slice's. */
const titleOf = (kind: SliceKind, number: number) =>
  kind.titles[number % kind.titles.length] ?? kind.name

/** What is known of the cases of one version: each passing or failing in it. */
export type CaseStates = Map<string, "passing" | "failing">

/**
 * A version's slices with no run before it, such as the baseline's:
 * `passing` of the `total` cases spread over `kinds`, the same for every run
 * built on it.
 */
export function slicesOf(
  seed: string,
  kinds: readonly SliceKind[],
  total: number,
  passing: number,
): Before {
  const random = seeded(`slices-${seed}`)
  const weights = kinds.map((kind) => kind.share * (0.7 + random() * 0.6))
  const sizes = spread(
    total,
    kinds.map((kind) => kind.share),
  )
  const passingBy = spread(passing, weights)
  return {
    slices: kinds.map((kind, index) => ({
      name: kind.name,
      passingAfter: Math.min(passingBy[index] ?? 0, sizes[index] ?? 0),
    })),
  }
}

const stems = [
  "refunds",
  "orders",
  "lookup",
  "search",
  "escalation",
  "policy",
  "shipment",
  "retry",
  "budget",
  "limits",
  "session",
  "validate",
  "amounts",
  "errors",
  "context",
  "stream",
  "cancel",
  "address",
  "promo",
  "account",
  "tracking",
  "window",
  "summary",
  "intent",
]

/**
 * What a run changed: `count` distinct files under `folders`, nested deeper
 * the more there are, with `summary` as its sentence.
 */
export function changeFor(
  seed: string,
  summary: string,
  folders: readonly string[],
  extension: string,
  count: number,
): ChangeInput {
  const random = seeded(`files-${seed}`)
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]
  const files: ChangeInput["files"][number][] = []
  const seen = new Set<string>()
  while (files.length < count) {
    const depth = count > 60 ? 1 + Math.floor(random() * 3) : 0
    const nested = Array.from({ length: depth }, () => pick(stems))
    const name = `${pick(stems)}${random() < 0.3 ? `-${pick(stems)}` : ""}-${files.length % 97}.${extension}`
    const path = [pick(folders), ...nested, name].join("/")
    if (seen.has(path)) continue
    seen.add(path)
    const roll = random()
    const status =
      roll < 0.08
        ? "added"
        : roll < 0.12
          ? "deleted"
          : roll < 0.15
            ? "renamed"
            : "modified"
    const size = Math.round(Math.pow(random(), 3) * 180) + 1
    files.push({
      path,
      status,
      added: status === "deleted" ? 0 : size,
      removed: status === "added" ? 0 : Math.round(size * random() * 0.7),
    })
  }
  return { summary, files }
}
