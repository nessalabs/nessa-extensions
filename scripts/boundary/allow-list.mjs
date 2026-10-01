/**
 * Where a unit's code may come from. Pure: given where a file the toolchain
 * resolved really is, it says whether the unit may use it, and reads nothing
 * itself.
 *
 * The rule, from docs/adr/todo/1-extensions-repo.md, is an allow-list. Code in
 * an extension — or a package — comes only from:
 *
 * - **its own folder**;
 * - **a workspace package it declares**: `packages/<dir>`, when the
 *   unit's manifest names that package in `dependencies` or
 *   `devDependencies`, or a package it declares does (`units.mjs`);
 * - **an npm package**: a file in a `node_modules` directory that is not in
 *   an extension or a package — pnpm's store, or the toolchain's own install.
 *
 * Anything else is refused: another extension, a package it does not declare
 * (a file under a `node_modules` directory inside one included), the rest of
 * the repository, and anything outside it.
 */

/**
 * Why `unit` may not use the module at `path`, or null if it may. `build.mjs`
 * asks it about an extension's build; `typecheck.mjs` about any unit's
 * program, a package's included, which may use no extension.
 *
 * @param {string} path the module's real path, relative to the repository,
 *   with forward slashes; it starts `..` when outside it
 * @param {string} unit `extensions/<name>` or `packages/<dir>`
 * @param {Set<string>} declared the packages it may use, as `packages/<dir>`
 */
export function moduleRefusal(path, unit, declared) {
  const [top, name, ...inside] = path.split("/")
  // A file directly in extensions/ or packages/, such as its README, is in no unit.
  const owner =
    (top === "extensions" || top === "packages") && inside.length > 0
      ? `${top}/${name}`
      : null
  if (owner === unit || declared.has(owner)) return null
  if (owner?.startsWith("extensions/")) {
    return `which is in ${owner}; nothing imports an extension`
  }
  if (owner !== null) return `which is in ${owner}, and ${unit} does not declare it`
  if (path.split("/").includes("node_modules")) return null
  if (top === "..") return "which is outside the repository"
  return "which is outside every extension and package"
}
