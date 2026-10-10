/**
 * One other MCP Apps host: `@modelcontextprotocol/ext-apps`'s `AppBridge`,
 * playing the standard's messages and nothing more. Display mode is whatever
 * the app asked for, of the two this page offers.
 */
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge"

import { appCsp, withPolicy } from "@nessalabs/app-shell/fake-host"

import html from "../../dist/app/index.html?raw"
import { answerCall, experiment, toolResult } from "./calls.ts"

const container = document.getElementById("host")
if (container === null) throw new Error("no #host")

const ready = (async () => {
  const iframe = document.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.setAttribute("title", "MCP App")
  iframe.style.border = "0"
  iframe.style.width = "100%"
  const bridge = new AppBridge(
    null,
    { name: "reference-host", version: "1.0.0" },
    { serverTools: {}, openLinks: {} },
    {
      hostContext: {
        theme: "light",
        displayMode: "inline",
        availableDisplayModes: ["inline", "fullscreen"],
      },
    },
  )
  bridge.oncalltool = async (params) => answerCall(params.name, params.arguments)
  bridge.onrequestdisplaymode = async ({ mode }) => {
    const offered = ["inline", "fullscreen"]
    const chosen = offered.includes(mode) ? mode : "inline"
    bridge.setHostContext({ displayMode: chosen })
    container.style.width = chosen === "fullscreen" ? "960px" : "420px"
    return { mode: chosen }
  }
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined) iframe.style.height = `${height}px`
  }
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve()
  })
  container.append(iframe)
  const target = iframe.contentWindow
  if (target === null) throw new Error("the iframe has no window")
  await bridge.connect(new PostMessageTransport(target, target))
  iframe.srcdoc = withPolicy(html, appCsp())
  await initialized
  await bridge.sendToolInput({ arguments: { experimentId: experiment.id } })
  const payload = JSON.parse(JSON.stringify(experiment)) as Record<string, unknown>
  await bridge.sendToolResult(toolResult(experiment.title, { experiment: payload }))
  iframe.setAttribute("data-ready", "true")
})()

ready.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "the host failed"
  document.body.dataset.hostError = message
})
