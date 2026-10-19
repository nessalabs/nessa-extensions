import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, it } from "vitest"

import { captureDriver } from "./capture-driver.ts"

it("submits a prepared capture turn and closes while its receipt is still pending", async () => {
  const root = mkdtempSync(join(tmpdir(), "experiments-capture-driver-"))
  const events = join(root, "events.jsonl")
  const record = `
import { appendFileSync } from "node:fs"
const event = (name) => appendFileSync(${JSON.stringify(events)}, name + "\\n")
`
  const put = (path: string, text: string) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  put("package.json", JSON.stringify({ type: "module" }))
  put("owner.token", "test-only-owner")
  put(
    "scripts/mcp-test-server/local-gateway.mjs",
    `${record}
export const MODELS = { claude: "test-model" }
export async function startLocalGateway(options) {
  if (!options.signedOut) throw new Error("the capture must be signed out")
  event("gateway:start")
  return {
    url: "http://127.0.0.1:1", token: ${JSON.stringify(join(root, "owner.token"))},
    stop: async () => event("gateway:stop"),
  }
}
`,
  )
  put(
    "verification/desktop/scripts/lib/server.mjs",
    `${record}
export const freePort = async () => 1
export async function startDevServer(options, env) {
  if (options.isolateCache !== true) throw new Error("capture must own its cache")
  if (env.NODE_ENV !== "development") throw new Error("capture needs the development runtime")
  event("dev:start")
  return { url: "http://127.0.0.1:2", close: async () => event("dev:close") }
}
`,
  )
  put(
    "node_modules/tsx/package.json",
    JSON.stringify({ type: "module", exports: { "./esm/api": "./api.js" } }),
  )
  put("node_modules/tsx/api.js", "export function register() {}\n")
  put(
    "node_modules/@nessa/client/package.json",
    JSON.stringify({ type: "module", exports: "./index.js" }),
  )
  put(
    "node_modules/@nessa/client/index.js",
    `${record}
export const NessaClient = {
  async connect() {
    event("client:connect")
    let prepared
    return {
      conversation: {
        async create() { event("conversation:create") },
        prepare(conversationId, text) {
          event("conversation:prepare")
          prepared = Object.freeze({ conversationId, text, identity: Symbol() })
          return prepared
        },
        submit(value) {
          if (value !== prepared) throw new Error("submit must use the prepared identity")
          event("conversation:submit")
          process.stdout.write("submitted\\n")
          return new Promise(() => {})
        },
      },
      close() { event("client:close") },
    }
  },
}
`,
  )

  const child = spawn(process.execPath, ["--input-type=module", "-e", captureDriver], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      EXPERIMENTS_SCENARIO: join(root, "scenario.json"),
      EXPERIMENTS_SERVER: join(root, "server.mjs"),
      EXPERIMENTS_FORWARD_HOOK: join(root, "hook.mjs"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let output = ""
  let errors = ""
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  const submitted = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk)
      if (output.includes("\nsubmitted\n")) resolve()
    })
    child.stderr.on("data", (chunk) => {
      errors += String(chunk)
    })
    child.once("close", () => reject(new Error(`No submission: ${errors}`)))
    child.once("error", reject)
  })
  try {
    await submitted
    expect(child.exitCode).toBeNull()
    child.stdin.end()
    expect(await exit, errors).toBe(0)
    expect(readFileSync(events, "utf8").trim().split("\n")).toEqual([
      "gateway:start",
      "dev:start",
      "client:connect",
      "conversation:create",
      "conversation:prepare",
      "conversation:submit",
      "client:close",
      "dev:close",
      "gateway:stop",
    ])
  } finally {
    child.stdin.end()
    if (child.exitCode === null) child.kill()
    await exit.catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
