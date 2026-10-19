/**
 * node extensions/experiments/verification/large.mjs [--transport-only]
 *
 * Node 24, after pnpm build. The default drives the built app in the fake
 * host in Chromium and WebKit. --transport-only writes byte evidence without
 * claiming a browser or Nessa-host pass. No credentials or model are used.
 */
import { tmpdir } from "node:os"
import { createServer } from "node:http"
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { build } from "vite"
import { overStdio, overHttp, apps } from "@nessalabs/server-kit/testing"
import { experimentsExtension } from "../server/extension.ts"
import { callPaged } from "../app/paged-call.ts"
import { checkoutSample, scaleSample } from "../samples/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const sample = scaleSample(Date.UTC(2026, 9, 1))
const sampleBytes = Buffer.byteLength(JSON.stringify(sample))
const checkoutBytes = Buffer.byteLength(JSON.stringify(checkoutSample(sample.startedAt)))
if (sampleBytes < 10 * checkoutBytes)
  throw new Error("The sample is smaller than ten times checkout.")
// Contract source: nessa-agent mcp_servers/domain/app_call.rs and
// conversation/application/service/app_calls.rs. The host remains the enforcer.
const limit = 57_344
const calls = []
let engine = "transport"
const definition = experimentsExtension({
  source: {
    ids: async () => [sample.id],
    experiment: async () => sample,
    openFile: async () => ({
      kind: "unavailable",
      reason: "The sample has no files to open.",
    }),
  },
  html: () => readFile(join(here, "../dist/app/index.html"), "utf8"),
})
function measured(client, transport) {
  return {
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      const bytes = Buffer.byteLength(JSON.stringify(JSON.stringify(result)))
      calls.push({
        engine,
        transport,
        tool: name,
        offset: args?.continuation?.offset ?? 0,
        bytes,
      })
      if (bytes > limit) throw new Error(`${name}: ${bytes} bytes exceeds ${limit}`)
      if (result.isError === true) throw new Error(JSON.stringify(result.content))
      return result
    },
  }
}
const evidence = join(here, "evidence/large")
await mkdir(evidence, { recursive: true })
const summary = {
  sampleBytes,
  checkoutBytes,
  ratio: sampleBytes / checkoutBytes,
  limit,
  browsers: [],
  calls,
}
let connection
let server
let browser
let buildDirectory
try {
  for (const [transport, connect] of [
    ["stdio-entry", overStdio],
    ["loopback-http", overHttp],
  ]) {
    connection = await connect(definition, { era: "modern", mimeTypes: apps })
    const bridge = measured(connection.client, transport)
    await callPaged(bridge, "get_experiment", { experimentId: sample.id })
    await callPaged(bridge, "list_runs", { experimentId: sample.id })
    await callPaged(bridge, "get_run", { experimentId: sample.id, runId: "planner" })
    await callPaged(bridge, "open_file", { experimentId: sample.id, runId: "planner" })
    await connection.close()
    connection = undefined
  }
  if (!process.argv.includes("--transport-only")) {
    connection = await overStdio(definition, { era: "modern", mimeTypes: apps })
    const bridge = measured(connection.client, "stdio-entry")
    const hostDir = join(here, "host")
    const outDir = await mkdtemp(join(tmpdir(), "nessa-large-host-"))
    buildDirectory = outDir
    await build({
      root: hostDir,
      configFile: false,
      logLevel: "error",
      build: {
        outDir,
        emptyOutDir: true,
        rolldownOptions: { input: join(hostDir, "large.html") },
      },
    })
    server = createServer(async (request, response) => {
      try {
        if (request.url === "/call" && request.method === "POST") {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const call = JSON.parse(Buffer.concat(chunks).toString())
          const result = await bridge.callTool(call.name, call.arguments)
          response.writeHead(200, { "content-type": "application/json" })
          response.end(JSON.stringify(result))
        } else if (request.url === "/favicon.ico") {
          response.writeHead(204)
          response.end()
        } else {
          const path = request.url === "/" ? "/large.html" : request.url
          if (!/^\/(large\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) {
            response.writeHead(404)
            response.end()
            return
          }
          const data = await readFile(join(outDir, path))
          response.writeHead(200, {
            "content-type": path.endsWith(".js")
              ? "text/javascript"
              : path.endsWith(".css")
                ? "text/css"
                : "text/html",
          })
          response.end(data)
        }
      } catch (error) {
        response.writeHead(500)
        response.end(String(error))
      }
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const store = join(here, "../../../node_modules/.pnpm")
    const entry = (await readdir(store)).find((name) => name.startsWith("playwright@"))
    if (entry === undefined) throw new Error("Playwright is not installed.")
    const { chromium, webkit } = await import(
      join(store, entry, "node_modules/playwright/index.mjs")
    )
    for (const [name, launcher] of [
      ["chromium", chromium],
      ["webkit", webkit],
    ]) {
      engine = name
      browser = await launcher.launch({
        headless: true,
        ...(name === "chromium" && process.env.EXPERIMENTS_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.EXPERIMENTS_CHROMIUM_EXECUTABLE }
          : {}),
      })
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      await page.goto(origin)
      const app = page.frameLocator("iframe")
      await app.getByRole("heading", { name: sample.title }).waitFor()
      await app.getByRole("button", { name: "Open experiment" }).click()
      await app.getByRole("tab", { name: "Runs" }).click()
      await app.getByRole("button", { name: /^Run 1\b/ }).click()
      await app.getByRole("heading", { name: "Run 1", exact: true }).waitFor()
      const field = app.getByRole("textbox", { name: "Find a file" })
      await field.waitFor()
      const rows = await app.locator(".change-file").count()
      if (rows <= 0 || rows >= 10_000)
        throw new Error(`Expected virtualized files, got ${rows}`)
      if (errors.length) throw new Error(errors.join("\n"))
      await page.locator("#host").screenshot({ path: join(evidence, `${name}-run.png`) })
      summary.browsers.push({
        engine: name,
        version: browser.version(),
        ok: true,
        visibleFiles: rows,
        errors: errors.length,
      })
      await browser.close()
      browser = undefined
    }
  }
  summary.ok = true
} catch (error) {
  summary.ok = false
  summary.error = String(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (buildDirectory !== undefined)
    await rm(buildDirectory, { recursive: true, force: true })
  await connection?.close()
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()))
  await writeFile(
    join(
      evidence,
      process.argv.includes("--transport-only")
        ? "transport-calls.json"
        : "browser-calls.json",
    ),
    JSON.stringify(summary, null, 2) + "\n",
  )
  process.stdout.write(
    JSON.stringify({
      ...summary,
      calls: calls.length,
      maxCallBytes: Math.max(...calls.map((call) => call.bytes)),
    }) + "\n",
  )
}
