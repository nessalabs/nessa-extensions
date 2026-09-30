import assert from "node:assert/strict"
import { test } from "node:test"

import {
  allowedSpec,
  installScripts,
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

test("the pinned workspace passes with CRLF line endings and trailing comments", () => {
  const text =
    'packages:\r\n  - "packages/*" # each package\r\n  - "extensions/*"\r\n' +
    "allowBuilds:\r\n  esbuild: true # vitest needs it\r\nverifyDepsBeforeRun: false\r\n"
  assert.deepEqual(workspaceViolations(text), [])
})

test("a line of any other YAML shape is refused, one by one", () => {
  for (const [lines, expected] of [
    [
      "? overrides\n:\n  a: link:./extensions/notes",
      [
        "line 4 is not a setting this layout allows",
        "line 5 is not a setting this layout allows",
        "line 6 is not a line this layout allows under no key",
      ],
    ],
    [
      "? nodeLinker\n: hoisted",
      [
        "line 4 is not a setting this layout allows",
        "line 5 is not a setting this layout allows",
      ],
    ],
    ["---", ["line 4 is not a setting this layout allows"]],
    ["...", ["line 4 is not a setting this layout allows"]],
    ["%YAML 1.2", ["line 4 is not a setting this layout allows"]],
    ["{nodeLinker: hoisted}", ["line 4 is not a setting this layout allows"]],
    ["&a nodeLinker: hoisted", ["line 4 is not a setting this layout allows"]],
    ["*a : x", ["line 4 is not a setting this layout allows"]],
    [
      "allowBuilds: {esbuild: true}",
      ["allowBuilds is written as `<package>: true|false` lines"],
    ],
    [
      "allowBuilds:\n  x:\n    nodeLinker: hoisted",
      [
        "line 5 is not a line this layout allows under allowBuilds",
        "line 6 is not a line this layout allows under allowBuilds",
      ],
    ],
    ["verifyDepsBeforeRun: maybe", ["verifyDepsBeforeRun is true or false"]],
    [
      "verifyDepsBeforeRun: false\nverifyDepsBeforeRun: true",
      ["verifyDepsBeforeRun is set twice"],
    ],
  ]) {
    assert.deepEqual(workspaceViolations(`${pinned}${lines}\n`), expected, lines)
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
    ">= 1.0",
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

test("publishConfig may say where to publish, and nothing else", () => {
  assert.deepEqual(
    manifestViolations(
      {
        publishConfig: {
          access: "public",
          registry: "https://registry.npmjs.org/",
          tag: "next",
          provenance: true,
        },
      },
      new Set(),
    ),
    [],
  )
  for (const key of ["directory", "linkDirectory", "main", "exports", "bin"]) {
    assert.deepEqual(
      manifestViolations({ publishConfig: { [key]: "x" } }, new Set()),
      [`publishConfig.${key} is not one of access, registry, tag, provenance`],
      key,
    )
  }
})

test("a script pnpm runs on install is refused, one by one", () => {
  for (const name of installScripts) {
    assert.deepEqual(
      manifestViolations({ scripts: { [name]: "true", test: "vitest" } }, new Set()),
      [`scripts.${name} runs on install, and could link anything`],
      name,
    )
  }
  for (const name of ["pnpm:devPreinstall", "pnpm:anything"]) {
    assert.deepEqual(manifestViolations({ scripts: { [name]: "true" } }, new Set()), [
      `scripts.${name} runs on install, and could link anything`,
    ])
  }
  assert.deepEqual(
    manifestViolations({ scripts: { build: "vite build" } }, new Set()),
    [],
  )
})

test("packageManager names a pnpm version and nothing else", () => {
  assert.deepEqual(manifestViolations({ packageManager: "pnpm@11.9.0" }, new Set()), [])
  for (const value of [
    "yarn@4.0.0",
    "pnpm@https://example.com/pnpm.tgz",
    "pnpm@latest",
  ]) {
    assert.equal(
      manifestViolations({ packageManager: value }, new Set()).length,
      1,
      value,
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
