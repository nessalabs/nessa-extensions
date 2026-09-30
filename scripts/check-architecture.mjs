#!/usr/bin/env node
/**
 * The architecture check: what an extension and a package may depend on
 * (scripts/architecture/dependencies.mjs). Bare Node, no dependencies — CI runs
 * it before `pnpm install`. Failures are printed as `path: rule`, one per line,
 * on stderr, and the exit status is 1.
 *
 *   node scripts/check-architecture.mjs [root]   check root, or this repository
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  lockfileViolations,
  relativePathViolations,
} from "./architecture/dependencies.mjs"

/** Installed and built files are not ours to check. */
const skipped = new Set(["node_modules", "dist"])

/**
 * Every file under `directory`, and every symbolic link, which is not
 * followed. Every file, not a list of kinds: a quoted path in a config, an
 * HTML page, or a component format nobody listed reaches as far as one in
 * TypeScript.
 */
function walk(directory) {
  const found = { files: [], links: [] }
  for (const name of readdirSync(directory).sort()) {
    if (skipped.has(name)) continue
    const path = join(directory, name)
    const entry = lstatSync(path)
    if (entry.isSymbolicLink()) found.links.push(path)
    else if (entry.isDirectory()) {
      const inner = walk(path)
      found.files.push(...inner.files)
      found.links.push(...inner.links)
    } else found.files.push(path)
  }
  return found
}

/** Text, or null for a binary file, which holds no paths to read. */
function text(path) {
  const contents = readFileSync(path)
  return contents.includes(0) ? null : contents.toString("utf8")
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

  for (const name of units(join(root, "extensions"))) {
    const path = join(root, "extensions", name, "package.json")
    if (!existsSync(path)) {
      failures.push(`${rel(path)}: an extension is one package and needs a manifest`)
    }
  }

  // What the workspace depends on is what pnpm resolved. With no lockfile there
  // is nothing to check, and CI's `pnpm install --frozen-lockfile` refuses to
  // run, so its absence is a failure here too rather than a pass.
  const lockfile = join(root, "pnpm-lock.yaml")
  const extensions = new Set(
    units(join(root, "extensions")).map((name) => `extensions/${name}`),
  )
  if (!existsSync(lockfile)) {
    failures.push(
      "pnpm-lock.yaml: is missing, so what the workspace depends on is unknown",
    )
  } else {
    for (const violation of lockfileViolations(
      readFileSync(lockfile, "utf8"),
      extensions,
    )) {
      failures.push(`pnpm-lock.yaml: ${violation}`)
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
    const { files, links } = walk(join(root, unit))
    for (const link of links) {
      failures.push(`${rel(link)}: a symbolic link in a unit can lead into another`)
    }
    for (const file of files) {
      const path = rel(file)
      const contents = text(file)
      if (contents === null) continue
      for (const violation of relativePathViolations(path, contents, unitNames)) {
        failures.push(`${path}: ${violation}`)
      }
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
