/**
 * What an extension's and a package's files may reach. Pure: each function is
 * given text and names and reads nothing itself. `check-architecture.mjs` walks
 * the tree and supplies them.
 *
 * The rule, from docs/adr/todo/1-extensions-repo.md, is that an extension
 * depends on nothing in another extension, and a package on nothing in any
 * extension; another unit is reached only by package name, through a manifest.
 * Manifests and the install layout are held by `layout.mjs`. This module holds
 * the files, by allow-list of where a path may lead:
 *
 * - **A relative path stays in its unit, or names a file at the repository
 *   root** (`relativePathViolations`). Every relative path written in any file
 *   of an extension or a package — a run of path characters that begins `./`
 *   or `../` or climbs with `..` anywhere in it, found whatever quotes or
 *   comments surround it — is resolved from the file's directory, and must
 *   land inside the unit, on a file directly at the repository root (the
 *   shared `tsconfig.json` an extension extends), in `docs/` (a README's link
 *   to a decision record; nothing there is code), or on a directory above the
 *   file with nothing after it (`"../"` in a path guard). Anywhere else is
 *   refused: another unit, pnpm's `node_modules` (whose hidden hoist links to
 *   every extension), `scripts/`, and anything above the repository.
 * - **No symbolic link in a unit** (`check-architecture.mjs`), since a link
 *   makes a path inside the unit lead into another.
 *
 * What these do not see: a path assembled at run time; one written without a
 * `./`, `../`, or `..` segment, such as an absolute path; one resolved from
 * somewhere other than its file's directory, such as a Vite `outDir` against
 * its `root` (write it from the config's own directory instead); and anything
 * under a unit's own root `node_modules` or `dist`, which install and build
 * write. Those are held by review.
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
 * Every relative path written in a file: each run of path characters that
 * begins `./` or `../`, or has a `..` segment anywhere in it. Runs are found
 * without pairing quotes, so a quote in a comment or another string on the
 * line cannot hide one; a run that begins `/` is absolute, not relative.
 */
export function relativePaths(text) {
  return [...text.matchAll(/[\w@$.*+~%/-]+/g)]
    .map((match) => match[0])
    .filter(
      (run) =>
        !run.startsWith("/") &&
        (/^\.\.?\//.test(run) || /(?:^|\/)\.\.(?:\/|$)/.test(run)),
    )
}

/**
 * The paths in a file that lead anywhere but its own unit, a file at the
 * repository root, `docs/`, or a directory above the file; one message each.
 *
 * @param {string} path repository-relative path, forward slashes
 * @param {string} text the file's contents
 * @param {Set<string>} rootFiles the names of the files directly at the
 *   repository root
 */
export function relativePathViolations(path, text, rootFiles) {
  const unit = unitOf(path)
  if (unit === null) return []
  const directory = posix.dirname(path)
  const violations = []
  for (const relative of relativePaths(text)) {
    const target = posix.normalize(posix.join(directory, relative)).replace(/\/$/, "")
    if (target === unit || target.startsWith(`${unit}/`)) continue
    if (!target.includes("/") && rootFiles.has(target)) continue
    if (target.startsWith("docs/")) continue // a README's link to a record
    const above =
      target === "." || directory === target || directory.startsWith(`${target}/`)
    if (above) continue
    const reached = target.startsWith("..") ? "outside the repository" : target
    violations.push(
      `"${relative}" leads to ${reached}; a path leaves ${unit} only for a root file or docs/ — reach another unit by package name`,
    )
  }
  return violations
}
