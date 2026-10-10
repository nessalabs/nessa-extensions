/**
 * The required browser host: `@nessalabs/app-shell`'s fake host, in a
 * sandboxed iframe, playing the standard's messages and nothing more.
 * Display mode is whatever the app asked for, of the two this page offers.
 */
import { mountFakeHostFrame } from "@nessalabs/app-shell/fake-host"

import html from "../../dist/app/index.html?raw"
import { answerCall, experiment, toolResult } from "./calls.ts"

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
    input: { experimentId: experiment.id },
    outcome: {
      result: toolResult(experiment.title, {
        experiment: JSON.parse(JSON.stringify(experiment)) as Record<string, unknown>,
      }),
    },
  },
  handlers: {
    callTool: ({ name, arguments: args }) => answerCall(name, args),
    requestDisplayMode: ({ mode }) => {
      const chosen = mode === "fullscreen" ? "fullscreen" : "inline"
      container.style.width = chosen === "fullscreen" ? "960px" : "420px"
      // The handler runs after `mounted` is assigned: the app asks for a
      // mode when someone opens it, not while this frame is being created.
      mounted.host.changeContext({ displayMode: chosen })
      return chosen
    },
  },
})

const ready = mounted.host.initialized.then(() => {
  mounted.iframe.setAttribute("data-ready", "true")
})

ready.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "the host failed"
  document.body.dataset.hostError = message
})
