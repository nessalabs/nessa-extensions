#!/usr/bin/env node
/**
 * The architecture check: what an extension and a package may depend on
 * (scripts/architecture/dependencies.mjs). Bare Node, no dependencies — CI runs
 * it before `pnpm install`. Failures are printed as `path: rule`, one per line,
 * on stderr, and the exit status is 1.
 *
 *   node scripts/check-architecture.mjs [root]   check root, or this repository
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  manifestViolations,
  relativePathViolations,
} from "./architecture/dependencies.mjs"

/** Installed and built files are not ours to check. */
const skipped = new Set(["node_modules", "dist"])
/** Files whose quoted relative paths can reach another unit. */
const checkedFile = /\.(?:[cm]?[jt]sx?|html|css)$/

function walk(directory) {
  const files = []
  for (const name of readdirSync(directory).sort()) {
    if (skipped.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else if (checkedFile.test(name)) files.push(path)
  }
  return files
}

/** The units under `extensions/` or `packages/`. A dot-directory is not one. */
const units = (path) =>
  existsSync(path)
    ? readdirSync(path)
        .sort()
        .filter(
          (name) => !name.startsWith(".") && statSync(join(path, name)).isDirectory(),
        )
    : []

/**
 * Every failure in the repository at `root`, as `path: rule` lines. An
 * extension is one package, so each needs a `package.json` naming it: without
 * that name, a dependency on it could not be recognised.
 */
export function checkRepository(root) {
  const failures = []
  const rel = (path) => relative(root, path).split(sep).join("/")

  /**
   * A manifest's contents, or null when it is absent or unreadable — recorded
   * once, however often it is asked for.
   */
  const read = new Map()
  const readManifest = (path) => {
    if (!read.has(path)) {
      let manifest = null
      if (existsSync(path)) {
        try {
          manifest = JSON.parse(readFileSync(path, "utf8"))
        } catch {
          failures.push(`${rel(path)}: is not valid JSON`)
        }
      }
      read.set(path, manifest)
    }
    return read.get(path)
  }

  const extensionPackages = new Map()
  for (const name of units(join(root, "extensions"))) {
    const path = join(root, "extensions", name, "package.json")
    if (!existsSync(path)) {
      failures.push(`${rel(path)}: an extension is one package and needs a manifest`)
      continue
    }
    const manifest = readManifest(path)
    if (manifest === null) continue
    if (typeof manifest.name !== "string" || manifest.name === "") {
      failures.push(`${rel(path)}: an extension's manifest names its package`)
      continue
    }
    extensionPackages.set(name, manifest.name)
  }

  const manifests = [
    join(root, "package.json"),
    ...["packages", "extensions"].flatMap((top) =>
      units(join(root, top)).map((name) => join(root, top, name, "package.json")),
    ),
  ]
  for (const path of manifests) {
    const manifest = readManifest(path)
    if (manifest === null) continue
    for (const violation of manifestViolations(rel(path), manifest, extensionPackages)) {
      failures.push(`${rel(path)}: ${violation}`)
    }
  }

  for (const top of ["packages", "extensions"]) {
    for (const name of units(join(root, top))) {
      for (const file of walk(join(root, top, name))) {
        const path = rel(file)
        for (const violation of relativePathViolations(
          path,
          readFileSync(file, "utf8"),
        )) {
          failures.push(`${path}: ${violation}`)
        }
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
