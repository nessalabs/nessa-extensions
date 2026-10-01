/**
 * The workspace's units and what each declares, read from disk for the
 * typecheck and build guards. A unit is `packages/<dir>` or
 * `extensions/<name>`; `pnpm architecture` has already held each to a
 * `package.json` on the pinned layout.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Where a unit declares a workspace package it uses. A package is bundled in,
 * so `devDependencies` is the usual place; a peer or optional dependency is
 * not a declaration of one.
 */
const dependencyFields = ["dependencies", "devDependencies"]

/**
 * Every unit under `root`, sorted. A dot-directory is not one. A unit that is
 * a symbolic link is listed like any other, so it is still checked — and
 * refused, since its files are somewhere else.
 */
export function units(root) {
  return ["packages", "extensions"].flatMap((top) => {
    const directory = join(root, top)
    if (!existsSync(directory)) return []
    return readdirSync(directory)
      .sort()
      .filter(
        (name) => !name.startsWith(".") && statSync(join(directory, name)).isDirectory(),
      )
      .map((name) => `${top}/${name}`)
  })
}

const manifest = (root, unit) =>
  JSON.parse(readFileSync(join(root, unit, "package.json"), "utf8"))

/**
 * The workspace packages `unit` may use, as `packages/<dir>`: each package
 * its manifest lists in `dependencyFields`, and in turn each one those
 * declare, as an npm dependency's own dependencies come with it.
 */
export function declaredPackages(root, unit) {
  const byName = new Map()
  for (const pkg of units(root).filter((path) => path.startsWith("packages/"))) {
    const { name } = manifest(root, pkg)
    if (typeof name === "string") byName.set(name, pkg)
  }
  const declared = new Set()
  const visit = (from) => {
    const own = manifest(root, from)
    for (const field of dependencyFields) {
      const entries = Object.hasOwn(own, field) ? own[field] : undefined
      if (entries === null || typeof entries !== "object") continue
      for (const name of Object.keys(entries)) {
        const pkg = byName.get(name)
        if (pkg === undefined || pkg === unit || declared.has(pkg)) continue
        declared.add(pkg)
        visit(pkg)
      }
    }
  }
  visit(unit)
  return declared
}
