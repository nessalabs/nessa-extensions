import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkRepository } from "../check-architecture.mjs"

const script = fileURLToPath(new URL("../check-architecture.mjs", import.meta.url))

const pinnedWorkspace =
  'packages:\n  - "packages/*"\n  - "extensions/*"\nhoistWorkspacePackages: false\n'

/**
 * A repository on disk made of `files`, over a pinned `pnpm-workspace.yaml`
 * unless `files` gives its own (or `null` for none); removed when the test ends.
 */
function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-architecture-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const all = { "pnpm-workspace.yaml": pinnedWorkspace, ...files }
  for (const [path, text] of Object.entries(all)) {
    if (text === null) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const manifest = (name, fields = {}) => JSON.stringify({ name, ...fields })

const twoExtensions = {
  "package.json": manifest("root"),
  "extensions/experiments/package.json": manifest("@nessalabs/experiments"),
  "extensions/notes/package.json": manifest("@nessalabs/notes"),
}

test("an empty repository passes", (t) => {
  const root = repository(t, { "README.md": "" })
  assert.deepEqual(checkRepository(root), [])
})

test("a repository without pnpm-workspace.yaml fails", (t) => {
  const root = repository(t, { "pnpm-workspace.yaml": null })
  assert.deepEqual(checkRepository(root), [
    "pnpm-workspace.yaml: is missing; it pins the workspace's layout",
  ])
})

test("a workspace setting off the list fails", (t) => {
  const root = repository(t, {
    "pnpm-workspace.yaml": `${pinnedWorkspace}nodeLinker: hoisted\n`,
  })
  assert.deepEqual(checkRepository(root), [
    "pnpm-workspace.yaml: nodeLinker is not one of packages, allowBuilds, verifyDepsBeforeRun, hoistWorkspacePackages",
  ])
})

test("a file pnpm reads settings or hooks from fails, at the root or in a unit", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    ".npmrc": "node-linker=hoisted\n",
    ".pnpmfile.cjs": "",
    "extensions/notes/.npmrc": "",
    "packages/server-kit/package.json": manifest("@nessalabs/server-kit"),
    "packages/server-kit/.pnpmfile.mjs": "",
  })
  const rule =
    "pnpm reads settings or a manifest from it; the layout is pinned to package.json and pnpm-workspace.yaml"
  assert.deepEqual(checkRepository(root), [
    `.npmrc: ${rule}`,
    `.pnpmfile.cjs: ${rule}`,
    `packages/server-kit/.pnpmfile.mjs: ${rule}`,
    `extensions/notes/.npmrc: ${rule}`,
  ])
})

test("a manifest pnpm reads instead of package.json fails, and a unit needs package.json", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "packages/evil/package.yaml": "name: evil\n",
    "extensions/notes/package.json5": "{}",
  })
  const rule =
    "pnpm reads settings or a manifest from it; the layout is pinned to package.json and pnpm-workspace.yaml"
  assert.deepEqual(checkRepository(root), [
    "packages/evil/package.json: a package needs a manifest, and it is package.json",
    `packages/evil/package.yaml: ${rule}`,
    `extensions/notes/package.json5: ${rule}`,
  ])
})

test("a manifest naming an extension, or off the pinned layout, fails", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "package.json": manifest("root", {
      pnpm: {},
      devDependencies: { bee: "./extensions/notes" },
    }),
    "packages/server-kit/package.json": manifest("@nessalabs/server-kit", {
      dependencies: { "@nessalabs/notes": "workspace:*" },
    }),
    "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
      dependencies: { "@nessalabs/server-kit": "workspace:*", zod: "^4.0.0" },
    }),
  })
  assert.deepEqual(checkRepository(root), [
    "package.json: pnpm is not a manifest key this layout allows",
    'package.json: devDependencies bee is "./extensions/notes"; a dependency is workspace:*, a semver range, or a dist-tag',
    "packages/server-kit/package.json: dependencies names extension @nessalabs/notes; nothing depends on an extension — share it through a package",
  ])
})

test("an extension's manifest must name it, and parse", (t) => {
  const root = repository(t, {
    "extensions/nameless/package.json": JSON.stringify({ version: "0.0.0" }),
    "extensions/broken/package.json": "{bad",
  })
  assert.deepEqual(checkRepository(root).sort(), [
    "extensions/broken/package.json: is not valid JSON",
    "extensions/nameless/package.json: an extension's manifest names its package",
  ])
})

test("a symbolic link in or as a unit fails, however deep, and is not followed", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "extensions/notes/server/index.ts": "",
  })
  symlinkSync(
    join(root, "extensions/notes/server"),
    join(root, "extensions/experiments/borrowed"),
  )
  mkdirSync(join(root, "extensions/experiments/src/dist"), { recursive: true })
  symlinkSync("../../../notes", join(root, "extensions/experiments/src/dist/notes"))
  mkdirSync(join(root, "extensions/experiments/src/node_modules"), { recursive: true })
  symlinkSync("../../../notes", join(root, "extensions/experiments/src/node_modules/x"))
  symlinkSync(join(root, "extensions/notes"), join(root, "extensions/alias"))
  const rule = "a symbolic link in a unit can lead into another"
  assert.deepEqual(checkRepository(root), [
    `extensions/alias: ${rule}`,
    `extensions/experiments/borrowed: ${rule}`,
    `extensions/experiments/src/dist/notes: ${rule}`,
    `extensions/experiments/src/node_modules/x: ${rule}`,
  ])
})

test("skips the links pnpm and the build write at a unit's root, and dot-directories", (t) => {
  const root = repository(t, {
    ...twoExtensions,
    "extensions/experiments/dist/app.js": "",
    "extensions/.cache/x.ts": "",
  })
  mkdirSync(join(root, "extensions/experiments/node_modules/@nessalabs"), {
    recursive: true,
  })
  symlinkSync(
    "../../../../packages/server-kit",
    join(root, "extensions/experiments/node_modules/@nessalabs/server-kit"),
  )
  symlinkSync("../../notes", join(root, "extensions/experiments/dist/notes"))
  symlinkSync("../notes", join(root, "extensions/.cache/notes"))
  assert.deepEqual(checkRepository(root), [])
})

test("an extension without a manifest fails", (t) => {
  const root = repository(t, {
    "extensions/unnamed/server/index.ts": "",
  })
  assert.deepEqual(checkRepository(root), [
    "extensions/unnamed/package.json: an extension is one package and needs a manifest",
  ])
})

/** A repository whose only failure is a link from experiments into notes. */
function linked(t) {
  const root = repository(t, twoExtensions)
  symlinkSync("../notes", join(root, "extensions/experiments/notes"))
  return root
}

test("the command exits 1 with each failure on stderr, and 0 when clean", (t) => {
  const broken = linked(t)
  const failed = spawnSync(process.execPath, [script, broken], { encoding: "utf8" })
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, "")
  assert.equal(
    failed.stderr,
    "extensions/experiments/notes: a symbolic link in a unit can lead into another\n",
  )

  const clean = repository(t, twoExtensions)
  const passed = spawnSync(process.execPath, [script, clean], { encoding: "utf8" })
  assert.equal(passed.status, 0)
  assert.equal(passed.stderr, "")
})

test("the command still checks when run through a symlink", (t) => {
  const broken = linked(t)
  const link = join(broken, "linked-check.mjs")
  symlinkSync(script, link)
  const result = spawnSync(process.execPath, [link, broken], { encoding: "utf8" })
  assert.equal(result.status, 1)
})
