/**
 * Screenshots of the experiment app: the MCP Apps reference host
 * (`AppBridge`), and Nessa's desktop through a real gateway and this
 * extension's built server. Exits 0 when both sets are written. A page that
 * shows "Blocked a connection this app didn't declare" fails the run: that
 * notice is a sandbox CSP violation. This app declares no network. Zod's
 * fast path probes `new Function`, which a strict CSP reports even when the
 * throw is caught; the app sets `jitless` before any schema is built so the
 * probe does not run. The reference host is driven in Chromium and in
 * WebKit; the Chromium pass writes the reference-host shots. Nessa's
 * conversation view keeps at most 16KB of the opening structured result.
 * The checkout sample is larger, so the app loads it with get_experiment.
 * Both hosts are shown that experiment. The
 * scenario runner's completion does not name the MCP tool, and Nessa
 * attaches the forwarded result only when it does;
 * `forward-structured.mjs` adds that name.
 *
 *   node extensions/experiments/verification/capture.mjs
 *
 * `NESSA_AGENT_ROOT` is the nessa-agent checkout (default `/tmp/nessa-agent`).
 * The gateway binary is that checkout's `target/debug/nessa`, or `MCP_LIVE_NESSA`.
 */
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { createServer } from "node:http"
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { build } from "vite"

const here = dirname(fileURLToPath(import.meta.url))
const extension = dirname(here)
const shots = here
const hostDir = join(here, "host")
const nessaRoot = process.env.NESSA_AGENT_ROOT ?? "/tmp/nessa-agent"

/** A package export's file, read from its `package.json` rather than `createRequire`. */
function packageEntry(packageJson, subpath) {
  const directory = dirname(packageJson)
  const exported = JSON.parse(readFileSync(packageJson, "utf8")).exports?.[subpath]
  const target =
    typeof exported === "string" ? exported : (exported?.import ?? exported?.default)
  if (typeof target !== "string") {
    throw new Error(`${packageJson} has no ${subpath} export`)
  }
  return join(directory, target)
}

const bridge = packageEntry(
  join(
    extension,
    "../../packages/app-shell/node_modules/@modelcontextprotocol/ext-apps/package.json",
  ),
  "./app-bridge",
)
const pnpm = join(extension, "../../node_modules/.pnpm")
const playwrightDir = readdirSync(pnpm).find((name) =>
  name.startsWith("@playwright+test@"),
)
if (playwrightDir === undefined) throw new Error("playwright is not installed")
const { chromium, webkit } = await import(
  pathToFileURL(
    packageEntry(join(pnpm, playwrightDir, "node_modules/playwright/package.json"), "."),
  ).href
)

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8"
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  return "application/octet-stream"
}

function serve(root) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204)
      response.end()
      return
    }
    const path = join(root, url.pathname === "/" ? "reference.html" : url.pathname)
    try {
      const body = await readFile(path)
      response.writeHead(200, { "content-type": contentType(path) })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

async function buildReferenceHost() {
  await build({
    root: hostDir,
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: { "@modelcontextprotocol/ext-apps/app-bridge": bridge },
    },
    build: {
      outDir: join(hostDir, "dist"),
      emptyOutDir: true,
      rolldownOptions: { input: { reference: join(hostDir, "reference.html") } },
    },
  })
}

/** Drive the reference host. Chromium writes the shots; WebKit asserts the same path. */
async function driveReference(browser, origin, writeShots) {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() !== "error") return
    if (message.text().includes("favicon")) return
    errors.push(message.text())
  })
  await page.goto(`${origin}/reference.html`)
  await page.waitForFunction(() =>
    document.querySelector("iframe")?.hasAttribute("data-ready"),
  )
  const hostError = await page.evaluate(() => document.body.dataset.hostError ?? "")
  if (hostError !== "") throw new Error(hostError)
  const app = page.frameLocator("iframe")
  await app.getByRole("heading", { name: "Hill-climb checkout support" }).waitFor()
  const shot = async (name) => {
    if (!writeShots) return
    await page.locator("#host").screenshot({ path: join(shots, name) })
  }
  await shot("reference-host-card.png")
  await app.getByRole("button", { name: "Open experiment" }).click()
  await app.getByRole("tab", { name: "Overview" }).waitFor()
  await shot("reference-host-overview.png")
  await app.getByRole("tab", { name: "Areas" }).click()
  await app.getByRole("heading", { name: "Areas" }).waitFor()
  await shot("reference-host-areas.png")
  await app.getByRole("tab", { name: "Runs" }).click()
  await app.getByRole("button", { name: "Queued", exact: true }).click()
  const runsSubtitle = app.locator("#panel-runs .page-subtitle")
  await runsSubtitle.waitFor()
  const runsCount = await runsSubtitle.innerText()
  if (!/^[1-9]\d* queued of [1-9]\d* runs$/.test(runsCount)) {
    throw new Error(`the runs subtitle was ${JSON.stringify(runsCount)}`)
  }
  await shot("reference-host-runs.png")
  await app.getByRole("button", { name: "All", exact: true }).click()
  await app
    .getByRole("button", { name: /^Run \d+/ })
    .first()
    .click()
  await app.getByRole("navigation", { name: "Opened run" }).waitFor()
  await shot("reference-host-run.png")
  await page.keyboard.press("Escape")
  await app.getByRole("navigation", { name: "Opened run" }).waitFor({ state: "detached" })
  await page.close()
  if (errors.length > 0) throw new Error(errors.join("\n"))
}

function log(message) {
  writeSync(2, `capture: ${message}\n`)
}

/**
 * The app document in `place` once its heading is `name`. A child frame can
 * exist while it is still blank, so this keeps looking until the title is
 * there and logs what the frame is showing until then.
 */
async function titledApp(page, place, name, ms) {
  const until = Date.now() + ms
  let note = "no frame"
  let logged = ""
  while (Date.now() < until) {
    const found = await appDocument(page, place, 1_000)
    if (found) {
      const url = found.app.url()
      const text = await found.app
        .evaluate(() => document.body?.innerText?.slice(0, 300) ?? "")
        .catch((error) => String(error))
      note = `${url} :: ${text.replace(/\s+/g, " ")}`
      const count = await found.app
        .getByRole("heading", { name })
        .count()
        .catch(() => 0)
      if (count > 0) return found
    }
    if (note !== logged) {
      log(`${place}: ${note}`)
      logged = note
    }
    await page.waitForTimeout(500)
  }
  log(`${place} gave up: ${note}`)
  return null
}

/** The app document in `place`: the sandbox proxy's one child frame. */
async function appDocument(page, place, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const element = await page.$(`[data-app-frame="${place}"]`)
    const proxy = element ? await element.contentFrame() : null
    const app = proxy?.childFrames()[0]
    if (app && !app.isDetached()) return { element, app }
    await page.waitForTimeout(200)
  }
  return null
}

function hostText(page, place) {
  return page.evaluate((which) => {
    const node = document.querySelector(`[data-place="${which}"]`)
    return node instanceof HTMLElement ? node.innerText : ""
  }, place)
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.stdin.end()
  const wait = (ms) =>
    new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => resolve(false), ms)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  if (await wait(4_000)) return
  log("gateway stack did not exit; sending SIGTERM")
  child.kill("SIGTERM")
  if (await wait(3_000)) return
  child.kill("SIGKILL")
  await wait(2_000)
}

const driver = `
import { randomUUID } from "node:crypto"
import { readFileSync, writeSync } from "node:fs"
import { resolve } from "node:path"
import { MODELS, startLocalGateway } from "./scripts/mcp-test-server/local-gateway.mjs"
import { freePort, startDevServer } from "./verification/desktop/scripts/lib/server.mjs"
import { register } from "tsx/esm/api"

register()
const { NessaClient } = await import("@nessa/client")

const agent = "claude"
const scenario = process.env.EXPERIMENTS_SCENARIO
const server = process.env.EXPERIMENTS_SERVER
const port = await freePort()
const gateway = await startLocalGateway({
  agent,
  port,
  instance: "experiments-shot",
  agentArgv: [
    process.execPath,
    "--import",
    process.env.EXPERIMENTS_FORWARD_HOOK,
    resolve("scripts/mcp-test-server/scripted-agent.mjs"),
    agent,
    "--scenario",
    scenario,
  ],
  model: MODELS[agent],
  mcpServer: { command: process.execPath, args: [server] },
  signedOut: true,
})
let dev
let client
try {
  dev = await startDevServer(
    {},
    {
      NESSA_STAGE: "ci",
      VITE_NESSA_STAGE: "ci",
      NESSA_BROWSER_GATEWAY_URL: gateway.url,
    },
  )
  const token = readFileSync(gateway.token, "utf8").trim()
  client = await NessaClient.connect({
    stage: "ci",
    url: gateway.url.replace(/^http/, "ws"),
    role: "surface",
    surface: { kind: "panel", instance: "experiments-shot" },
    client: { id: "experiments-shot", version: "0.1.0", platform: "node" },
    profile: "product",
    auth: { credential: token },
  })
  const conversationId = randomUUID()
  await client.conversation.create({ conversationId, agent, approvalMode: "full" })
  writeSync(1, JSON.stringify({ url: dev.url, token }) + "\\n")
  writeSync(2, "driver: ready\\n")
  // The send receipt can stay outstanding after the turn has finished.
  // Screenshots wait on the app; this process waits on the capture's stdin.
  const sent = client.conversation.send(conversationId, "Show the checkout support experiment.")
  sent.catch((error) => writeSync(2, "driver: send " + String(error) + "\\n"))
  await new Promise((resolve) => {
    if (process.stdin.readableEnded) resolve()
    else process.stdin.once("end", resolve)
  })
} finally {
  const force = setTimeout(() => process.exit(0), 8_000)
  try {
    client?.close()
    await dev?.close()
    await gateway.stop()
  } catch (error) {
    writeSync(2, "driver: stop " + String(error) + "\\n")
  }
  clearTimeout(force)
}
`

function startGateway(scenarioPath, serverPath) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", driver], {
    cwd: nessaRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      EXPERIMENTS_SCENARIO: scenarioPath,
      EXPERIMENTS_SERVER: serverPath,
      EXPERIMENTS_FORWARD_HOOK: join(here, "forward-structured.mjs"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let out = ""
  let err = ""
  child.stdout.on("data", (chunk) => {
    out += chunk.toString()
  })
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString()
    err += text
    if (text.includes("driver:")) writeSync(2, text)
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the gateway stack did not become ready\n${err.slice(-4000)}`))
    }, 180_000)
    child.on("exit", (code) => {
      clearTimeout(timer)
      reject(
        new Error(
          `the gateway stack exited ${code}\n${err.slice(-4000)}\n${out.slice(-2000)}`,
        ),
      )
    })
    child.stdout.on("data", () => {
      const line = out.split("\n").find((each) => each.startsWith("{"))
      if (line === undefined) return
      clearTimeout(timer)
      child.removeAllListeners("exit")
      resolve(JSON.parse(line))
    })
  })
  return { child, ready }
}

async function nessaShots(browser) {
  const scenarioPath = join(tmpdir(), "experiments-shot-scenario.json")
  writeFileSync(
    scenarioPath,
    JSON.stringify({
      turns: [
        {
          steps: [
            { do: "text", chunks: ["Showing the checkout support experiment."] },
            {
              do: "tool",
              tool: "show_experiment",
              arguments: { experimentId: "checkout-hillclimb" },
            },
            { do: "end" },
          ],
        },
      ],
    }),
  )
  const stack = startGateway(scenarioPath, join(extension, "dist/main.js"))
  let page
  try {
    log("waiting for the gateway")
    const { url, token } = await stack.ready
    log("gateway ready")
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    })
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(20_000)
    await page.addInitScript(() => {
      const seen = []
      window.__csp = seen
      window.addEventListener("securitypolicyviolation", (event) => {
        seen.push(
          [
            event.blockedURI,
            event.violatedDirective,
            event.effectiveDirective,
            event.sample,
          ]
            .filter((part) => part)
            .join(" "),
        )
      })
    })
    await page.goto(url, { waitUntil: "commit" })
    const status = await page.evaluate(async (owner) => {
      const answer = await fetch("/browser/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Nessa-Browser": "1" },
        body: JSON.stringify({ token: owner }),
      })
      await answer.arrayBuffer()
      return answer.status
    }, token)
    if (status < 200 || status > 299) throw new Error(`sign-in was refused (${status})`)
    log("signed in")
    await page.goto(`${url}?gateway`, { waitUntil: "commit" })
    const inline = await appDocument(page, "inline", 45_000)
    if (!inline) {
      await page
        .screenshot({ path: "/tmp/nessa-fail.png", timeout: 5_000 })
        .catch(() => {})
      const text = await page
        .evaluate(() => document.body?.innerText?.slice(0, 800) ?? "")
        .catch(() => "")
      throw new Error(`the experiment did not appear\n${text}`)
    }
    log("inline frame attached")
    const titled = await titledApp(page, "inline", "Hill-climb checkout support", 45_000)
    if (!titled) {
      await page
        .screenshot({ path: "/tmp/nessa-fail.png", timeout: 5_000 })
        .catch(() => {})
      throw new Error("the experiment title did not appear")
    }
    const cardText = await hostText(page, "inline")
    if (cardText.includes("Blocked a connection")) {
      const frames = page.frames()
      const reported = []
      for (const frame of frames) {
        const rows = await frame.evaluate(() => window.__csp ?? []).catch(() => [])
        if (rows.length > 0) reported.push(rows.join(" | "))
      }
      throw new Error(
        `the page shows a CSP block this app did not cause\n${cardText.slice(0, 400)}\n${reported.join("\n")}`,
      )
    }
    if (cardText.includes("show_fixture") || cardText.includes("kept the experiment")) {
      throw new Error(`the page is not the experiments server: ${cardText.slice(0, 500)}`)
    }
    await page
      .locator('[data-place="inline"]')
      .first()
      .screenshot({
        path: join(shots, "nessa-card.png"),
        timeout: 10_000,
      })
    log("wrote nessa-card.png")
    await titled.app
      .getByRole("button", { name: "Open experiment" })
      .click({ timeout: 10_000 })
    log("asked for the full view")
    const pane = await appDocument(page, "pane", 30_000)
    if (!pane) throw new Error("the full view did not open")
    await pane.app.getByRole("tab", { name: "Overview" }).waitFor({ timeout: 20_000 })
    const paneText = await hostText(page, "pane")
    if (
      paneText.includes("Blocked a connection") ||
      paneText.includes("kept the experiment")
    ) {
      throw new Error("opening the full view showed a false host notice")
    }
    await page
      .locator('[data-place="pane"]')
      .first()
      .screenshot({
        path: join(shots, "nessa-overview.png"),
        timeout: 10_000,
      })
    log("wrote nessa-overview.png")
  } finally {
    if (page) {
      await Promise.race([
        page.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    }
    await stopChild(stack.child)
    rmSync(scenarioPath, { force: true })
  }
}

mkdirSync(shots, { recursive: true })
await build({
  root: extension,
  configFile: join(extension, "vite.config.ts"),
  logLevel: "error",
})
let browser
let safari
let site
try {
  browser = await chromium.launch({ channel: "chrome", headless: true })
  safari = await webkit.launch({ headless: true })
  log("reference host")
  await buildReferenceHost()
  site = await serve(join(hostDir, "dist"))
  await driveReference(browser, site.origin, true)
  log("reference host (webkit)")
  await driveReference(safari, site.origin, false)
  log("nessa")
  await nessaShots(browser)
} catch (error) {
  log(error instanceof Error ? (error.stack ?? error.message) : String(error))
  throw error
} finally {
  site?.close()
  const open = [browser, safari].filter((each) => each !== undefined)
  await Promise.race([
    Promise.all(open.map((each) => each.close().catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ])
  rmSync(join(hostDir, "dist"), { recursive: true, force: true })
}
for (const name of readdirSync(shots)) {
  if (name.startsWith("fake-host-") && name.endsWith(".png")) rmSync(join(shots, name))
}
