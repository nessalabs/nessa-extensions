/**
 * What the samples are made from: a seeded random sequence, so each reads the
 * same every time, and the cases and changes of a run at any size.
 */
import type { ExperimentInput } from "../model/index.ts"

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
 * A run's cases: `total` of them in `kinds`' slices, `fixed` and `broken` of
 * them moved, `passing` of them passing before, and one page of the moved —
 * at most 200, in proportion — each in the slice it moved in.
 */
export function casesFor(
  seed: string,
  kinds: readonly SliceKind[],
  counts: {
    readonly total: number
    readonly fixed: number
    readonly broken: number
    readonly passing: number
  },
): CasesInput {
  const random = seeded(`cases-${seed}`)
  const { total, fixed, broken, passing } = counts
  const weights = kinds.map((kind) => kind.share * (0.7 + random() * 0.6))
  const sizes = spread(
    total,
    kinds.map((kind) => kind.share),
  )
  const fixedBy = spread(fixed, weights)
  const brokenBy = spread(broken, weights)
  const passingBy = spread(passing, weights)
  const slices = kinds.map((kind, index) => {
    const size = sizes[index]
    const passingBefore = Math.min(size, Math.max(brokenBy[index], passingBy[index]))
    const passingAfter = Math.min(
      size,
      Math.max(0, passingBefore + fixedBy[index] - brokenBy[index]),
    )
    return { name: kind.name, total: size, passingBefore, passingAfter }
  })
  const moved = fixed + broken
  const pageFixed = moved === 0 ? 0 : Math.min(fixed, Math.round((200 * fixed) / moved))
  const pageBroken = Math.min(broken, 200 - pageFixed)
  const taken = new Set<number>()
  const caseId = () => {
    let number = 1 + Math.floor(random() * total)
    while (taken.has(number)) number = (number % total) + 1
    taken.add(number)
    return `C-${String(number).padStart(7, "0")}`
  }
  const page: CasesInput["moved"][number][] = []
  for (const [move, listed, by] of [
    ["fixed", pageFixed, fixedBy],
    ["broken", pageBroken, brokenBy],
  ] as const) {
    let slice = 0
    for (let each = 0; each < listed; each += 1) {
      while (by[slice % kinds.length] === 0) slice += 1
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
