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
 * - **pnpm's configuration** (`workspaceViolations`). Every line of
 *   `pnpm-workspace.yaml` is one of a few allowed shapes, its keys only
 *   `workspaceKeys`, and its `packages` exactly `workspaceGlobs`; any other
 *   YAML — an explicit `? key`, a flow mapping, an anchor, a document marker —
 *   is refused, not skipped. Everything that moves where packages install or how they
 *   link — `nodeLinker`, `virtualStoreDir`, `modulesDir`, hoisting, overrides,
 *   catalogs, `packageExtensions`, `patchedDependencies`, injection, a
 *   pnpmfile — is refused by not being on the list. The files pnpm reads its
 *   settings and hooks from, `.npmrc` and `.pnpmfile.cjs` or `.mjs`, are
 *   refused outright at the root and in every unit (`pnpmFiles`, checked by
 *   `check-architecture.mjs`).
 * - **Manifests** (`manifestViolations`). A `package.json` may hold only
 *   `manifestKeys`, so `pnpm`, `resolutions`, `overrides`,
 *   `dependenciesMeta`, and `bundledDependencies` are refused;
 *   `publishConfig` only `publishConfigKeys`, since `directory` moves a
 *   workspace link; no script pnpm runs on install (`installScripts`), since
 *   one can write any link; and `packageManager` only `pnpm@<version>`. Every
 *   dependency is `workspace:*` (or `^`, `~`), a semver range, or a dist-tag:
 *   never a path, a tarball, a URL, `file:`, `link:`, `portal:`,
 *   `workspace:<path>`, `npm:`, or `catalog:`. And no dependency is named for
 *   an extension's package.
 *
 * Within that layout, pnpm links into a unit's `node_modules` exactly the
 * workspace packages its manifest (or the root's) names, and nothing else
 * writes there, so a manifest that names no extension installs none, and an
 * import of one by name does not resolve.
 * That is why the install itself is not read: it would re-decide what the
 * manifest check already decided (gate 13).
 *
 * Held by review, not by this: pnpm settings from outside the repository —
 * a user's `~/.npmrc`, `npm_config_*` or `pnpm_config_*` environment variables
 * (CI sets none; `ci.yml` is reviewed); a script run by hand or by a tool
 * other than pnpm's install; and anything fetched from a registry that
 * depends on a published extension.
 */

/** The keys `pnpm-workspace.yaml` may hold. None of them moves an install. */
export const workspaceKeys = ["packages", "allowBuilds", "verifyDepsBeforeRun"]

/** The workspace's projects: each package, and each extension as one package. */
export const workspaceGlobs = ["packages/*", "extensions/*"]

/** The `publishConfig` keys allowed: where and how to publish, nothing that moves a local link. */
export const publishConfigKeys = ["access", "registry", "tag", "provenance"]

/**
 * The scripts pnpm runs by itself when a workspace project is installed. Any
 * of them can write into `node_modules`, so none may be defined.
 */
export const installScripts = [
  "preinstall",
  "install",
  "postinstall",
  "preprepare",
  "prepare",
  "postprepare",
  "prepublish",
]

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
  "imports",
  "main",
  "module",
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
 *
 * Read line by line, since the check runs in bare Node, and by allow-list:
 * every line must be one of the few shapes the pinned file needs, and any
 * other — a key off the list, a YAML explicit key (`? x`), a flow mapping, an
 * anchor, a document marker, a directive — is refused rather than skipped.
 *
 * - blank, or a `#` comment
 * - `packages:`, then `  - <glob>` lines
 * - `allowBuilds:`, then `  <package>: true|false` lines
 * - `verifyDepsBeforeRun: true|false`
 *
 * @param {string} text the file's contents
 */
export function workspaceViolations(text) {
  const violations = []
  const globs = []
  const seen = new Set()
  let key = null
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const at = `line ${index + 1}`
    if (/^\s*(#.*)?$/.test(line)) return
    const top = /^(["']?)([A-Za-z]+)\1:(?:[ ]+([^#]*?))?[ ]*(#.*)?$/.exec(line)
    if (/^\S/.test(line)) {
      key = top ? top[2] : null
      if (!top) {
        const named = /^([^\s#?:{[&*!%|>-][^:]*):/.exec(line)
        violations.push(
          named
            ? `${unquote(named[1])} is not one of ${workspaceKeys.join(", ")}`
            : `${at} is not a setting this layout allows`,
        )
        return
      }
      const value = top[3] ?? ""
      if (!workspaceKeys.includes(key)) {
        violations.push(`${key} is not one of ${workspaceKeys.join(", ")}`)
      } else if (seen.has(key)) {
        violations.push(`${key} is set twice`)
      } else if (key === "packages" && value !== "") {
        violations.push("packages is written as a list of `- glob` lines")
      } else if (key === "allowBuilds" && value !== "") {
        violations.push("allowBuilds is written as `<package>: true|false` lines")
      } else if (key === "verifyDepsBeforeRun" && !/^(true|false)$/.test(value)) {
        violations.push("verifyDepsBeforeRun is true or false")
      }
      seen.add(key)
      return
    }
    const glob = /^[ ]+-[ ]+(["']?)([^\s"'#]+)\1[ ]*(#.*)?$/.exec(line)
    const build = /^[ ]+(["']?)([@\w./-]+)\1:[ ]*(true|false)[ ]*(#.*)?$/.exec(line)
    if (key !== null && !workspaceKeys.includes(key)) return // already refused
    if (key === "packages" && glob) globs.push(glob[2])
    else if (key === "allowBuilds" && build) return
    else
      violations.push(`${at} is not a line this layout allows under ${key ?? "no key"}`)
  })
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
  // `>= 1.0` is `>=1.0`: an operator may be followed by spaces.
  const range = spec.replace(/([<>]=?|[=~^])\s+/g, "$1")
  return range.split("||").every((part) => {
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
  const own = (key) => (Object.hasOwn(manifest, key) ? manifest[key] : undefined)
  const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
  const publish = own("publishConfig")
  if (publish !== undefined) {
    if (!isObject(publish)) violations.push("publishConfig is not an object")
    else {
      for (const key of Object.keys(publish)) {
        if (!publishConfigKeys.includes(key)) {
          violations.push(
            `publishConfig.${key} is not one of ${publishConfigKeys.join(", ")}`,
          )
        }
      }
    }
  }
  const scripts = own("scripts")
  if (isObject(scripts)) {
    for (const name of installScripts) {
      if (Object.hasOwn(scripts, name)) {
        violations.push(`scripts.${name} runs on install, and could link anything`)
      }
    }
  }
  const packageManager = own("packageManager")
  if (
    packageManager !== undefined &&
    (typeof packageManager !== "string" ||
      !/^pnpm@\d+\.\d+\.\d+(\+sha\d+\.[0-9a-f]+)?$/.test(packageManager))
  ) {
    violations.push(
      `packageManager is ${JSON.stringify(packageManager)}, not pnpm@<version>`,
    )
  }
  for (const field of dependencyFields) {
    const entries = own(field)
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
