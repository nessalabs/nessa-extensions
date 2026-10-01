/**
 * The typecheck and build guards, run for real — `tsc` and Vite — on small
 * repositories laid out as pnpm installs this one: each tries one way out of
 * an extension and expects it refused, and the legitimate extension passes.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const script = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url))

const manifest = (name, fields = {}) =>
  JSON.stringify({ name, private: true, type: "module", ...fields })

const extensionTsconfig = JSON.stringify({ extends: "../../tsconfig.base.json" })

/** A file pnpm would never write: not an image anyone could mistake for one. */
const png = "\u0089PNG\r\n\u001a\nnot really an image, but read like one"

/**
 * The legitimate layout: extension `experiments` uses its own files, the
 * package it declares, and an npm package; extension `notes` is the sibling
 * every escape aims at.
 */
const legitimate = {
  "tsconfig.base.json": JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM"],
      module: "ESNext",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: [],
    },
    exclude: ["**/node_modules", "**/dist"],
  }),
  "packages/common/package.json": manifest("@nessalabs/common", {
    exports: { ".": "./src/index.ts" },
  }),
  "packages/common/tsconfig.json": extensionTsconfig,
  "packages/common/src/index.ts": `export const one = 1\n`,
  "extensions/notes/package.json": manifest("@nessalabs/notes"),
  "extensions/notes/tsconfig.json": extensionTsconfig,
  "extensions/notes/src/index.ts": `export const secret = "sibling secret"\n`,
  "extensions/notes/assets/x.css": `body { color: red }\n`,
  "extensions/notes/assets/logo.png": png,
  "extensions/notes/assets/bg.png": png,
  "extensions/notes/assets/u.png": png,
  "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
    dependencies: { "left-pad": "^1.0.0" },
    devDependencies: { "@nessalabs/common": "workspace:*" },
  }),
  "extensions/experiments/tsconfig.json": extensionTsconfig,
  "extensions/experiments/vite.config.ts": `export default { build: { outDir: "dist", assetsInlineLimit: 0 } }\n`,
  "extensions/experiments/index.html": [
    `<!doctype html>`,
    `<link rel="stylesheet" href="./src/style.css">`,
    `<script type="module" src="./src/main.ts"></script>`,
    `<img src="./src/logo.png">`,
  ].join("\n"),
  "extensions/experiments/src/main.ts": [
    `import { one } from "@nessalabs/common"`,
    `import pad from "left-pad"`,
    `import { own } from "./own.ts"`,
    `console.log(one, pad, own, new URL("./logo.png", import.meta.url))`,
  ].join("\n"),
  "extensions/experiments/src/own.ts": `export const own = "own"\n`,
  "extensions/experiments/src/left-pad.d.ts": `declare module "left-pad" { const pad: (s: string) => string; export default pad }\n`,
  "extensions/experiments/src/style.css": `body { background: url("./logo.png") }\n`,
  "extensions/experiments/src/logo.png": png,
  "node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad/package.json": manifest(
    "left-pad",
    { version: "1.0.0", main: "index.js" },
  ),
  "node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad/index.js": `export default (s) => " " + s\n`,
}

/** The links pnpm makes for `legitimate`'s manifests. */
const links = {
  "extensions/experiments/node_modules/@nessalabs/common": "../../../../packages/common",
  "extensions/experiments/node_modules/left-pad":
    "../../../node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad",
}

/**
 * A repository on disk: `legitimate` with `files` over it (`null` removes
 * one), and `legitimate`'s links plus `extra` links (`null` removes one).
 */
function repository(t, files = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-boundary-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries({ ...legitimate, ...files })) {
    if (text === null) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  for (const [path, target] of Object.entries({ ...links, ...extra })) {
    if (target === null) continue
    mkdirSync(dirname(join(root, path)), { recursive: true })
    symlinkSync(target, join(root, path))
  }
  return root
}

/**
 * Runs a guard on `root`. `stderr` is what it printed, less the line saying
 * the sibling extension has nothing to build.
 */
function run(name, root) {
  const result = spawnSync(process.execPath, [script(name), root], { encoding: "utf8" })
  const quiet = "extensions/notes: no vite.config.ts, so nothing to build\n"
  return { status: result.status, stderr: result.stderr.replace(quiet, "") }
}

/** Every file the build wrote, as text. */
function built(root) {
  const directory = join(root, "extensions/experiments/dist")
  if (!existsSync(directory)) return ""
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n")
}

const sibling = "which is in extensions/notes; extensions never import one another"
const refused = (path, why = sibling) =>
  `extensions/experiments: its build reads ${path}, ${why}`

test("an extension using its own files, a declared package, and an npm package passes", (t) => {
  const root = repository(t)
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 0, typecheck.stderr)
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
  assert.equal(build.stderr, "")
  assert.match(built(root), /own/)
})

test("a package declared in dependencies rather than devDependencies passes too", (t) => {
  const root = repository(t, {
    "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
      dependencies: { "@nessalabs/common": "workspace:*", "left-pad": "^1.0.0" },
    }),
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
})

test("a package named only as a peer or optional dependency is not declared", (t) => {
  const root = repository(t, {
    "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
      dependencies: { "left-pad": "^1.0.0" },
      peerDependencies: { "@nessalabs/common": "workspace:*" },
      optionalDependencies: { "@nessalabs/common": "workspace:*" },
    }),
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.match(
    build.stderr,
    /which is in packages\/common, and extensions\/experiments does not declare it/,
  )
})

test("an extension with nothing to build says so and passes", (t) => {
  const root = repository(t, { "extensions/experiments/vite.config.ts": null })
  const build = run("build.mjs", root)
  assert.equal(build.status, 0)
  assert.equal(
    build.stderr,
    "extensions/experiments: no vite.config.ts, so nothing to build\n",
  )
})

test("an import from a sibling extension is refused by typecheck and build", (t) => {
  const root = repository(t, {
    "extensions/experiments/src/own.ts": `export { secret as own } from "../../notes/src/index.ts"\n`,
  })
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.match(
    typecheck.stderr,
    /extensions\/notes\/src\/index\.ts' is not under 'rootDir'/,
  )
  assert.match(
    typecheck.stderr,
    /^extensions\/experiments: does not typecheck within its folder$/m,
  )
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
})

test("a relative path out of the folder is refused, to the repository or beyond it", (t) => {
  const outside = mkdtempSync(join(tmpdir(), "nessa-extensions-outside-"))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, "far.ts"), `export const far = 2\n`)
  const root = repository(t, {
    "scripts/tool.ts": `export const tool = 1\n`,
    "extensions/experiments/src/own.ts": [
      `import { tool } from "../../../scripts/tool.ts"`,
      `import { far } from "${join(outside, "far.ts")}"`,
      `export const own = [tool, far]`,
    ].join("\n"),
  })
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.match(typecheck.stderr, /scripts\/tool\.ts' is not under 'rootDir'/)
  assert.match(typecheck.stderr, /far\.ts' is not under 'rootDir'/)
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  const lines = build.stderr.trim().split("\n")
  assert.ok(
    lines.includes(
      refused("scripts/tool.ts", "which is outside every extension and package"),
    ),
  )
  assert.ok(
    lines.some((line) =>
      /reads \.\.\/.*far\.ts, which is outside the repository$/.test(line),
    ),
  )
})

test("a path spelled with backslashes is refused, and nothing of the sibling is built", (t) => {
  const root = repository(t, {
    "extensions/experiments/src/own.ts": `export { secret as own } from "..\\\\..\\\\notes\\\\src\\\\index.ts"\n`,
  })
  assert.match(
    readFileSync(join(root, "extensions/experiments/src/own.ts"), "utf8"),
    /"\.\.\\\\\.\.\\\\notes/,
  )
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.match(
    typecheck.stderr,
    /extensions\/notes\/src\/index\.ts' is not under 'rootDir'/,
  )
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.match(
    build.stderr,
    /^extensions\/experiments: the build failed: .*failed to resolve import/m,
  )
  assert.doesNotMatch(built(root), /sibling secret/)
})

test("an HTML script spelled with character references is refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/index.html": `<!doctype html>\n<script type="module" src="&#46;&#46;/notes/src/index.ts"></script>\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
})

test("assets and styles that never enter the module graph are refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/index.html": [
      `<!doctype html>`,
      `<link rel="stylesheet" href="./src/style.css">`,
      `<script type="module" src="./src/main.ts"></script>`,
      `<img src="../notes/assets/logo.png">`,
    ].join("\n"),
    "extensions/experiments/src/style.css": [
      `@import "../../notes/assets/x.css";`,
      `body { background: url("../../notes/assets/bg.png") }`,
    ].join("\n"),
    "extensions/experiments/src/main.ts": `console.log(new URL("../../notes/assets/u.png", import.meta.url))\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.deepEqual(build.stderr.trim().split("\n").sort(), [
    refused("extensions/notes/assets/bg.png"),
    refused("extensions/notes/assets/logo.png"),
    refused("extensions/notes/assets/u.png"),
    refused("extensions/notes/assets/x.css"),
  ])
})

test("a public directory in a sibling extension is refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/vite.config.ts": `export default { publicDir: "../notes/assets", build: { outDir: "dist" } }\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.match(build.stderr, /its build reads extensions\/notes\/assets/)
})

test("a workspace package the extension does not declare is refused", (t) => {
  const manifestWithout = manifest("@nessalabs/experiments", {
    dependencies: { "left-pad": "^1.0.0" },
  })
  t.test("not linked, it does not resolve", (t) => {
    const root = repository(
      t,
      { "extensions/experiments/package.json": manifestWithout },
      { "extensions/experiments/node_modules/@nessalabs/common": null },
    )
    const typecheck = run("typecheck.mjs", root)
    assert.equal(typecheck.status, 1)
    assert.match(typecheck.stderr, /Cannot find module '@nessalabs\/common'/)
    const build = run("build.mjs", root)
    assert.equal(build.status, 1)
    assert.match(
      build.stderr,
      /^extensions\/experiments: the build failed: .*failed to resolve import "@nessalabs\/common"/m,
    )
  })
  t.test("linked where another manifest put it, the build refuses it", (t) => {
    const root = repository(
      t,
      { "extensions/experiments/package.json": manifestWithout },
      {
        "extensions/experiments/node_modules/@nessalabs/common": null,
        "node_modules/@nessalabs/common": "../../packages/common",
      },
    )
    const build = run("build.mjs", root)
    assert.equal(build.status, 1)
    assert.equal(
      build.stderr,
      `${refused("packages/common/src/index.ts", "which is in packages/common, and extensions/experiments does not declare it")}\n`,
    )
  })
})

test("a symbolic link out of the folder is refused where it leads", (t) => {
  const root = repository(
    t,
    {
      "extensions/experiments/src/own.ts": `export { secret as own } from "./borrowed/index.ts"\n`,
      "extensions/experiments/index.html": `<!doctype html>\n<script type="module" src="./src/main.ts"></script>\n<img src="./assets/logo.png">\n`,
    },
    {
      "extensions/experiments/src/borrowed": "../../notes/src",
      "extensions/experiments/assets": "../notes/assets",
    },
  )
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.deepEqual(build.stderr.trim().split("\n").sort(), [
    refused("extensions/notes/assets/logo.png"),
    refused("extensions/notes/src/index.ts"),
  ])
})

test("a package reaching into an extension is refused, in its typecheck and the build", (t) => {
  const root = repository(t, {
    "packages/common/src/index.ts": `export { secret as one } from "../../../extensions/notes/src/index.ts"\n`,
  })
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.match(
    typecheck.stderr,
    /^packages\/common: does not typecheck within its folder$/m,
  )
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
})

test("a unit's tsconfig cannot widen its rootDir", (t) => {
  const root = repository(t, {
    "extensions/experiments/tsconfig.json": JSON.stringify({
      extends: "../../tsconfig.base.json",
      compilerOptions: { rootDir: "../.." },
    }),
    "extensions/experiments/src/own.ts": `export { secret as own } from "../../notes/src/index.ts"\n`,
  })
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.match(typecheck.stderr, /is not under 'rootDir'/)
})

test("an extension that is a symbolic link to another is built, and refused", (t) => {
  const root = repository(t, {}, { "extensions/alias": "experiments" })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.ok(
    build.stderr
      .trim()
      .split("\n")
      .includes(
        "extensions/alias: its build reads extensions/experiments/index.html, which is in extensions/experiments; extensions never import one another",
      ),
    build.stderr,
  )
})
