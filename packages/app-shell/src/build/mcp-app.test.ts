/// <reference types="node" />
/**
 * The plugin in a real Vite build, of a small app written to a temporary
 * directory: one HTML file out, and a refused build for anything it would
 * have to fetch.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "vite"
import { afterEach, describe, expect, it } from "vitest"

import { mcpApp } from "./mcp-app.ts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function app(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "app-shell-mcp-app-"))
  roots.push(root)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

const buildApp = (root: string) =>
  build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [mcpApp()],
    build: { outDir: join(root, "dist") },
  })

describe("mcpApp", () => {
  it("builds one HTML file with the script, the stylesheet, and an asset written in", async () => {
    const root = app({
      "index.html":
        '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head>' +
        '<body><script type="module" src="./main.ts"></script></body></html>',
      "style.css": "body { background: url(./dot.svg) }",
      "dot.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
      "main.ts": 'import("./later.ts").then((m) => m.say("</script>"))\nexport {}',
      "later.ts": "export const say = (text: string) => document.body.append(text)",
    })
    await buildApp(root)
    expect(readdirSync(join(root, "dist"))).toEqual(["index.html"])
    const html = readFileSync(join(root, "dist", "index.html"), "utf8")
    expect(html).toMatch(/<script type="module">[\s\S]*<\\\/script>[\s\S]*<\/script>/)
    expect(html).toMatch(/<style>[\s\S]*data:image\/svg\+xml[\s\S]*<\/style>/)
    expect(html).not.toMatch(/\ssrc="\.?\//)
    expect(html).not.toMatch(/\shref="\.?\//)
  })

  it("refuses a build whose HTML names a script it did not make", async () => {
    const root = app({
      "index.html":
        '<!doctype html><html><head></head><body><script src="https://cdn.example/x.js"></script>' +
        '<script type="module" src="./main.ts"></script></body></html>',
      "main.ts": "export {}",
    })
    await expect(buildApp(root)).rejects.toThrow(
      "the HTML names files the build did not make: https://cdn.example/x.js",
    )
  })

  it("refuses a build that leaves a file the HTML would fetch", async () => {
    const root = app({
      "index.html":
        '<!doctype html><html><head></head><body><script type="module" src="./main.ts"></script></body></html>',
      "main.ts": "export {}",
      "public/robots.txt": "User-agent: *",
    })
    await expect(buildApp(root)).rejects.toThrow(
      "has files, which Vite copies beside the app for it to fetch; import them instead",
    )
  })

  it("refuses a build with a file the HTML does not take in, such as another plugin's", async () => {
    const root = app({
      "index.html":
        '<!doctype html><html><head></head><body><script type="module" src="./main.ts"></script></body></html>',
      "main.ts": "export {}",
    })
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          {
            name: "emits-a-file",
            generateBundle() {
              this.emitFile({ type: "asset", fileName: "extra.json", source: "{}" })
            },
          },
          mcpApp(),
        ],
        build: { outDir: join(root, "dist") },
      }),
    ).rejects.toThrow("these would be fetched, which a host's policy refuses: extra.json")
  })
})
