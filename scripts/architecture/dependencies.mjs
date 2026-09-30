/**
 * What an extension and a package may depend on. Pure: each function is given
 * text and names and reads nothing itself, so its tests can hand it any
 * layout. `check-architecture.mjs` walks the tree and supplies them.
 *
 * The rules, from docs/adr/todo/1-extensions-repo.md, are that an extension
 * depends on nothing in another extension, and a package on nothing in any
 * extension. Another unit is reached only by package name, through a manifest.
 * This module holds the source half; three constraints in all:
 *
 * - **Nothing installed is an extension** (`installed.mjs`, run after
 *   install by `check-installed.mjs`): whatever a manifest, override, or
 *   setting says, no `node_modules` outside an extension holds a link into it
 *   or a copy of a package from it.
 * - **A quoted relative path does not reach into another unit**
 *   (`relativePathViolations`). Every quoted `./` or `../` path in any file of
 *   an extension or a package must not resolve into another extension or
 *   package. It may leave its own unit for somewhere that is neither — the
 *   repository root's shared configuration, a build directory.
 * - **No symbolic link in a unit** (`check-architecture.mjs`), since a link
 *   makes a path inside the unit lead into another.
 *
 * What none of these sees: a path assembled at run time, and an unquoted one —
 * a CSS `url(../x)`, an HTML attribute written without quotes.
 */
import { posix } from "node:path"

/**
 * The unit a repository-relative path is in: `extensions/<name>` or
 * `packages/<name>`, or null for anything else — the root, `scripts/`, and a
 * file directly in `extensions/` or `packages/`, such as its README.
 */
export function unitOf(path) {
  const [top, name, ...inside] = posix.normalize(path).split("/")
  if (inside.length === 0) return null
  if (top === "extensions" || top === "packages") return `${top}/${name}`
  return null
}

/**
 * Every quoted relative path in a file: a string literal — single, double, or
 * backtick-quoted without interpolation — that begins `./` or `../`. In
 * source, that is every static import, `export … from`, dynamic `import()`,
 * `require`, and `new URL(…, import.meta.url)`; in configuration, HTML, and
 * CSS, every path written in quotes.
 */
export function relativePaths(text) {
  return [...text.matchAll(/(["'`])(\.\.?\/[^"'`$\n]*)\1/g)].map((match) => match[2])
}

/**
 * The paths in a file that reach into another unit, one message each.
 *
 * @param {string} path repository-relative path, forward slashes
 * @param {string} text the file's contents
 * @param {Set<string>} units every unit in the repository, as `unitOf` names
 *   them — a path into a directory that is not one reaches nothing to depend on
 */
export function relativePathViolations(path, text, units) {
  const unit = unitOf(path)
  if (unit === null) return []
  const violations = []
  for (const relative of relativePaths(text)) {
    const [top, name] = posix
      .normalize(posix.join(posix.dirname(path), relative))
      .split("/")
    const reached = `${top}/${name}`
    if (reached === unit || !units.has(reached)) continue
    violations.push(
      `"${relative}" reaches into ${reached}; reach another unit by package name, through its manifest`,
    )
  }
  return violations
}
