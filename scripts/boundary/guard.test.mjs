/**
 * The typecheck and build guards, run for real — TypeScript and Vite — on
 * small repositories laid out as pnpm installs this one: each tries one way
 * out of an extension and expects it refused, and nothing of the sibling in
 * the output; the legitimate extension passes.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  "packages/server-kit/package.json": manifest("@nessalabs/server-kit", {
    exports: { ".": "./src/index.ts" },
  }),
  "packages/server-kit/tsconfig.json": extensionTsconfig,
  "packages/server-kit/src/index.ts": `export const two = 2\n`,
  "extensions/notes/package.json": manifest("@nessalabs/notes"),
  "extensions/notes/tsconfig.json": extensionTsconfig,
  "extensions/notes/src/index.ts": `export const secret = "sibling secret"\n`,
  "extensions/notes/assets/x.css": `body::after { content: "sibling secret" }\n`,
  "extensions/notes/assets/logo.png": `${png} sibling secret`,
  "extensions/notes/assets/bg.png": `${png} sibling secret`,
  "extensions/notes/assets/u.png": `${png} sibling secret`,
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
    `import note from "./note.txt?raw"`,
    `console.log(one, pad, own, note, new URL("./logo.png", import.meta.url))`,
  ].join("\n"),
  "extensions/experiments/src/own.ts": `export const own = "own"\n`,
  "extensions/experiments/src/note.txt": `own note\n`,
  "extensions/experiments/src/raw.d.ts": `declare module "*?raw" { const text: string; export default text }\n`,
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
 * one; a function is given the repository's real path), and `legitimate`'s
 * links plus `extra` links (`null` removes one).
 */
function repository(t, files = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "nessa-extensions-boundary-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const real = realpathSync(root)
  for (const [path, contents] of Object.entries({ ...legitimate, ...files })) {
    const text = typeof contents === "function" ? contents(real) : contents
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

/** Everything the build left in the extension's `dist`, as text; "" if none. */
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
  `extensions/experiments: its build uses ${path}, ${why}`

/** The build failed, said why on one line naming `what`, and left no output. */
function failsFinding(root, what) {
  const build = run("build.mjs", root)
  assert.equal(build.status, 1, build.stderr)
  const line = build.stderr
    .split("\n")
    .find((each) => each.startsWith("extensions/experiments: the build failed: "))
  assert.ok(line?.includes(what), build.stderr)
  assert.equal(built(root), "")
}

/** The typecheck failed for `unit`, with TS6059 naming `file`. */
function outsideRootDir(root, file, unit = "extensions/experiments") {
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 1)
  assert.ok(
    typecheck.stderr.includes(`${file}' is not under 'rootDir'`),
    typecheck.stderr,
  )
  assert.match(
    typecheck.stderr,
    new RegExp(`^${unit}: does not typecheck within its folder$`, "m"),
  )
}

test("an extension using its own files, a declared package, and an npm package passes", (t) => {
  const root = repository(t)
  const typecheck = run("typecheck.mjs", root)
  assert.equal(typecheck.status, 0, typecheck.stderr)
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
  assert.equal(build.stderr, "")
  assert.match(built(root), /\bown\b/)
  assert.match(built(root), /own note/)
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

test("a package a declared package declares comes with it", (t) => {
  const root = repository(
    t,
    {
      "packages/common/package.json": manifest("@nessalabs/common", {
        exports: { ".": "./src/index.ts" },
        dependencies: { "@nessalabs/server-kit": "workspace:*" },
      }),
      "packages/common/src/index.ts": `export { two as one } from "@nessalabs/server-kit"\n`,
    },
    { "packages/common/node_modules/@nessalabs/server-kit": "../../../server-kit" },
  )
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
})

test("what the toolchain reads outside the module graph is not judged", (t) => {
  // A Linux runner's Vite reads the Node binary, outside the repository.
  const root = repository(t, {
    "extensions/experiments/vite.config.ts": [
      `import { readFileSync } from "node:fs"`,
      `export default {`,
      `  plugins: [{ name: "reads-node", buildStart() { readFileSync(process.execPath, "utf8") } }],`,
      `  build: { outDir: "dist" },`,
      `}`,
    ].join("\n"),
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
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
  outsideRootDir(root, "extensions/notes/src/index.ts")
  failsFinding(root, "../../notes/src/index.ts")
})

test("an absolute path to a sibling extension is refused, and leaves no output", (t) => {
  const root = repository(t, {
    "extensions/experiments/src/own.ts": (real) =>
      `export { secret as own } from "${real}/extensions/notes/src/index.ts"\n`,
  })
  outsideRootDir(root, "extensions/notes/src/index.ts")
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
  assert.equal(built(root), "")
})

test("a relative path to the rest of the repository is refused", (t) => {
  const root = repository(t, {
    "scripts/tool.ts": `export const tool = "sibling secret"\n`,
    "extensions/experiments/src/own.ts": `export { tool as own } from "../../../scripts/tool.ts"\n`,
  })
  outsideRootDir(root, "scripts/tool.ts")
  failsFinding(root, "../../../scripts/tool.ts")
})

test("an absolute path outside the repository is refused", (t) => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "nessa-extensions-outside-")))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, "far.ts"), `export const far = "sibling secret"\n`)
  const root = repository(t, {
    "extensions/experiments/src/own.ts": `export { far as own } from "${join(outside, "far.ts")}"\n`,
  })
  outsideRootDir(root, "far.ts")
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.match(
    build.stderr,
    /its build uses \.\.\/.*far\.ts, which is outside the repository$/m,
  )
  assert.equal(built(root), "")
})

test("a path spelled with backslashes is refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/src/own.ts": `export { secret as own } from "..\\\\..\\\\notes\\\\src\\\\index.ts"\n`,
  })
  assert.match(
    readFileSync(join(root, "extensions/experiments/src/own.ts"), "utf8"),
    /"\.\.\\\\\.\.\\\\notes/,
  )
  outsideRootDir(root, "extensions/notes/src/index.ts")
  failsFinding(root, "notes")
})

test("an HTML script spelled with character references is refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/index.html": `<!doctype html>\n<script type="module" src="&#46;&#46;/notes/src/index.ts"></script>\n`,
  })
  failsFinding(root, "notes/src/index.ts")
})

test("assets and styles that never enter the module graph bring nothing of the sibling", (t) => {
  const cases = {
    "an HTML image": {
      "extensions/experiments/index.html": `<!doctype html>\n<img src="../notes/assets/logo.png">\n`,
    },
    "a CSS @import": {
      "extensions/experiments/src/style.css": `@import "../../notes/assets/x.css";\n`,
    },
    "a CSS @import inlined by lightningcss": {
      "extensions/experiments/vite.config.ts": `export default { css: { transformer: "lightningcss" }, build: { outDir: "dist" } }\n`,
      "extensions/experiments/src/style.css": `@import "../../notes/assets/x.css";\n`,
    },
    "a CSS url()": {
      "extensions/experiments/src/style.css": `body { background: url("../../notes/assets/bg.png") }\n`,
    },
    "new URL(…, import.meta.url)": {
      "extensions/experiments/src/own.ts": `export const own = new URL("../../notes/assets/u.png", import.meta.url)\n`,
    },
  }
  for (const [name, files] of Object.entries(cases)) {
    t.test(name, (t) => {
      // Vite fails on a missing stylesheet, and leaves a missing asset's URL
      // to be resolved at run time, where nothing serves it; either way the
      // sibling's file is not in the output.
      const root = repository(t, files)
      run("build.mjs", root)
      assert.doesNotMatch(built(root), /sibling secret/)
    })
  }
})

test("a public directory or .env files in a sibling extension are not there to read", (t) => {
  const root = repository(t, {
    "extensions/notes/assets/.env": `VITE_SECRET="sibling secret"\n`,
    "extensions/notes/assets/public.txt": `sibling secret\n`,
    "extensions/experiments/vite.config.ts": `export default { publicDir: "../notes/assets", envDir: "../notes/assets", build: { outDir: "dist" } }\n`,
    "extensions/experiments/src/own.ts": `export const own = (import.meta as any).env.VITE_SECRET\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 0, build.stderr)
  assert.doesNotMatch(built(root), /sibling secret/)
})

test("a worker's imports are held as the page's are", (t) => {
  const worker = (from) => ({
    "extensions/experiments/src/own.ts": `export const own = new Worker(new URL("./worker.js", import.meta.url), { type: "module" })\n`,
    "extensions/experiments/src/worker.js": from,
  })
  t.test("by a relative path", (t) => {
    const root = repository(
      t,
      worker(`import { secret } from "../../notes/src/index.ts"\npostMessage(secret)\n`),
    )
    outsideRootDir(root, "extensions/notes/src/index.ts")
    failsFinding(root, "../../notes/src/index.ts")
  })
  t.test("by an absolute path", (t) => {
    const root = repository(
      t,
      worker(
        (real) =>
          `import { secret } from "${real}/extensions/notes/src/index.ts"\npostMessage(secret)\n`,
      ),
    )
    const build = run("build.mjs", root)
    assert.equal(build.status, 1)
    assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
  })
})

test("what the Vite configuration imports from outside the folder is refused", (t) => {
  const root = repository(t, {
    "vite.shared.ts": `export const shared = { define: { __S__: JSON.stringify("sibling secret") } }\n`,
    "extensions/experiments/tsconfig.json": JSON.stringify({
      extends: "../../tsconfig.base.json",
      include: ["src"],
    }),
    "extensions/experiments/vite.config.ts": `import { shared } from "../../vite.shared.ts"\nexport default shared\n`,
  })
  outsideRootDir(root, "vite.shared.ts")
  failsFinding(root, "vite.shared.ts")
})

test("a module that is not a file on disk is refused", (t) => {
  const root = repository(t, {
    "extensions/experiments/vite.config.ts": [
      `export default {`,
      `  plugins: [{`,
      `    name: "from-nowhere",`,
      `    resolveId(id) { return id === "nowhere" ? "/nowhere/at/all.js" : null },`,
      `    load(id) { return id === "/nowhere/at/all.js" ? "export default 'sibling secret'" : null },`,
      `  }],`,
      `  build: { outDir: "dist" },`,
      `}`,
    ].join("\n"),
    "extensions/experiments/src/own.ts": `// @ts-expect-error: a module only the plugin knows\nexport { default as own } from "nowhere"\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(
    build.stderr,
    `${refused("/nowhere/at/all.js", "which is not a file on disk, so where it comes from cannot be checked")}\n`,
  )
  assert.equal(built(root), "")
})

test("a workspace package the extension does not declare is refused", (t) => {
  const without = (fields) => ({
    "extensions/experiments/package.json": manifest("@nessalabs/experiments", {
      dependencies: { "left-pad": "^1.0.0" },
      ...fields,
    }),
  })
  t.test("not linked, it does not resolve", (t) => {
    const root = repository(t, without({}), {
      "extensions/experiments/node_modules/@nessalabs/common": null,
    })
    const typecheck = run("typecheck.mjs", root)
    assert.equal(typecheck.status, 1)
    assert.match(typecheck.stderr, /Cannot find module '@nessalabs\/common'/)
    failsFinding(root, `failed to resolve import "@nessalabs/common"`)
  })
  t.test("linked where another manifest put it, it is not in the build", (t) => {
    const root = repository(t, without({}), {
      "extensions/experiments/node_modules/@nessalabs/common": null,
      "node_modules/@nessalabs/common": "../../packages/common",
    })
    failsFinding(root, `failed to resolve import "@nessalabs/common"`)
  })
  t.test("named only as a peer or optional dependency, it is not declared", (t) => {
    const root = repository(
      t,
      without({
        peerDependencies: { "@nessalabs/common": "workspace:*" },
        optionalDependencies: { "@nessalabs/common": "workspace:*" },
      }),
    )
    failsFinding(root, `failed to resolve import "@nessalabs/common"`)
  })
})

test("a file under a node_modules directory inside a sibling is still the sibling's", (t) => {
  const root = repository(t, {
    "extensions/notes/src/node_modules/leak.ts": `export const secret = "sibling secret"\n`,
    "extensions/experiments/src/own.ts": (real) =>
      `export { secret as own } from "${real}/extensions/notes/src/node_modules/leak.ts"\n`,
  })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.equal(build.stderr, `${refused("extensions/notes/src/node_modules/leak.ts")}\n`)
})

test("a symbolic link out of the folder is refused where it leads", (t) => {
  t.test("a relative link leads nowhere in the stage", (t) => {
    const root = repository(
      t,
      {
        "extensions/experiments/src/own.ts": `export { secret as own } from "./borrowed/index.ts"\n`,
      },
      { "extensions/experiments/src/borrowed": "../../notes/src" },
    )
    failsFinding(root, "./borrowed/index.ts")
  })
  t.test("an absolute link is followed to the sibling", (t) => {
    const root = repository(t, {
      "extensions/experiments/src/own.ts": `export { secret as own } from "./borrowed/index.ts"\n`,
    })
    symlinkSync(
      join(realpathSync(root), "extensions/notes/src"),
      join(root, "extensions/experiments/src/borrowed"),
    )
    const build = run("build.mjs", root)
    assert.equal(build.status, 1)
    assert.equal(build.stderr, `${refused("extensions/notes/src/index.ts")}\n`)
  })
})

test("an extension that is a symbolic link to another builds nothing of it", (t) => {
  const root = repository(t, {}, { "extensions/alias": "experiments" })
  const build = run("build.mjs", root)
  assert.equal(build.status, 1)
  assert.match(build.stderr, /^extensions\/alias: the build failed: /m)
})

test("a package reaching into an extension is refused, in its typecheck and the build", (t) => {
  const root = repository(t, {
    "packages/common/src/index.ts": `export { secret as one } from "../../../extensions/notes/src/index.ts"\n`,
  })
  outsideRootDir(root, "extensions/notes/src/index.ts", "packages/common")
  failsFinding(root, "../../../extensions/notes/src/index.ts")
})

test("a unit's tsconfig cannot narrow what is typechecked or widen where it reaches", (t) => {
  const escape = {
    "extensions/experiments/src/own.ts": `import type { Secret } from "../../notes/src/types.ts"\nexport const own: Secret = "x"\n`,
    "extensions/notes/src/types.ts": `export type Secret = string\n`,
  }
  const configs = {
    "a wider rootDir": { compilerOptions: { rootDir: "../.." } },
    "no files, only references": {
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    },
    "an include that leaves the file out": { include: ["nothing"] },
    noCheck: { compilerOptions: { noCheck: true } },
  }
  for (const [name, config] of Object.entries(configs)) {
    t.test(name, (t) => {
      const root = repository(t, {
        ...escape,
        "extensions/experiments/tsconfig.json": JSON.stringify({
          extends: "../../tsconfig.base.json",
          ...config,
        }),
        "extensions/experiments/tsconfig.app.json": JSON.stringify({
          extends: "../../tsconfig.base.json",
          include: ["nothing"],
        }),
      })
      outsideRootDir(root, "extensions/notes/src/types.ts")
    })
  }
})
