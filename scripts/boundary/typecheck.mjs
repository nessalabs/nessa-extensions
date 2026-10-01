#!/usr/bin/env node
/**
 * Typechecks every unit — each package and each extension — as its own
 * TypeScript project, with `rootDir` set to the unit's folder, so `tsc`
 * refuses any source file outside it (TS6059): a sibling extension, the rest
 * of the repository, a path out however it is spelled. After `pnpm install`.
 *
 * `rootDir` is given on the command line, which overrides the unit's
 * `tsconfig.json`, so a unit cannot widen it. A workspace package the unit
 * declares is reached through its `node_modules`, which TypeScript treats as
 * a library rather than a source of the unit, and passes. One it does not
 * declare is not linked there, so it does not resolve.
 *
 * What `rootDir` does not see: a symbolic link inside the unit, which
 * TypeScript does not follow to its real path for a relative import —
 * `pnpm architecture` refuses one before install — and a declaration file
 * (`.d.ts`), which is not a source. Neither is bundled unchecked:
 * `build.mjs` follows every file to its real path.
 *
 * tsc's own output goes to stderr; the exit status is 1 if any unit fails.
 *
 *   node scripts/boundary/typecheck.mjs [root]   typecheck root's units, or this repository's
 */
import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { units } from "./units.mjs"

const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc")

/** The units under `root` that fail to typecheck. */
export function typecheckAll(root) {
  const failed = []
  for (const unit of units(root)) {
    const directory = join(root, unit)
    const result = spawnSync(
      process.execPath,
      [tsc, "-p", directory, "--rootDir", directory],
      { stdio: ["ignore", 2, 2] },
    )
    if (result.status !== 0) failed.push(unit)
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
