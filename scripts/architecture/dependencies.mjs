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
 * - **A relative path stays in its unit** (`relativePathViolations`). Every
 *   relative path written in a file of an extension or a package is resolved
 *   from the file's directory and must land inside the unit. The one other
 *   destination allowed is the repository's `tsconfig.json`, which a unit's
 *   own extends (`sharedFiles`). A path is any run of path characters with a
 *   `./` or `../` start or a `..` segment anywhere, found whatever quotes or
 *   comments surround it, after JavaScript escapes (`\x2f`, `\u002e`, `\/`)
 *   and URL escapes (`%2e`, `%2f`) are decoded; one that begins `/` and
 *   climbs is refused too, as is a `..` after a `node_modules` segment, which
 *   the file system resolves through pnpm's links rather than as text.
 *   Markdown files are not read: they are documentation, and a Markdown file
 *   imported as code is a path in a code file, which is.
 * - **No symbolic link in a unit** (`check-architecture.mjs`), since a link
 *   makes a path inside the unit lead into another.
 *
 * Because a path is read from any text, a comment that mentions `../x`
 * counts, and so does a regular expression for `..` once `\.` is decoded;
 * reword the one, write the other `[.][.]`. What these do not see: a path assembled at run time; one with no
 * `./`, `../`, or `..` at all, such as a bare absolute path; a path that
 * configuration resolves from somewhere other than its file's directory, such
 * as a Vite `outDir` against its `root`, a bundler alias, or a tsconfig
 * `baseUrl` — resolved from the file they are refused when they climb out of
 * the unit, but a value that stays inside it and is later joined elsewhere is
 * not; and anything under a unit's own root `node_modules` or `dist`, which
 * install and build write. Those are held by review.
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

/** Files outside every unit that a unit may name: the shared compiler settings. */
export const sharedFiles = ["tsconfig.json"]

/**
 * A file's text with the escapes that can spell `.` or `/` decoded: JavaScript
 * `\xHH`, `\uHHHH`, `\u{H…}`, and a backslash before `.` or `/`.
 */
function decodeEscapes(text) {
  return text
    .replace(
      /\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g,
      (_, x, braced, u) => String.fromCodePoint(parseInt(x ?? braced ?? u, 16)),
    )
    .replace(/\\([./])/g, "$1")
}

/**
 * Every path written in a file that leaves its directory's subtree or climbs:
 * each run of path characters that begins `./` or `../` or has a `..` segment
 * anywhere, with `%2e` and `%2f` read as `.` and `/`. Runs are found without
 * pairing quotes, so no quote, comment, or odd character around a path can
 * hide it; a character that splits a path leaves each part a run of its own.
 */
export function relativePaths(text) {
  return [...decodeEscapes(text).matchAll(/[\w@$.*+~%/-]+/g)]
    .map((match) => match[0].replace(/%2e/gi, ".").replace(/%2f/gi, "/"))
    .filter((run) => /^\.\.?\//.test(run) || /(?:^|\/)\.\.(?:\/|$)/.test(run))
}

/**
 * The paths in a file that lead anywhere but its own unit or a shared file;
 * one message each.
 *
 * @param {string} path repository-relative path, forward slashes
 * @param {string} text the file's contents
 */
export function relativePathViolations(path, text) {
  const unit = unitOf(path)
  if (unit === null || path.endsWith(".md")) return []
  const directory = posix.dirname(path)
  const violations = []
  const refuse = (relative, why) =>
    violations.push(
      `"${relative}" ${why}; a path stays in ${unit} — reach another unit by package name`,
    )
  for (const relative of relativePaths(text)) {
    if (relative.startsWith("/")) {
      refuse(relative, "is absolute and climbs")
      continue
    }
    if (/(?:^|\/)node_modules\/(?:.*\/)?\.\.(?:\/|$)/.test(relative)) {
      refuse(relative, "climbs out of node_modules, which pnpm links elsewhere")
      continue
    }
    const target = posix.normalize(posix.join(directory, relative)).replace(/\/$/, "")
    if (target === unit || target.startsWith(`${unit}/`)) continue
    if (sharedFiles.includes(target)) continue
    refuse(
      relative,
      `leads to ${target.startsWith("..") ? "outside the repository" : target}`,
    )
  }
  return violations
}
