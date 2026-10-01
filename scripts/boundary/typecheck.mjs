#!/usr/bin/env node
/**
 * Typechecks every unit — each package and each extension — as its own
 * TypeScript program with `rootDir` set to the unit's folder, so TypeScript
 * refuses any source outside it (TS6059): a sibling extension, the rest of the
 * repository, a path out however it is spelled. After `pnpm install`.
 *
 * The unit's `tsconfig.json` supplies its compiler options — its `lib`, its
 * `types` — and nothing else: the program is every TypeScript and JavaScript
 * file in the unit (less its root `node_modules` and `dist`), whatever the
 * configuration's `include`, `files`, or `references` say, with `rootDir` the
 * unit's folder, `allowJs` on so JavaScript's imports are followed too, and
 * `noCheck` off. So a unit cannot narrow what is checked or widen where it
 * may reach.
 *
 * A workspace package the unit declares is reached through its
 * `node_modules`, which TypeScript treats as a library rather than a source of
 * the unit, and passes. One it does not declare is not linked there, so it
 * does not resolve.
 *
 * What `rootDir` does not see, and so what is held elsewhere: a symbolic link
 * inside the unit, which TypeScript does not follow to its real path for a
 * relative import — `pnpm architecture` refuses one before install — and a
 * declaration file (`.d.ts`) outside the unit, which is not a source and is
 * held by review. Neither is bundled unchecked: see `build.mjs`.
 *
 * Diagnostics go to stderr; the exit status is 1 if any unit fails.
 *
 *   node scripts/boundary/typecheck.mjs [root]   typecheck root's units, or this repository's
 */
import { readdirSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import ts from "typescript"

import { units } from "./units.mjs"

const sources = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** What install and build write at a unit's root, and are not its sources. */
const skipped = new Set(["node_modules", "dist"])

/** Every TypeScript and JavaScript file under `directory`. */
function sourceFiles(directory, atUnitRoot = true) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (atUnitRoot && skipped.has(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path, false)
    return entry.isFile() && sources.test(entry.name) ? [path] : []
  })
}

const host = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => "\n",
}

/** The diagnostics of `unit`, formatted; empty when it typechecks. */
export function typecheckUnit(root, unit) {
  const directory = join(root, unit)
  const configErrors = []
  const config = ts.getParsedCommandLineOfConfigFile(
    join(directory, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => configErrors.push(d) },
  )
  if (config === undefined) return ts.formatDiagnostics(configErrors, host)
  const program = ts.createProgram({
    rootNames: sourceFiles(directory),
    options: {
      ...config.options,
      rootDir: directory,
      allowJs: true,
      noCheck: false,
      noEmit: true,
    },
  })
  const diagnostics = [
    ...config.errors.filter((d) => d.code !== 18003), // "no inputs": the files are ours
    ...ts.getPreEmitDiagnostics(program),
  ]
  return ts.formatDiagnostics(diagnostics, host)
}

/** The units under `root` that fail to typecheck, after printing why. */
export function typecheckAll(root) {
  const failed = []
  for (const unit of units(root)) {
    const report = typecheckUnit(root, unit)
    if (report === "") continue
    process.stderr.write(report)
    failed.push(unit)
  }
  return failed
}

const invoked =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invoked) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "../..")
  const failed = typecheckAll(root)
  if (failed.length > 0) {
    for (const unit of failed)
      console.error(`${unit}: does not typecheck within its folder`)
    process.exit(1)
  }
}
