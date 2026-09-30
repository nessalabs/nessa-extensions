/**
 * What an extension and a package may depend on. Pure: each function is given
 * text and names and reads nothing itself, so its tests can hand it any
 * layout. `check-architecture.mjs` walks the tree and supplies them.
 *
 * The rules, from docs/adr/todo/1-extensions-repo.md, are that an extension
 * depends on nothing in another extension, and a package on nothing in any
 * extension. Another unit is reached only by package name, through a manifest,
 * and three constraints hold that:
 *
 * - **Nothing is linked to an extension** (`lockfileViolations`). An extension
 *   is a leaf: in pnpm's resolution of the workspace, no importer — the root,
 *   a package, another extension — has a dependency that resolves into an
 *   extension's directory. The lockfile is read rather than the manifests
 *   because it is the outcome: however a dependency was spelled (a name, an
 *   alias, `workspace:../x`, a bare path, an override, a catalog), pnpm
 *   records where it resolved, as `link:` or `file:` relative to the importer.
 *   CI installs with `--frozen-lockfile`, which fails when the lockfile does
 *   not match the manifests and overrides, so the lockfile checked is the one
 *   installed.
 *   A unit resolves by name only what it or the root declares; neither may
 *   be an extension, so an import of one by name does not resolve, and fails
 *   typecheck and test.
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

/**
 * The dependencies pnpm's lockfile resolves into an extension from anywhere
 * but that extension itself, one message each.
 *
 * Pure text, read line by line: the check runs in bare Node, so it cannot
 * import a YAML parser, and it needs only the `importers:` section, whose
 * shape pnpm fixes — an importer at two spaces, a dependency field at four, a
 * dependency at six, its `version:` at eight.
 *
 * @param {string} lockfile the contents of pnpm-lock.yaml
 * @param {Set<string>} extensions every extension, as `extensions/<name>`
 */
export function lockfileViolations(lockfile, extensions) {
  const violations = []
  let inImporters = false
  let importer = null
  let field = null
  let dependency = null
  for (const line of lockfile.split("\n")) {
    if (/^\S/.test(line)) {
      inImporters = line.trimEnd() === "importers:"
      continue
    }
    if (!inImporters) continue
    let match
    if ((match = /^ {2}(\S[^:]*):/.exec(line))) importer = unquote(match[1])
    else if ((match = /^ {4}(\S[^:]*):/.exec(line))) field = match[1]
    else if ((match = /^ {6}(\S.*):\s*$/.exec(line))) dependency = unquote(match[1])
    else if ((match = /^ {8}version: (?:link|file):(.+?)\s*$/.exec(line))) {
      const [top, name] = posix.normalize(posix.join(importer, match[1])).split("/")
      const reached = `${top}/${name}`
      if (reached === importer || !extensions.has(reached)) continue
      violations.push(
        `${importer} ${field} ${dependency} resolves into ${reached}; nothing depends on an extension — share it through a package`,
      )
    }
  }
  return violations
}

/** A YAML key without the quotes pnpm puts around one starting with `@`. */
const unquote = (key) => key.replace(/^'(.*)'$/, "$1")
