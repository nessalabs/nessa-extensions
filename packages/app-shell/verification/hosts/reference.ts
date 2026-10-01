/**
 * A third-party host for the fixture app: the MCP Apps reference SDK's
 * `AppBridge` and `PostMessageTransport` (`@modelcontextprotocol/ext-apps`),
 * none of this package's host code in the protocol. The iframe is made as
 * any host makes one — sandboxed, under the standard's policy — since the
 * SDK leaves that to the host.
 */
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge"

import { appCsp, withPolicy } from "../../src/fake-host/index.ts"

declare global {
  interface Window {
    startReferenceHost(): Promise<void>
    referenceBridge: AppBridge
    calls: unknown[]
  }
}

window.startReferenceHost = async () => {
  const html = await (await fetch("../app/index.html")).text()
  const container = document.getElementById("host")
  if (container === null) throw new Error("no #host")
  const iframe = document.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.style.border = "0"
  iframe.style.width = "100%"
  window.calls = []
  const bridge = new AppBridge(
    null,
    { name: "reference-host", version: "1.0.0" },
    { serverTools: {}, openLinks: {} },
    {
      hostContext: {
        theme: "light",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        styles: {
          variables: { "--color-background-primary": "rgb(240, 248, 255)" } as never,
        },
      },
    },
  )
  bridge.oncalltool = async (params) => {
    window.calls.push(params)
    return {
      content: [{ type: "text", text: "refreshed" }],
      structuredContent: { temperature: 4 },
    }
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
  window.referenceBridge = bridge
  await initialized
}
