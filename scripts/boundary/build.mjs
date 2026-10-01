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
 *   are not there, so a path to them through the stage finds nothing,
 *   however it is spelled and whichever part of the toolchain follows it. A
 *   path that climbs back out through the store's link is the module graph's
 *   to catch. The store holds no workspace
 *   project, because the pinned layout requires `hoistWorkspacePackages:
 *   false` (`scripts/architecture/layout.mjs`).
 * - **The module graph.** Every module each environment's bundler loaded,
 *   and each worker's, is followed to its real path and checked against the
 *   allow-list. That catches what the stage cannot: a module reached by an
 *   absolute path or through a link that leads back into the repository. A
 *   module named rather than pathed — a server build's `node:fs` or npm
 *   dependency, left as an import — passes, and so does a virtual one
 *   (`\0…`). Any other module that is not a file on disk, such as an import
 *   left in the output by its path, is refused, since where it leads cannot
 *   be checked.
 *
 * Not held here: what the Vite configuration imports, which is bundled before
 * the build and so is in no module graph — `typecheck.mjs` checks it, with
 * every other file of the unit. Held by review: a file outside the module
 * graph — an asset, a stylesheet, an `.env` file, or code a stylesheet tool
 * loads, such as Tailwind's `@plugin` or `@config` — named by an absolute path
 * into the repository, or by one that climbs out through the store's link
 * (Vite resolves the `..` in those as text, so today it finds nothing there);
 * anything the Vite configuration's own code does when it runs, with Node's
 * full access; and the dev server, which is not a build. A symbolic link in a
 * unit is refused before install (`scripts/check-architecture.mjs`), and
 * copied into the stage as it is.
 *
 * An extension is built from its `vite.config.ts`, with its folder in the
 * stage as the working directory, so it must declare what that file imports,
 * Vite included. Its output is its `dist`, copied back only when the build
 * passes; a refused build leaves none, and a build that writes no `dist` fails. One without `vite.config.ts` has
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
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"

import { createBuilder } from "vite"

import { moduleRefusal, repositoryPath } from "./allow-list.mjs"
import { moduleJudge, realOrNull } from "./modules.mjs"
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
    symlinkSync(store, join(directory, "node_modules", ".pnpm"), "junction")
  }
  return directory
}

/**
 * The links pnpm makes in `directory`'s `node_modules`: each entry, each
 * entry of a `@scope`. (pnpm writes `.bin` as scripts, not links.)
 */
function installedLinks(directory) {
  const modules = join(directory, "node_modules")
  if (!existsSync(modules)) return []
  return readdirSync(modules)
    .flatMap((name) => {
      const path = join(modules, name)
      const nested = name.startsWith("@") && !lstatSync(path).isSymbolicLink()
      return nested ? readdirSync(path).map((inner) => join(path, inner)) : [path]
    })
    .filter((path) => lstatSync(path).isSymbolicLink())
}

/** A plugin that hands every module of a build to `check` when it ends. */
const moduleGraph = (check) => ({
  name: "nessa:boundary-modules",
  buildEnd() {
    for (const id of this.getModuleIds()) check(id)
  },
})

/** One line, so each failure stays one `unit: what` line. */
const oneLine = (error) =>
  stripVTControlCharacters(String(error?.message ?? error))
    .replace(/^\s*Build failed with \d+ errors?:/, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Builds `unit` and returns one line for each module its build may not use,
 * and one if the build failed.
 *
 * @param {string} root the repository, as a real path
 * @param {string} unit `extensions/<name>`
 */
export async function buildExtension(root, unit) {
  const failures = []
  const refused = new Map()
  const previous = process.cwd()
  let staged = null
  try {
    const declared = declaredPackages(root, unit)
    staged = stage(root, [unit, ...declared])
    const judge = moduleJudge({
      root,
      unit,
      declared,
      base: join(staged, unit),
      copy: staged,
    })
    const check = (id) => {
      const refusal = judge(id)
      if (refusal !== null && !refused.has(refusal[0])) refused.set(...refusal)
    }
    // What the stage copies of each unit's node_modules is followed by more
    // than the bundler — a stylesheet's @import, an asset — so each link pnpm
    // made there must lead where the extension may reach, as it was installed.
    for (const path of [unit, ...declared]) {
      for (const link of installedLinks(join(root, path))) {
        const real = realOrNull(link)
        if (real === null) continue // leads nowhere, so nothing is read through it
        const target = repositoryPath(root, real)
        // A link to a directory is judged as what is in it.
        const inside = lstatSync(real).isDirectory() ? `${target}/` : target
        const why = moduleRefusal(inside, unit, declared)
        if (why !== null)
          refused.set(repositoryPath(root, link), `which links to ${target}, ${why}`)
      }
    }
    const boundary = {
      ...moduleGraph(check),
      // Workers are built separately, with `worker.plugins` only. Vite adds
      // these to the configuration's own.
      config: () => ({ worker: { plugins: () => [moduleGraph(check)] } }),
    }

    const directory = join(staged, unit)
    try {
      process.chdir(directory)
      const builder = await createBuilder({
        configFile: join(directory, configFile),
        logLevel: "warn",
        plugins: [boundary],
      })
      await builder.buildApp()
    } catch (error) {
      failures.push(`${unit}: the build failed: ${oneLine(error)}`)
    }
    for (const [path, why] of refused) {
      failures.push(`${unit}: its build uses ${path}, ${why}`)
    }
    const built = join(root, unit, output)
    rmSync(built, { recursive: true, force: true })
    if (failures.length === 0) {
      if (existsSync(join(directory, output))) {
        cpSync(join(directory, output), built, { recursive: true })
      } else {
        failures.push(
          `${unit}: its build wrote no ${output}, which is where its output goes`,
        )
      }
    }
  } catch (error) {
    failures.push(`${unit}: could not be built: ${oneLine(error)}`)
  } finally {
    process.chdir(previous)
    if (staged !== null) rmSync(staged, { recursive: true, force: true })
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
