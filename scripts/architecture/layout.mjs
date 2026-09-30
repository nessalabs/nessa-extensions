/**
 * The pinned install layout, and dependencies checked within it. Pure: each
 * function is given text or a parsed manifest and reads nothing itself.
 * `check-architecture.mjs` reads the files and supplies them.
 *
 * The rule, from docs/adr/todo/1-extensions-repo.md: an extension depends on
 * nothing in another extension, and a package on nothing in any extension.
 * Checking that on how a dependency is written, or on what pnpm installed,
 * failed five review rounds: pnpm has a setting to move almost anything. So
 * the layout is pinned instead, by allow-lists — what may appear, never what
 * may not — and dependencies are checked within it:
 *
 * - **pnpm's configuration** (`workspaceViolations`). `pnpm-workspace.yaml`
 *   may hold only `workspaceKeys`, and its `packages` exactly
 *   `workspaceGlobs`. Everything that moves where packages install or how they
 *   link — `nodeLinker`, `virtualStoreDir`, `modulesDir`, hoisting, overrides,
 *   catalogs, `packageExtensions`, `patchedDependencies`, injection, a
 *   pnpmfile — is refused by not being on the list. The files pnpm reads its
 *   settings and hooks from, `.npmrc` and `.pnpmfile.cjs` or `.mjs`, are
 *   refused outright at the root and in every unit (`pnpmFiles`, checked by
 *   `check-architecture.mjs`).
 * - **Manifests** (`manifestViolations`). A `package.json` may hold only
 *   `manifestKeys`, so `pnpm`, `resolutions`, `overrides`,
 *   `dependenciesMeta`, and `bundledDependencies` are refused. Every
 *   dependency is `workspace:*` (or `^`, `~`), a semver range, or a dist-tag:
 *   never a path, a tarball, a URL, `file:`, `link:`, `portal:`,
 *   `workspace:<path>`, `npm:`, or `catalog:`. And no dependency is named for
 *   an extension's package.
 *
 * Within that layout, pnpm links into a unit's `node_modules` exactly the
 * workspace packages its manifest names, so a manifest that names no
 * extension installs none, and an import of one by name does not resolve.
 * That is why the install itself is not read: it would re-decide what the
 * manifest check already decided (gate 13).
 *
 * Held by review, not by this: pnpm settings from outside the repository —
 * a user's `~/.npmrc`, `npm_config_*` or `pnpm_config_*` environment variables
 * (CI sets none; `ci.yml` is reviewed) — and anything fetched from a registry
 * that depends on a published extension.
 */

/** The keys `pnpm-workspace.yaml` may hold. None of them moves an install. */
export const workspaceKeys = ["packages", "allowBuilds", "verifyDepsBeforeRun"]

/** The workspace's projects: each package, and each extension as one package. */
export const workspaceGlobs = ["packages/*", "extensions/*"]

/** Files pnpm reads settings or hooks from; none may exist in the repository's units or root. */
export const pnpmFiles = [".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs"]

/** The keys a `package.json` may hold. None of them changes resolution. */
export const manifestKeys = [
  "name",
  "version",
  "private",
  "type",
  "description",
  "license",
  "author",
  "contributors",
  "keywords",
  "homepage",
  "repository",
  "bugs",
  "packageManager",
  "engines",
  "scripts",
  "exports",
  "main",
  "types",
  "bin",
  "files",
  "sideEffects",
  "publishConfig",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
]

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, "$2")

/**
 * What `pnpm-workspace.yaml` breaks of the pinned layout, one message each.
 * Read line by line, since the check runs in bare Node: a top-level key starts
 * a line; `packages` is a block list of `- glob` lines.
 *
 * @param {string} text the file's contents
 */
export function workspaceViolations(text) {
  const violations = []
  const globs = []
  let key = null
  for (const line of text.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue
    const top = /^([^\s#][^:]*):(.*)$/.exec(line)
    if (top) {
      key = unquote(top[1])
      if (!workspaceKeys.includes(key)) {
        violations.push(`${key} is not one of ${workspaceKeys.join(", ")}`)
      } else if (key === "packages" && top[2].trim() !== "") {
        violations.push("packages is written as a list of `- glob` lines")
      }
      continue
    }
    const item = /^\s+-\s*(.+?)\s*$/.exec(line)
    if (key === "packages" && item) globs.push(unquote(item[1]))
  }
  const expected = JSON.stringify(workspaceGlobs)
  if (JSON.stringify(globs) !== expected) {
    violations.push(`packages is ${JSON.stringify(globs)}, not exactly ${expected}`)
  }
  return violations
}

/** One comparator of a semver range: `1.2.3`, `^1`, `>=1.0.0-beta.1`, `x`. */
const comparator =
  /^(?:[<>]=?|[=~^])?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** Whether a dependency's version is one the pinned layout allows. */
export function allowedSpec(spec) {
  if (typeof spec !== "string") return false
  if (/^workspace:[*^~]$/.test(spec)) return true
  if (/^[a-z][a-z0-9-]*$/.test(spec)) return true // a dist-tag: latest, next
  if (spec.trim() === "*") return true
  return spec.split("||").every((part) => {
    const tokens = part.trim().split(/\s+/)
    return (
      tokens.some((token) => comparator.test(token)) &&
      tokens.every((token) => token === "-" || comparator.test(token))
    )
  })
}

/**
 * What a `package.json` breaks of the pinned layout, one message each.
 *
 * @param {Record<string, unknown>} manifest its parsed contents
 * @param {Set<string>} extensionNames every extension's package name
 */
export function manifestViolations(manifest, extensionNames) {
  const violations = []
  for (const key of Object.keys(manifest)) {
    if (!manifestKeys.includes(key)) {
      violations.push(`${key} is not a manifest key this layout allows`)
    }
  }
  for (const field of dependencyFields) {
    const entries = Object.hasOwn(manifest, field) ? manifest[field] : undefined
    if (entries === undefined) continue
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      violations.push(`${field} is not an object of name to version`)
      continue
    }
    for (const [name, spec] of Object.entries(entries)) {
      if (extensionNames.has(name)) {
        violations.push(
          `${field} names extension ${name}; nothing depends on an extension — share it through a package`,
        )
      } else if (!allowedSpec(spec)) {
        violations.push(
          `${field} ${name} is ${JSON.stringify(spec)}; a dependency is workspace:*, a semver range, or a dist-tag`,
        )
      }
    }
  }
  return violations
}
