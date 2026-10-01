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
 * What install and build write at a unit's root: pnpm's links and the build's
 * output. Only there — a `dist` or `node_modules` deeper in a unit is source
 * like any other.
 */
const skipped = new Set(["node_modules", "dist"])

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
