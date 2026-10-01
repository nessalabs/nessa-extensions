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
 * `noCheck` and `noResolve` off. So a unit cannot narrow what is checked or widen where it
 * may reach.
 *
 * Then every file in the program — every source, every module it resolved,
 * JSON included, every declaration file — is followed to its real path and
 * checked against the same allow-list as the build (`allow-list.mjs`): the
 * unit, the packages it declares, and npm. That catches what `rootDir` does
 * not: TypeScript takes any path through a `node_modules` directory for a
 * library and exempts it from `rootDir`, and it never applies `rootDir` to
 * declaration or JSON files, and does not follow a symbolic link to where it
 * leads. So are the paths the unit's files import that TypeScript did not
 * resolve — a side-effect import, one with a `?query` a bundler reads — since
 * Vitest and Vite would still load them (`pathImports`).
 *
 * Vitest and the dev server load what they import at run time, unguarded;
 * what holds them is that this checks every file they run from.
 *
 * Diagnostics go to stderr; the exit status is 1 if any unit fails.
 *
 *   node scripts/boundary/typecheck.mjs [root]   typecheck root's units, or this repository's
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import ts from "typescript"

import { moduleRefusal, repositoryPath } from "./allow-list.mjs"
import { declaredPackages, units } from "./units.mjs"

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

/**
 * The real path of `path`, or null if there is nothing there. The system's
 * own `realpath`, which follows each link before the `..` after it; Node's
 * own resolves `..` first, as text.
 */
function realOrNull(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * Where each path import in `file` leads, as real paths: every import,
 * dynamic import, and `require` named by a relative or absolute path, with
 * any `?query` or `#hash` cut off. The path is joined unnormalised, so a `..`
 * after a link climbs from where the link leads, as the file system does.
 * When nothing is there — a file named without its extension — its directory
 * is followed instead, so where it would lead is still known.
 */
function pathImports(file) {
  const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true)
  return importedFiles.flatMap(({ fileName }) => {
    if (!fileName.startsWith(".") && !isAbsolute(fileName)) return []
    const spec = fileName.replace(/[?#].*$/, "")
    const path = isAbsolute(spec) ? spec : `${dirname(file)}/${spec}`
    const real = realOrNull(path)
    if (real !== null) return [real]
    const cut = path.lastIndexOf("/")
    const directory = realOrNull(path.slice(0, cut))
    return directory === null ? [] : [`${directory}/${path.slice(cut + 1)}`]
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
  const files = sourceFiles(directory)
  const program = ts.createProgram({
    rootNames: files,
    options: {
      ...config.options,
      rootDir: directory,
      allowJs: true,
      noCheck: false,
      noResolve: false,
      noEmit: true,
    },
  })
  const diagnostics = [
    ...config.errors.filter((d) => d.code !== 18003), // "no inputs": the files are ours
    ...ts.getPreEmitDiagnostics(program),
  ]
  const declared = declaredPackages(root, unit)
  const used = new Set([
    ...program.getSourceFiles().map((file) => realpathSync(file.fileName)),
    ...files.flatMap(pathImports),
  ])
  const refusals = [...used]
    .map((real) => repositoryPath(root, real))
    .flatMap((path) => {
      const why = moduleRefusal(path, unit, declared)
      return why === null ? [] : [`${unit}: its program uses ${path}, ${why}\n`]
    })
  return ts.formatDiagnostics(diagnostics, host) + refusals.join("")
}

/** The units under `root` that fail to typecheck, after printing why. */
export function typecheckAll(given) {
  const root = realpathSync(given)
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
