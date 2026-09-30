#!/usr/bin/env node
/**
 * The architecture check, install half: nothing installed in the workspace is
 * an extension (scripts/architecture/installed.mjs). Bare Node, no
 * dependencies; run after `pnpm install`. Failures are printed as
 * `path: rule`, one per line, on stderr, and the exit status is 1.
 *
 *   node scripts/check-installed.mjs [root]   check root, or this repository
 */
import { realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { installedViolations } from "./architecture/installed.mjs"

// Compared by real path, as in check-architecture.mjs: through a symlink, argv
// names the link while import.meta.url names the file.
const invoked =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invoked) {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..")
  const failures = installedViolations(root)
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }
}
