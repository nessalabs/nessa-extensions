import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allowedSpec,
  manifestKeys,
  manifestViolations,
  workspaceKeys,
  workspaceViolations,
} from "./layout.mjs"

const pinned = 'packages:\n  - "packages/*"\n  - "extensions/*"\n'

test("the pinned workspace passes, with the settings that move nothing", () => {
  assert.deepEqual(workspaceViolations(pinned), [])
  const withSettings = `# a comment\n${pinned}\nallowBuilds:\n  esbuild: true\n\nverifyDepsBeforeRun: false\n`
  assert.deepEqual(workspaceViolations(withSettings), [])
  assert.deepEqual(
    workspaceViolations("packages:\n  - packages/*\n  - 'extensions/*'\n"),
    [],
  )
})

test("every setting that moves an install or a link is refused, one by one", () => {
  for (const setting of [
    "nodeLinker: hoisted",
    "virtualStoreDir: .vs",
    "modulesDir: nm",
    "enableGlobalVirtualStore: true",
    "hoistPattern: ['*']",
    "publicHoistPattern: ['*']",
    "shamefullyHoist: true",
    "overrides:\n  a: link:./extensions/notes",
    "catalog:\n  a: ^1.0.0",
    "catalogs:\n  x:\n    a: ^1.0.0",
    "packageExtensions:\n  a:\n    dependencies:\n      b: '*'",
    "patchedDependencies:\n  a: patches/a.patch",
    "injectWorkspacePackages: true",
    "excludeLinksFromLockfile: true",
    "sharedWorkspaceLockfile: false",
    "pnpmfile: hooks.cjs",
    '"dedupeInjectedDeps": false',
  ]) {
    const key = setting.split(":")[0].replace(/"/g, "")
    assert.deepEqual(
      workspaceViolations(`${pinned}${setting}\n`),
      [`${key} is not one of ${workspaceKeys.join(", ")}`],
      setting,
    )
  }
})

test("any other set of workspace globs is refused", () => {
  for (const globs of [
    ["packages/*"],
    ["packages/*", "extensions/*", "tools/*"],
    ["packages/*", "extensions/*/*"],
    ["packages/**", "extensions/*"],
    ["extensions/*", "packages/*"],
  ]) {
    const text = `packages:\n${globs.map((glob) => `  - "${glob}"`).join("\n")}\n`
    assert.equal(workspaceViolations(text).length, 1, globs.join(" "))
    assert.match(workspaceViolations(text)[0], /^packages is .*, not exactly/)
  }
  assert.deepEqual(workspaceViolations('packages: ["packages/*", "extensions/*"]\n'), [
    "packages is written as a list of `- glob` lines",
    'packages is [], not exactly ["packages/*","extensions/*"]',
  ])
})

test("a dependency may be workspace:*, a semver range, or a dist-tag", () => {
  for (const spec of [
    "workspace:*",
    "workspace:^",
    "workspace:~",
    "1.2.3",
    "^3.2.7",
    "~1.2",
    "1.x",
    "*",
    ">=1.0.0 <2",
    "1 - 2",
    "^1.0.0 || ^2.0.0",
    "1.0.0-beta.1",
    "latest",
    "next",
  ]) {
    assert.equal(allowedSpec(spec), true, spec)
  }
})

test("every other kind of version is refused, one by one", () => {
  for (const spec of [
    "file:../notes",
    "link:../notes",
    "portal:../notes",
    "workspace:../notes",
    "workspace:@nessalabs/notes@*",
    "./extensions/notes",
    "../notes",
    "/abs/path",
    "notes.tgz",
    "https://example.com/notes.tgz",
    "git+https://github.com/a/b.git",
    "github:a/b",
    "a/b",
    "npm:@nessalabs/notes@1.0.0",
    "catalog:",
    "-",
    "",
    1,
    null,
  ]) {
    assert.equal(allowedSpec(spec), false, String(spec))
  }
})

test("a manifest in the pinned layout passes", () => {
  const manifest = {
    name: "@nessalabs/notes",
    private: true,
    dependencies: { "@nessalabs/server-kit": "workspace:*", zod: "^4.0.0" },
    devDependencies: { vitest: "^3.2.7" },
    peerDependencies: { react: ">=19" },
    peerDependenciesMeta: { react: { optional: true } },
  }
  assert.deepEqual(manifestViolations(manifest, new Set(["@nessalabs/other"])), [])
})

test("a manifest key off the list is refused, one by one", () => {
  for (const key of [
    "pnpm",
    "resolutions",
    "overrides",
    "dependenciesMeta",
    "bundledDependencies",
    "imports",
    "workspaces",
  ]) {
    assert.ok(!manifestKeys.includes(key), key)
    assert.deepEqual(
      manifestViolations({ name: "x", [key]: {} }, new Set()),
      [`${key} is not a manifest key this layout allows`],
      key,
    )
  }
})

test("a dependency named for an extension is refused in every field", () => {
  const extensions = new Set(["@nessalabs/notes"])
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const spec of ["workspace:*", "^1.0.0"]) {
      assert.deepEqual(
        manifestViolations({ [field]: { "@nessalabs/notes": spec } }, extensions),
        [
          `${field} names extension @nessalabs/notes; nothing depends on an extension — share it through a package`,
        ],
        `${field} ${spec}`,
      )
    }
  }
})

test("a name that only starts like an extension's is not that extension", () => {
  const extensions = new Set(["@nessalabs/notes"])
  assert.deepEqual(
    manifestViolations(
      { dependencies: { "@nessalabs/notes-kit": "^1.0.0" } },
      extensions,
    ),
    [],
  )
})

test("a dependency field that is not an object is refused", () => {
  for (const value of [null, "x", []]) {
    assert.deepEqual(manifestViolations({ dependencies: value }, new Set()), [
      "dependencies is not an object of name to version",
    ])
  }
})
