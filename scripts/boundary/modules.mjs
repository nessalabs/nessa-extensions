/**
 * Judging a module the toolchain loaded, by where it really is. Shared by the
 * build (`build.mjs`) and the test run (`vitest.mjs`), which hand it every
 * module id their bundler loads.
 *
 * - A virtual module (`\0…`) passes: a plugin made it, and plugins come from
 *   the configuration, which review holds.
 * - An id that is a file — whatever its shape, a relative one taken from
 *   `base` — is followed with the system's `realpath`, which follows each link
 *   before the `..` after it, as a read does (Node's own resolves `..` first,
 *   as text), and judged by the allow-list (`allow-list.mjs`).
 * - An id that is no file passes if it is a name: a Node built-in, or an npm
 *   package left as an import, resolved where the unit is installed. Any other
 *   — a path to nothing, or a plugin's virtual module named like a path — is
 *   refused, since where it leads cannot be checked.
 */
import { realpathSync } from "node:fs"
import { isAbsolute, sep } from "node:path"

import { moduleRefusal, repositoryPath } from "./allow-list.mjs"

const isName = (id) =>
  id.startsWith("node:") ||
  !(id.startsWith(".") || isAbsolute(id) || /^[a-z]+:/i.test(id))

/** The system's real path of `path`, or null if nothing is there. */
export function realOrNull(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/**
 * A function that judges a module id for `unit`: null if it may use it, or
 * `[path, why]` if not, where `path` is where it leads.
 *
 * @param {object} options
 * @param {string} options.root the repository, as a real path
 * @param {string} options.unit `extensions/<name>` or `packages/<dir>`
 * @param {Set<string>} options.declared the packages it may use
 * @param {string} options.base the directory a relative id is taken from
 * @param {string} [options.copy] a real directory laid out as the
 *   repository, whose files count as the repository's (the build's stage)
 */
export function moduleJudge({ root, unit, declared, base, copy }) {
  return (id) => {
    if (id.startsWith("\0")) return null
    const file = id.split("?")[0]
    // Joined as text, not normalised, so a `..` after a link climbs from
    // where the link leads.
    const real = realOrNull(isAbsolute(file) ? file : `${base}/${file}`)
    if (real === null) {
      if (isName(id)) return null
      return [id, "which is not a file on disk, so where it comes from cannot be checked"]
    }
    const inCopy =
      copy !== undefined && (real === copy || real.startsWith(`${copy}${sep}`))
    const path = repositoryPath(inCopy ? copy : root, real)
    const why = moduleRefusal(path, unit, declared)
    return why === null ? null : [path, why]
  }
}
