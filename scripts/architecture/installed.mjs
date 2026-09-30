/**
 * Nothing installed in the workspace is an extension, except an extension's
 * own files. This is the dependency half of the rule in
 * docs/adr/todo/1-extensions-repo.md — an extension depends on nothing in
 * another extension, and a package on nothing in any extension — checked on
 * what pnpm installed rather than on how a dependency was written.
 *
 * Why the install and not the manifests or the lockfile: three review rounds
 * found a new way to write a dependency that a check of the manifests missed
 * (aliases, `workspace:../x`, bare paths, overrides), and the fourth found five
 * ways past a check of the lockfile (`file:` paths relative to the root,
 * `<name>@file:` versions, `excludeLinksFromLockfile`, a lockfile per project,
 * links only in `snapshots:`). Each was a spelling. Whatever the spelling or the
 * setting, the result is an entry in some `node_modules` — a link into an
 * extension's directory, or a copy of an extension's package — and that is
 * what is read here.
 *
 * Where it looks: the root's `node_modules`, each unit's, and each package's in
 * pnpm's store (`node_modules/.pnpm/<package>/node_modules`), including
 * `@scope/` directories. An entry fails when:
 *
 * - it resolves (following links) into `extensions/<x>`, from anywhere but
 *   `extensions/<x>`'s own `node_modules`; or
 * - its `package.json` names a package that lives in an extension — the
 *   extension's own, or one in a directory inside it: an injected copy, a copy
 *   of a `file:` directory, or the same package installed from the registry.
 *
 * It needs an install, so it runs after `pnpm install`; without one it fails
 * rather than passing. It reads only the file system, with no dependencies.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, relative, sep } from "node:path"

/** The directories under `path` that are units, as `unitOf` in dependencies.mjs names them. */
const unitDirectories = (root, top) => {
  const path = join(root, top)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .sort()
    .filter((name) => !name.startsWith(".") && lstatSync(join(path, name)).isDirectory())
    .map((name) => `${top}/${name}`)
}

/** A package's name, or null when it has no readable manifest. */
function packageName(directory) {
  try {
    const name = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name
    return typeof name === "string" ? name : null
  } catch {
    return null
  }
}

/**
 * Every directory under `directory`, itself included, that holds a
 * `package.json`: an extension's own package and any package inside it, which
 * a dependency can name as `file:extensions/<x>/<dir>` and get a copy of.
 */
function packageDirectories(directory) {
  const found = existsSync(join(directory, "package.json")) ? [directory] : []
  for (const name of readdirSync(directory).sort()) {
    if (name === "node_modules" || name === "dist") continue
    const path = join(directory, name)
    if (lstatSync(path).isDirectory()) found.push(...packageDirectories(path))
  }
  return found
}

/** The package entries in a `node_modules` directory, `@scope/name` included. */
function entries(directory) {
  if (!existsSync(directory)) return []
  const found = []
  for (const name of readdirSync(directory).sort()) {
    if (name.startsWith(".")) continue
    const path = join(directory, name)
    if (name.startsWith("@") && lstatSync(path).isDirectory()) {
      for (const inner of readdirSync(path).sort()) {
        found.push({ name: `${name}/${inner}`, path: join(path, inner) })
      }
    } else found.push({ name, path })
  }
  return found
}

/**
 * Every failure in the install at `root`, as `path: rule` lines.
 *
 * @param {string} root the repository
 */
export function installedViolations(root) {
  const real = realpathSync(root)
  const rel = (path) => relative(real, path).split(sep).join("/")
  const nodeModules = join(root, "node_modules")
  if (!existsSync(nodeModules)) {
    return ["node_modules: is missing; run pnpm install before this check"]
  }

  const extensions = unitDirectories(root, "extensions")
  const extensionNames = new Map()
  for (const extension of extensions) {
    for (const directory of packageDirectories(join(root, extension))) {
      const name = packageName(directory)
      if (name !== null) extensionNames.set(name, extension)
    }
  }

  // Each place packages are installed, with the unit it belongs to: an
  // extension's own node_modules may hold its own files, nothing else may.
  // Not `.pnpm/node_modules`: pnpm hoists every workspace project there,
  // extensions included, for packages in its store to find; no unit resolves
  // from it, and a store package that does depend on an extension has the
  // link in its own `.pnpm/<package>/node_modules`, which is read.
  const places = [
    { owner: null, directory: nodeModules },
    ...[...unitDirectories(root, "packages"), ...extensions].map((unit) => ({
      owner: unit,
      directory: join(root, unit, "node_modules"),
    })),
  ]
  const store = join(nodeModules, ".pnpm")
  if (existsSync(store)) {
    for (const name of readdirSync(store).sort()) {
      if (name.startsWith(".")) continue
      places.push({
        owner: null,
        directory: join(store, name, "node_modules"),
        store: true,
      })
    }
  }

  const failures = []
  for (const { owner, directory, store: inStore } of places) {
    for (const entry of entries(directory)) {
      // In the store, a package's own files sit beside the links to its
      // dependencies; only the links are dependencies. Whoever links to a
      // copy of an extension's package is reported, not the copy itself.
      if (inStore && !lstatSync(entry.path).isSymbolicLink()) continue
      let target
      try {
        target = realpathSync(entry.path)
      } catch {
        continue // a broken link installs nothing
      }
      const [top, name] = rel(target).split("/")
      const reached = `${top}/${name}`
      const where = rel(join(realpathSync(directory), entry.name))
      if (top === "extensions" && extensions.includes(reached) && reached !== owner) {
        failures.push(
          `${where}: resolves into ${reached}; nothing depends on an extension`,
        )
        continue
      }
      const installed = packageName(target)
      if (
        installed !== null &&
        extensionNames.has(installed) &&
        extensionNames.get(installed) !== owner
      ) {
        failures.push(
          `${where}: is ${installed}, a package in ${extensionNames.get(installed)}; nothing depends on an extension`,
        )
      }
    }
  }
  return failures
}
