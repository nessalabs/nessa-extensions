/**
 * Screenshots of each component, for both samples, inside the fake host.
 * Builds the preview and the host page, serves them, and writes one PNG per
 * component under the directory given as the first argument.
 *
 *   node extensions/experiments/capture.ts /opt/cursor/artifacts
 */
/// <reference types="node" />
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Page } from "@playwright/test"
import { build } from "vite"

import { mcpApp } from "@nessalabs/app-shell/build"

const here = fileURLToPath(new URL(".", import.meta.url))
const out = process.argv[2]
if (out === undefined || out === "") {
  console.error("give the directory the screenshots go in")
  process.exit(1)
}

const components = ["climb", "map", "areas", "verdicts", "cases", "change"] as const
const samples = ["checkout", "latency"] as const
const stage = await mkdtemp(join(tmpdir(), "experiments-preview-"))

await build({
  root: join(here, "app"),
  configFile: false,
  logLevel: "warn",
  plugins: [mcpApp()],
  build: {
    outDir: join(stage, "app"),
    emptyOutDir: true,
    rolldownOptions: { input: join(here, "app/preview.html") },
  },
})
await build({
  root: join(here, "app"),
  configFile: false,
  logLevel: "warn",
  base: "./",
  build: {
    outDir: join(stage, "host"),
    emptyOutDir: true,
    rolldownOptions: { input: join(here, "app/preview-host.html") },
  },
})

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
])

/** A file under `root`, or undefined when `pathname` climbs out of it. */
function fileUnder(root: string, pathname: string): string | undefined {
  const name = pathname === "/" ? "preview-host.html" : pathname.slice(1)
  if (name.includes("\0")) return undefined
  const file = resolve(root, name)
  const base = resolve(root)
  if (file !== base && !file.startsWith(`${base}${sep}`)) return undefined
  return file
}

const hostRoot = join(stage, "host")
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const file = fileUnder(hostRoot, url.pathname)
  if (file === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  try {
    const body = await readFile(file)
    const ext = file.slice(file.lastIndexOf("."))
    response.writeHead(200, {
      "content-type": types.get(ext) ?? "application/octet-stream",
    })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end()
  }
})

await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady))
const address = server.address()
if (address === null || typeof address === "string") {
  throw new Error("the preview server has no port")
}
const html = await readFile(join(stage, "app/preview.html"), "utf8")

async function show(page: Page, source: string, name: (typeof samples)[number]) {
  await page.evaluate(
    ({ source: app, name: sample }) => {
      const start = Reflect.get(window, "startPreview")
      if (typeof start !== "function")
        throw new Error("the preview host is not installed")
      return Reflect.apply(start, window, [app, sample])
    },
    { source, name },
  )
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text())
})
await page.goto(`http://127.0.0.1:${address.port}/`)
const frame = page.frameLocator("iframe")

for (const sample of samples) {
  await show(page, html, sample)
  await frame.locator("[data-ready]").waitFor()
  const title = sample === "checkout" ? "Resolution rate" : "p95 latency"
  await frame.getByText(title).first().waitFor()
  for (const component of components) {
    const part = frame.locator(`[data-component="${component}"]`)
    if (component === "climb") {
      const point =
        sample === "latency"
          ? frame.getByRole("button", { name: "#5 Slower" })
          : frame.getByRole("button", { name: /#\d+ Kept/ }).first()
      await point.hover()
    }
    if (component === "map" && sample === "checkout") {
      await frame
        .getByRole("button", { name: /System prompt #/ })
        .first()
        .hover()
    }
    await part.screenshot({ path: join(out, `experiments-${sample}-${component}.png`) })
  }
}

await browser.close()
server.close()
await rm(stage, { recursive: true, force: true })
if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exit(1)
}
