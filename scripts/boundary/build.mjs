#!/usr/bin/env node
/**
 * Builds every extension with Vite and refuses any build that reads a file
 * the extension may not use (`allow-list.mjs`). After `pnpm install`.
 *
 * What a build reads is taken from the toolchain, not from source text: the
 * bundler's module graph, which holds every module it resolved and loaded,
 * and every file Vite reads through Node's `fs` (`reads.mjs`), which holds the
 * assets and inlined styles that never enter the graph. Each is followed to
 * its real path, so a symbolic link counts where it leads, and is checked
 * there.
 *
 * An extension is built from its `vite.config.ts`, with its folder as the
 * working directory, as `vite build` there would. One without that file has
 * nothing to build and is said so on stderr.
 *
 * Refusals, and builds that fail, are printed as `unit: what` lines on
 * stderr, and the exit status is 1.
 *
 *   node scripts/boundary/build.mjs [root]   build root's extensions, or this repository's
 */
import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createBuilder } from "vite"

import { readRefusal } from "./allow-list.mjs"
import { watchReads } from "./reads.mjs"
import { declaredPackages, units } from "./units.mjs"

const configFile = "vite.config.ts"

/**
 * Builds `unit` and returns one line for each file its build read but may
 * not, and one if the build failed.
 *
 * @param {string} root the repository, as a real path
 * @param {string} unit `extensions/<name>`
 */
export async function buildExtension(root, unit) {
  const declared = declaredPackages(root, unit)
  const refused = new Map()
  const check = (path) => {
    let real
    try {
      real = realpathSync(path instanceof URL ? fileURLToPath(path) : String(path))
    } catch {
      return // nothing there; the read fails by itself
    }
    const at = relative(root, real).split(sep).join("/")
    const why = readRefusal(at, unit, declared)
    if (why !== null && !refused.has(at)) refused.set(at, why)
  }
  const graph = {
    name: "nessa:boundary",
    buildEnd() {
      for (const id of this.getModuleIds()) {
        const file = id.split("?")[0]
        if (isAbsolute(file)) check(file)
      }
    },
  }

  const failures = []
  const directory = join(root, unit)
  const previous = process.cwd()
  const stop = watchReads(check)
  try {
    process.chdir(directory)
    const builder = await createBuilder({
      configFile: join(directory, configFile),
      logLevel: "warn",
      plugins: [graph],
    })
    await builder.buildApp()
  } catch (error) {
    const why = error.message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !/^Build failed with \d+ errors?:$/.test(line))
    failures.push(`${unit}: the build failed: ${why}`)
  } finally {
    stop()
    process.chdir(previous)
  }
  for (const [path, why] of refused) {
    failures.push(`${unit}: its build reads ${path}, ${why}`)
  }
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
