/**
 * What an extension and a package may depend on. Pure: each function is given
 * text and names and reads nothing itself, so its tests can hand it any
 * layout. `check-architecture.mjs` walks the tree and supplies them.
 *
 * The rules, from docs/adr/todo/1-extensions-repo.md, are that an extension
 * depends on nothing in another extension, and a package on nothing in any
 * extension. They are enforced as two constraints that leave no third way in:
 *
 * - **No manifest depends on an extension** (`manifestViolations`). An
 *   extension is a leaf: not another extension, not a package, not the root
 *   names one as a dependency, whether by its package name, an alias of it, or
 *   a path into `extensions/`. pnpm links into a package's `node_modules` only
 *   what its manifest declares, so an import of an undeclared extension by name
 *   does not resolve, and fails typecheck, test, and build.
 * - **A relative path stays in its own unit** (`relativePathViolations`).
 *   Every quoted `./` or `../` path in an extension's or a package's files must
 *   resolve inside that extension or package. Another unit is reached by
 *   package name, through its manifest — which the first rule governs.
 */
import { posix } from "node:path"

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

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
 * backtick-quoted without interpolation — that begins `./` or `../`. That is
 * every static import, `export … from`, dynamic `import()`, `require`, and
 * `new URL(…, import.meta.url)`, and an HTML or CSS reference in quotes. A
 * path assembled at run time, or an unquoted CSS `url(…)`, is not seen.
 */
export function relativePaths(text) {
  return [...text.matchAll(/(["'`])(\.\.?\/[^"'`$\n]*)\1/g)].map((match) => match[2])
}

/**
 * The paths in a file that leave its unit, one message each.
 *
 * @param {string} path repository-relative path, forward slashes
 * @param {string} text the file's contents
 */
export function relativePathViolations(path, text) {
  const unit = unitOf(path)
  if (unit === null) return []
  const violations = []
  for (const relative of relativePaths(text)) {
    const target = posix.normalize(posix.join(posix.dirname(path), relative))
    if (target === unit || target.startsWith(`${unit}/`)) continue
    violations.push(
      `"${relative}" reaches outside ${unit}; depend on a package by name instead`,
    )
  }
  return violations
}

/**
 * The extension a dependency entry refers to, if any: by its key, by an
 * aliased name in its version (`workspace:@nessalabs/x@*`, `npm:@nessalabs/x@1`),
 * or by a `link:`, `file:`, or `portal:` path into `extensions/`.
 */
function dependedExtension(manifestPath, key, version, extensionPackages) {
  const names = [...extensionPackages.values()]
  if (names.includes(key)) return key
  if (typeof version !== "string") return null
  const alias = /^(?:workspace|npm):(@?[^@]+)/.exec(version)
  if (alias && names.includes(alias[1])) return alias[1]
  const local = /^(?:link|file|portal):(.+)$/.exec(version)
  if (local) {
    const target = posix.normalize(posix.join(posix.dirname(manifestPath), local[1]))
    const [top, name] = target.split("/")
    if (top === "extensions" && name) {
      return extensionPackages.get(name) ?? target
    }
  }
  return null
}

/**
 * The dependencies in a manifest that name an extension, one message each.
 *
 * @param {string} manifestPath repository-relative path of the package.json
 * @param {Record<string, unknown>} manifest its parsed contents
 * @param {Map<string, string>} extensionPackages extension directory name →
 *   its package name, for every extension in the repository
 */
export function manifestViolations(manifestPath, manifest, extensionPackages) {
  const violations = []
  for (const field of dependencyFields) {
    const entries = Object.hasOwn(manifest, field) ? manifest[field] : null
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      continue
    }
    for (const [key, version] of Object.entries(entries)) {
      const extension = dependedExtension(manifestPath, key, version, extensionPackages)
      if (extension === null) continue
      violations.push(
        `${field} names extension ${extension}; nothing depends on an extension — share it through a package`,
      )
    }
  }
  return violations
}
