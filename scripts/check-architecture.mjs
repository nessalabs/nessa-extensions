#!/usr/bin/env node
/**
 * The architecture check: the pinned install layout and the dependencies in it
 * (scripts/architecture/layout.mjs), and no symbolic link in a unit. Bare
 * Node, no dependencies — CI runs it before `pnpm install`. What a unit's
 * files import is not read here: the typecheck and build guards ask the
 * toolchain (scripts/boundary/). Failures are printed as `path: rule`, one per
 * line, on stderr, and the exit status is 1.
 *
 *   node scripts/check-architecture.mjs [root]   check root, or this repository
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  manifestViolations,
  pnpmFiles,
  workspaceViolations,
} from "./architecture/layout.mjs"

/**
 * What install and build write at a unit's root. The build's `dist` is skipped:
 * the build drops it from its stage before running, so nothing in it is read.
 * The unit's `node_modules` is walked by `strayLinks`, which spares only the
 * links pnpm makes there. A `dist` or `node_modules` deeper in a unit is
 * source like any other.
 */
const skipped = new Set(["node_modules", "dist"])

/**
 * The links in a unit's `node_modules` that pnpm does not make. pnpm links
 * each dependency as `node_modules/<name>` or `node_modules/@scope/<name>`
 * and nothing deeper; the build judges those where they lead
 * (scripts/boundary/build.mjs). Any other link — one inside a real directory
 * there, at any depth — is one someone put there, and is refused.
 */
function strayLinks(modules) {
  if (!existsSync(modules)) return []
  const found = []
  for (const name of readdirSync(modules).sort()) {
    const path = join(modules, name)
    const entry = lstatSync(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    if (!name.startsWith("@")) {
      found.push(...links(path, false))
      continue
    }
    for (const inner of readdirSync(path).sort()) {
      const scoped = join(path, inner)
      const each = lstatSync(scoped)
      if (each.isDirectory() && !each.isSymbolicLink())
        found.push(...links(scoped, false))
    }
  }
  return found
}

/**
 * Every symbolic link under `directory`, not followed. The build copies a
 * unit into its stage links and all, and a link that leads back into the
 * repository could carry an asset or a stylesheet there, outside the module
 * graph the build checks (scripts/boundary/build.mjs).
 */
function links(directory, atUnitRoot = true) {
  const found = []
  for (const name of readdirSync(directory).sort()) {
    if (atUnitRoot && skipped.has(name)) continue
    const path = join(directory, name)
    const entry = lstatSync(path)
    if (entry.isSymbolicLink()) found.push(path)
    else if (entry.isDirectory()) found.push(...links(path, false))
  }
  return found
}

/** The units under `extensions/` or `packages/`. A dot-directory is not one. */
const units = (path) =>
  existsSync(path)
    ? readdirSync(path)
        .sort()
        .filter(
          (name) => !name.startsWith(".") && lstatSync(join(path, name)).isDirectory(),
        )
    : []

/**
 * Every failure in the repository at `root`, as `path: rule` lines. An
 * extension is one package, so each needs a `package.json`.
 */
export function checkRepository(root) {
  const failures = []
  const rel = (path) => relative(root, path).split(sep).join("/")

  /**
   * A manifest's contents, or null after recording why it cannot be read —
   * recorded once, however often it is asked for.
   */
  const read = new Map()
  const readManifest = (path) => {
    if (!read.has(path)) {
      let manifest = null
      try {
        manifest = JSON.parse(readFileSync(path, "utf8"))
      } catch {
        failures.push(`${rel(path)}: is not valid JSON`)
      }
      read.set(path, manifest)
    }
    return read.get(path)
  }

  const workspace = join(root, "pnpm-workspace.yaml")
  if (!existsSync(workspace)) {
    failures.push("pnpm-workspace.yaml: is missing; it pins the workspace's layout")
  } else {
    for (const violation of workspaceViolations(readFileSync(workspace, "utf8"))) {
      failures.push(`pnpm-workspace.yaml: ${violation}`)
    }
  }

  for (const name of units(join(root, "packages"))) {
    const path = join(root, "packages", name, "package.json")
    if (!existsSync(path)) {
      failures.push(`${rel(path)}: a package needs a manifest, and it is package.json`)
    }
  }
  const extensionNames = new Set()
  for (const name of units(join(root, "extensions"))) {
    const path = join(root, "extensions", name, "package.json")
    if (!existsSync(path)) {
      failures.push(`${rel(path)}: an extension is one package and needs a manifest`)
      continue
    }
    const manifest = readManifest(path)
    if (manifest === null) continue
    const expected = `@nessalabs/${name}`
    if (manifest.name !== expected) {
      failures.push(
        `${rel(path)}: an extension's manifest names its package ${expected}, after its folder`,
      )
    }
    if (typeof manifest.name === "string" && manifest.name !== "") {
      extensionNames.add(manifest.name)
    }
  }

  const projects = [
    ".",
    ...["packages", "extensions"].flatMap((top) =>
      units(join(root, top)).map((name) => `${top}/${name}`),
    ),
  ]
  for (const project of projects) {
    for (const file of pnpmFiles) {
      const path = join(root, project, file)
      if (existsSync(path)) {
        failures.push(
          `${rel(path)}: pnpm reads settings or a manifest from it; the layout is pinned to package.json and pnpm-workspace.yaml`,
        )
      }
    }
    const path = join(root, project, "package.json")
    if (!existsSync(path)) continue
    const manifest = readManifest(path)
    if (manifest === null) continue
    for (const violation of manifestViolations(manifest, extensionNames)) {
      failures.push(`${rel(path)}: ${violation}`)
    }
  }

  for (const top of ["packages", "extensions"]) {
    const directory = join(root, top)
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory).sort()) {
      if (lstatSync(join(directory, name)).isSymbolicLink()) {
        failures.push(`${top}/${name}: a symbolic link in a unit can lead into another`)
      }
    }
  }
  const unitNames = new Set(
    ["packages", "extensions"].flatMap((top) =>
      units(join(root, top)).map((name) => `${top}/${name}`),
    ),
  )
  for (const unit of unitNames) {
    for (const link of links(join(root, unit))) {
      failures.push(`${rel(link)}: a symbolic link in a unit can lead into another`)
    }
    for (const link of strayLinks(join(root, unit, "node_modules"))) {
      failures.push(
        `${rel(link)}: a symbolic link pnpm did not make can lead into another unit`,
      )
    }
  }
  return failures
}

// Compared by real path: run through a symlink (macOS's /tmp is one), argv
// names the link while import.meta.url names the file, and a plain comparison
// would skip the check and exit 0.
const invoked =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invoked) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..")
  const failures = checkRepository(root)
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }
}
