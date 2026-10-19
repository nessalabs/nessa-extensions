/** The fake host forwards app calls to the real extension over the verifier's MCP connection. */
import { mountFakeHostFrame } from "@nessalabs/app-shell/fake-host"
import type { CallToolResult } from "@nessalabs/app-shell"
import html from "../../dist/app/index.html?raw"

const container = document.getElementById("host")
if (container === null) throw new Error("no #host")
const mounted = mountFakeHostFrame({
  container,
  html,
  context: {
    theme: "light",
    displayMode: "inline",
    availableDisplayModes: ["inline", "fullscreen"],
  },
  tool: {
    input: { experimentId: "search-latency-at-scale" },
    outcome: {
      result: {
        content: [
          {
            type: "text",
            text: "Large experiment; read its data through get_experiment.",
          },
        ],
      },
    },
  },
  handlers: {
    callTool: async (request) => {
      const response = await fetch("/call", {
        method: "POST",
        body: JSON.stringify(request),
      })
      if (!response.ok)
        throw new Error(`The verifier refused the call (${response.status}).`)
      return (await response.json()) as CallToolResult
    },
    requestDisplayMode: ({ mode }) => {
      const chosen = mode === "fullscreen" ? "fullscreen" : "inline"
      container.style.width = chosen === "fullscreen" ? "960px" : "420px"
      mounted.host.changeContext({ displayMode: chosen })
      return chosen
    },
  },
})
mounted.host.initialized.catch((error: unknown) => {
  document.body.dataset.hostError =
    error instanceof Error ? error.message : "The host failed."
})
