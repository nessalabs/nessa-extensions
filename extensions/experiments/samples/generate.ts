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
 */
export function casesFor(
  seed: string,
  kinds: readonly SliceKind[],
  counts: { readonly total: number; readonly fixed: number; readonly broken: number },
  before: Before,
): CasesInput {
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
  const taken = new Set<number>()
  const caseId = () => {
    let number = 1 + Math.floor(random() * total)
    while (taken.has(number)) number = (number % total) + 1
    taken.add(number)
    return `C-${String(number).padStart(7, "0")}`
  }
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
      left[slice % kinds.length] -= 1
      const kind = kinds[slice % kinds.length]
      page.push({
        id: caseId(),
        title: kind.titles[Math.floor(random() * kind.titles.length)],
        slice: kind.name,
        move,
      })
      slice += 1
    }
  }
  page.sort((a, b) => a.id.localeCompare(b.id))
  return { total, fixed, broken, slices, moved: page }
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
