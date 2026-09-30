/**
 * What an extension's and a package's files may reach. Pure: each function is
 * given text and names and reads nothing itself. `check-architecture.mjs` walks
 * the tree and supplies them.
 *
 * The rule, from docs/adr/todo/1-extensions-repo.md, is that an extension
 * depends on nothing in another extension, and a package on nothing in any
 * extension; another unit is reached only by package name, through a manifest.
 * Manifests and the install layout are held by `layout.mjs`. This module holds
 * the files:
 *
 * - **A quoted relative path does not reach into another unit**
 *   (`relativePathViolations`). Every quoted path in any file of an extension
 *   or a package that begins `./` or `../`, or climbs with `..` anywhere in it,
 *   resolved from the file's directory, must not lead into another unit. It
 *   may leave its own unit for somewhere that is neither — the repository
 *   root's shared configuration, a build directory.
 * - **No symbolic link in a unit** (`check-architecture.mjs`), since a link
 *   makes a path inside the unit lead into another.
 *
 * What these do not see: a path assembled at run time; an unquoted one — a
 * CSS `url(../x)`, an HTML attribute written without quotes; one resolved from
 * somewhere other than its file's directory, such as a Vite `root`; and one
 * that does not climb, such as an absolute path. Those are held by review.
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
 * backtick-quoted without interpolation, on one line — that begins `./` or
 * `../`, or that climbs anywhere inside it (`src/../../x`). In source, that is
 * every static import, `export … from`, dynamic `import()`, `require`, and
 * `new URL(…, import.meta.url)`; in configuration, HTML, and CSS, every path
 * written in quotes.
 */
export function relativePaths(text) {
  return [...text.matchAll(/(["'`])([^"'`$\n]*)\1/g)]
    .map((match) => match[2])
    .filter((path) => /^\.\.?\//.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path))
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
