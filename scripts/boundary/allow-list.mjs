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
 * - **an npm package**: a file in the repository's root `node_modules`, which
 *   is pnpm's store, or in a `node_modules` directory outside the repository,
 *   where the toolchain itself may be installed. A store entry pnpm installed
 *   from a local path (`<pkg>@file+…`) is not one.
 *
 * Anything else is refused: another extension, a package it does not declare,
 * the rest of the repository (any other `node_modules` directory in it
 * included), and anything outside it.
 */
import nodePath from "node:path"

/**
 * Why `unit` may not use the module at `path`, or null if it may. `build.mjs`
 * asks it about an extension's build; `typecheck.mjs` about any unit's
 * program, a package's included, which may use no extension.
 *
 * @param {string} path the module's real path, relative to the repository,
 *   with forward slashes; it starts `..` when outside it (`repositoryPath`)
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
  // In the repository, only the root's node_modules is pnpm's; outside it,
  // any node_modules is an install of the toolchain's.
  if (top === "node_modules") {
    // pnpm keeps a dependency installed from a local path (`file:`, which a
    // hand-edited lockfile can name for a sibling extension) under a store
    // entry it names `<pkg>@file+<path>`; that is the repository, not npm.
    return name === ".pnpm" && /@(file|link)\+/.test(inside[0] ?? "")
      ? "which pnpm installed from a path in the repository, not from npm"
      : null
  }
  if (top === "..") {
    return path.split("/").includes("node_modules")
      ? null
      : "which is outside the repository"
  }
  return "which is outside every extension and package"
}

/**
 * `real`, an absolute real path, relative to `root` with forward slashes, as
 * `moduleRefusal` takes it: starting `..` when outside the repository, on
 * another drive included. `platform` is `node:path`, or its `win32` or
 * `posix` form in a test.
 */
export function repositoryPath(root, real, platform = nodePath) {
  const path = platform.relative(root, real)
  const slashed = path.split(platform.sep).join("/")
  return platform.isAbsolute(path) ? `../${slashed}` : slashed
}
