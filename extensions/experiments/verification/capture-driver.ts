/** The real-host child program capture.mjs runs from the pinned host checkout. */
export const captureDriver = `
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
    { isolateCache: true },
    {
      NODE_ENV: "development",
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
  const sent = client.conversation.submit(
    client.conversation.prepare(conversationId, "Show the checkout support experiment."),
  )
  sent.catch((error) => writeSync(2, "driver: send " + String(error) + "\\n"))
  process.stdin.resume()
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
