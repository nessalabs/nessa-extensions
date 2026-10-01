#!/usr/bin/env node
/**
 * Builds every extension with Vite, each in a copy of the repository that
 * holds only what the extension may use, and refuses any build whose modules
 * come from anywhere else (`allow-list.mjs`). After `pnpm install`.
 *
 * - **The stage.** An extension is built in a new directory laid out as the
 *   repository but holding only the extension, the workspace packages it
 *   declares (`units.mjs`), pnpm's store (`node_modules/.pnpm`, linked), and
 *   the shared compiler settings (`sharedFiles`).
 *   Whatever the build reads by a relative path — a module, an asset, a
 *   stylesheet `@import`, an `.env` file, the public directory, the Vite
 *   configuration's own imports — can only find what is there. A sibling
 *   extension, an undeclared package, and a file at the repository's root
 *   are not there, so the build fails to find them, however they are spelled
 *   and whichever part of the toolchain looks.
 * - **The module graph.** Every module each environment's bundler loaded,
 *   and each worker's, is followed to its real path and checked against the
 *   allow-list. That catches what the stage cannot: a module reached by an
 *   absolute path or through a link that leads back into the repository. A
 *   module that is neither a virtual one (`\0…`) nor a file on disk is
 *   refused, since where it came from cannot be checked.
 *
 * Not held here, and so held by review: a file outside the module graph — an
 * asset, a stylesheet, an `.env` file — named by an absolute path into the
 * repository; and anything the Vite configuration's own code does, which runs
 * with Node's full access. A symbolic link in a unit is refused before install
 * (`scripts/check-architecture.mjs`), and copied into the stage as it is.
 *
 * An extension is built from its `vite.config.ts`, with its folder in the
 * stage as the working directory, so it must declare what that file imports,
 * Vite included. Its output is its `dist`, copied back only when the build
 * passes; a refused build leaves none. One without `vite.config.ts` has
 * nothing to build and is said so on stderr.
 *
 * Refusals, and builds that fail, are printed as `unit: what` lines on
 * stderr, and the exit status is 1.
 *
 *   node scripts/boundary/build.mjs [root]   build root's extensions, or this repository's
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"

import { createBuilder } from "vite"

import { moduleRefusal } from "./allow-list.mjs"
import { declaredPackages, units } from "./units.mjs"

const configFile = "vite.config.ts"
const output = "dist"

/**
 * The repository's own files a build may read: the shared compiler settings,
 * which every unit's `tsconfig.json` extends and Vite reads to transform it.
 */
const sharedFiles = ["tsconfig.base.json"]

/**
 * A new directory laid out as the repository at `root`, holding copies of
 * `paths` and `sharedFiles` and a link to pnpm's store; its real path.
 * Links are copied as they are, so pnpm's relative ones resolve in the stage.
 */
function stage(root, paths) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "nessa-extensions-build-")))
  for (const path of paths) {
    const from = join(root, path)
    cpSync(from, join(directory, path), { recursive: true, verbatimSymlinks: true })
  }
  for (const file of sharedFiles) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(directory, file))
  }
  const store = join(root, "node_modules", ".pnpm")
  if (existsSync(store)) {
    mkdirSync(join(directory, "node_modules"))
    symlinkSync(store, join(directory, "node_modules", ".pnpm"))
  }
  return directory
}

/** A plugin that hands every module of a build to `check` when it ends. */
const moduleGraph = (check) => ({
  name: "nessa:boundary-modules",
  buildEnd() {
    for (const id of this.getModuleIds()) check(id)
  },
})

/**
 * Builds `unit` and returns one line for each module its build may not use,
 * and one if the build failed.
 *
 * @param {string} root the repository, as a real path
 * @param {string} unit `extensions/<name>`
 */
export async function buildExtension(root, unit) {
  const declared = declaredPackages(root, unit)
  const staged = stage(root, [unit, ...declared])
  const refused = new Map()
  const check = (id) => {
    if (id.startsWith("\0")) return
    const file = id.split("?")[0]
    let real = null
    try {
      if (isAbsolute(file)) real = realpathSync(file)
    } catch {
      // not on disk: refused below
    }
    if (real === null) {
      refused.set(
        id,
        "which is not a file on disk, so where it comes from cannot be checked",
      )
      return
    }
    const inStage = real === staged || real.startsWith(`${staged}${sep}`)
    const at = relative(inStage ? staged : root, real)
      .split(sep)
      .join("/")
    const why = moduleRefusal(at, unit, declared)
    if (why !== null && !refused.has(at)) refused.set(at, why)
  }
  const boundary = {
    ...moduleGraph(check),
    // Workers are built separately, with `worker.plugins` only.
    config(config) {
      const own = config.worker?.plugins
      return {
        worker: { plugins: () => [...(own ? own() : []), moduleGraph(check)] },
      }
    },
  }

  const failures = []
  const directory = join(staged, unit)
  const previous = process.cwd()
  try {
    process.chdir(directory)
    const builder = await createBuilder({
      configFile: join(directory, configFile),
      logLevel: "warn",
      plugins: [boundary],
    })
    await builder.buildApp()
  } catch (error) {
    // One line, so each failure stays one `unit: what` line.
    const why = stripVTControlCharacters(String(error?.message ?? error))
      .replace(/^\s*Build failed with \d+ errors?:/, "")
      .replace(/\s+/g, " ")
      .trim()
    failures.push(`${unit}: the build failed: ${why}`)
  } finally {
    process.chdir(previous)
  }
  for (const [path, why] of refused) {
    failures.push(`${unit}: its build uses ${path}, ${why}`)
  }
  const built = join(root, unit, output)
  rmSync(built, { recursive: true, force: true })
  if (failures.length === 0 && existsSync(join(directory, output))) {
    cpSync(join(directory, output), built, { recursive: true })
  }
  rmSync(staged, { recursive: true, force: true })
  return failures
}

/** Builds every extension under `root`; every failure, as `unit: what` lines. */
export async function buildAll(root) {
  const real = realpathSync(root)
  const failures = []
  for (const unit of units(real).filter((path) => path.startsWith("extensions/"))) {
    if (!existsSync(join(real, unit, configFile))) {
      console.error(`${unit}: no ${configFile}, so nothing to build`)
      continue
    }
    failures.push(...(await buildExtension(real, unit)))
  }
  return failures
}

const invoked =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invoked) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "../..")
  const failures = await buildAll(root)
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }
}
