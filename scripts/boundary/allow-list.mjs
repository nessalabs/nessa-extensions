/**
 * Where an extension's code may come from. Pure: given a path the toolchain
 * resolved, it says whether the extension may use it, and reads nothing
 * itself. `build.mjs` asks it about every file an extension's build reads.
 *
 * The rule, from docs/adr/todo/1-extensions-repo.md, is an allow-list. Code in
 * an extension comes only from:
 *
 * - **its own folder**, `extensions/<name>`;
 * - **a workspace package it declares**: `packages/<dir>`, when the
 *   extension's manifest names that package in `dependencies` or
 *   `devDependencies` (`units.mjs`);
 * - **an npm package**: anything whose real path is in a `node_modules`
 *   directory, which pnpm owns and `.gitignore` keeps out of the repository.
 *
 * Anything else is refused: another extension, a package it does not declare,
 * the rest of the repository, and anything outside it.
 */

/** Whether a repository-relative path is `directory` or inside it. */
const within = (path, directory) => path === directory || path.startsWith(`${directory}/`)

/**
 * Why `unit` may not read `path`, or null if it may.
 *
 * @param {string} path the real path of what was read, relative to the
 *   repository, with forward slashes; it starts `..` when outside it
 * @param {string} unit the extension, `extensions/<name>`
 * @param {Set<string>} declared the packages its manifest names, as
 *   `packages/<dir>`
 */
export function readRefusal(path, unit, declared) {
  if (path.split("/").includes("node_modules")) return null
  if (within(path, unit)) return null
  for (const directory of declared) if (within(path, directory)) return null
  const [top, name, ...inside] = path.split("/")
  if (top === "..") return "which is outside the repository"
  // A file directly in extensions/ or packages/, such as its README, is in no unit.
  if (top === "extensions" && inside.length > 0) {
    return `which is in extensions/${name}; extensions never import one another`
  }
  if (top === "packages" && inside.length > 0) {
    return `which is in packages/${name}, and ${unit} does not declare it`
  }
  return "which is outside every extension and package"
}
