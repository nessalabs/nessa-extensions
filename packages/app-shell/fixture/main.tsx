/**
 * The fixture app: an MCP App built on the app shell the way an extension's
 * is, used to verify the shell in real browsers and real hosts. It shows the
 * connection, the tool call, and the host's theme through nessa_ui's tokens,
 * and offers one button per request, each showing the host's answer or
 * refusal.
 */
import { useState } from "react"

import { BridgeError, nessaUiTokens, type DisplayMode } from "../src/index.ts"
import {
  mountApp,
  useBridge,
  useConnection,
  useDisplayMode,
  HostThemeScope,
  useTeardown,
  useToolCall,
} from "../src/react/index.ts"

function outcome(error: unknown): string {
  return error instanceof BridgeError ? `refused: ${error.failure.kind}` : "failed"
}

function Fixture() {
  const bridge = useBridge()
  const connection = useConnection()
  const call = useToolCall()
  const { mode, request } = useDisplayMode()
  const [answer, setAnswer] = useState("none yet")
  const [tornDown, setTornDown] = useState<string | null>(null)
  useTeardown((reason) => setTornDown(reason ?? "no reason"))

  const run = (label: string, action: () => Promise<unknown>) => () => {
    setAnswer(`${label}: waiting`)
    action().then(
      (value) => setAnswer(`${label}: ${JSON.stringify(value ?? "ok")}`),
      (error: unknown) => setAnswer(`${label}: ${outcome(error)}`),
    )
  }

  const input = "input" in call ? call.input : undefined
  const result = call.phase === "complete" ? call.result.structuredContent : undefined
  return (
    <main className="card" data-testid="card">
      <h1>Weather</h1>
      <p data-testid="status">{connection.status}</p>
      <p data-testid="phase">{call.phase}</p>
      <p data-testid="city">
        {typeof input?.city === "string" ? input.city : "no city yet"}
      </p>
      <p data-testid="result">
        {result === undefined ? "no result yet" : JSON.stringify(result)}
      </p>
      <p className="muted" data-testid="mode">
        {mode ?? "no mode"}
      </p>
      <div>
        <button
          onClick={run("refresh", () => bridge.callTool("refresh", { city: "Oslo" }))}
        >
          Refresh
        </button>
        <button
          onClick={run("fullscreen", () => request("fullscreen" satisfies DisplayMode))}
        >
          Fullscreen
        </button>
        <button
          onClick={run("link", () => bridge.openLink("https://example.com/forecast"))}
        >
          Open forecast
        </button>
        <button
          onClick={run("message", () =>
            bridge.sendMessage([{ type: "text", text: "Tell me more about Oslo" }]),
          )}
        >
          Ask
        </button>
      </div>
      <p
        className={answer.includes("refused") ? "refusal" : "muted"}
        data-testid="answer"
      >
        {answer}
      </p>
      <p data-testid="teardown">{tornDown ?? "not torn down"}</p>
    </main>
  )
}

const root = document.getElementById("root")
if (root !== null) {
  mountApp(
    root,
    <HostThemeScope tokens={nessaUiTokens}>
      <Fixture />
    </HostThemeScope>,
    {
      app: { name: "app-shell-fixture", version: "0.0.0" },
      displayModes: ["inline", "fullscreen"],
    },
  )
}
