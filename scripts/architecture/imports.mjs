/**
 * What an extension and a package may import. Pure: it is given a file's path
 * and text and the extensions' package names, and reads nothing itself, so its
 * test can hand it any layout. `check-architecture.mjs` walks the tree and
 * supplies them.
 *
 * Two rules, both from docs/adr/todo/1-extensions-repo.md:
 *
 * - An extension imports nothing from another extension. What two extensions
 *   share belongs in a package under `packages/`.
 * - A package imports nothing from any extension. Packages are what extensions
 *   are built from; the arrow points one way.
 *
 * An import is caught whichever way it is spelled: a relative path that lands
 * in another extension's directory, or the other extension's package name.
 */
import { posix } from "node:path"

/**
 * Every module specifier in a source file: static and dynamic `import`,
 * `export … from`, and `require`. A specifier is always a string literal in
 * these forms; one built at run time is not a dependency this check can see.
 */
export function importSpecifiers(text) {
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  const found = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1])
  }
  return found
}

/**
 * Which part of the repository a file belongs to: `{ kind: "extension", name }`,
 * `{ kind: "package", name }`, or `{ kind: "other" }`. Paths are repository
 * relative, with forward slashes. A file directly in `extensions/` or
 * `packages/`, such as its README, belongs to neither.
 */
export function owner(path) {
  const [top, name, ...inside] = posix.normalize(path).split("/")
  if (inside.length === 0) return { kind: "other" }
  if (top === "extensions") return { kind: "extension", name }
  if (top === "packages") return { kind: "package", name }
  return { kind: "other" }
}

/** The extension a bare specifier names, if it names one. */
function namedExtension(specifier, extensionPackages) {
  for (const [name, packageName] of extensionPackages) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) return name
  }
  return null
}

/** The extension a specifier reaches, by path or by package name, if any. */
function reachedExtension(path, specifier, extensionPackages) {
  if (specifier.startsWith(".")) {
    // The target may be a directory — `../../notes` imports its index — so
    // this asks which extension directory it is in, not which file.
    const [top, name] = posix
      .normalize(posix.join(posix.dirname(path), specifier))
      .split("/")
    return top === "extensions" && name ? name : null
  }
  return namedExtension(specifier, extensionPackages)
}

/**
 * The rules this file breaks, one message each.
 *
 * @param {string} path repository-relative path, forward slashes
 * @param {string} text the file's source
 * @param {Map<string, string>} extensionPackages extension directory name →
 *   its package name, for every extension in the repository
 */
export function importViolations(path, text, extensionPackages) {
  const from = owner(path)
  if (from.kind === "other") return []
  const violations = []
  for (const specifier of importSpecifiers(text)) {
    const reached = reachedExtension(path, specifier, extensionPackages)
    if (reached === null) continue
    if (from.kind === "package") {
      violations.push(
        `imports "${specifier}" from extension ${reached}; a package never imports an extension`,
      )
    } else if (reached !== from.name) {
      violations.push(
        `imports "${specifier}" from extension ${reached}; an extension never imports another extension — share it through a package`,
      )
    }
  }
  return violations
}
