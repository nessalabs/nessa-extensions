#!/usr/bin/env node
/**
 * The architecture check: what an extension and a package may import
 * (scripts/architecture/imports.mjs). Bare Node, no dependencies, so it runs
 * before `pnpm install` as well as after. Failures are the rule and the file
 * that broke it.
 *
 *   node scripts/check-architecture.mjs          check this repository
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { importViolations } from "./architecture/imports.mjs"

const skipped = new Set(["node_modules", "dist"])
const source = /\.(?:[cm]?[jt]s|tsx|jsx)$/

function walk(directory) {
  const files = []
  for (const name of readdirSync(directory).sort()) {
    if (skipped.has(name)) continue
    const path = join(directory, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else if (source.test(name)) files.push(path)
  }
  return files
}

const directories = (path) =>
  existsSync(path)
    ? readdirSync(path)
        .sort()
        .filter((name) => statSync(join(path, name)).isDirectory())
    : []

/**
 * Every failure in the repository at `root`, as `path: rule` lines. An
 * extension is one package, so each needs a `package.json` naming it: without
 * that name, an import of it by name could not be recognised.
 */
export function checkRepository(root) {
  const failures = []
  const rel = (path) => relative(root, path).split(sep).join("/")

  const extensionPackages = new Map()
  for (const name of directories(join(root, "extensions"))) {
    const manifest = join(root, "extensions", name, "package.json")
    if (!existsSync(manifest)) {
      failures.push(`${rel(manifest)}: an extension is one package and needs a manifest`)
      continue
    }
    const packageName = JSON.parse(readFileSync(manifest, "utf8")).name
    if (typeof packageName !== "string" || packageName === "") {
      failures.push(`${rel(manifest)}: an extension's manifest names its package`)
      continue
    }
    extensionPackages.set(name, packageName)
  }

  for (const top of ["packages", "extensions"]) {
    const directory = join(root, top)
    if (!existsSync(directory)) continue
    for (const file of walk(directory)) {
      const path = rel(file)
      for (const violation of importViolations(
        path,
        readFileSync(file, "utf8"),
        extensionPackages,
      )) {
        failures.push(`${path}: ${violation}`)
      }
    }
  }
  return failures
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const failures = checkRepository(join(dirname(fileURLToPath(import.meta.url)), ".."))
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }
}
