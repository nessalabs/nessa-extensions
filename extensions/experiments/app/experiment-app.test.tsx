// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { createBridge, nessaUiTokens, type CallToolResult } from "@nessalabs/app-shell"
import {
  createFakeHost,
  memoryChannel,
  type FakeHost,
} from "@nessalabs/app-shell/fake-host"
import { BridgeProvider, HostThemeScope } from "@nessalabs/app-shell/react"

import {
  pathToBest,
  runsNewestFirst,
  validateExperiment,
  type Experiment,
  type ExperimentInput,
} from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
import type { DownloadFile } from "./download.ts"
import { ExperimentApp } from "./experiment-app.tsx"
import type { Schedule } from "./use-open-file.ts"

afterEach(cleanup)

const begun = Date.UTC(2026, 9, 1, 9)
const quiet: Schedule = { after: () => () => {} }

function experiment(sample: (startedAt: number) => ExperimentInput): Experiment {
  const result = validateExperiment(sample(begun))
  if (result.kind !== "valid") throw new Error("the sample did not validate")
  return result.experiment
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

function answered(
  text: string,
  data: Record<string, unknown>,
  isError = false,
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  }
}

function displayModeRequests(host: FakeHost): number {
  return host.log.filter((entry) => {
    const message = entry.message
    return (
      entry.direction === "app-to-host" &&
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      message.method === "ui/request-display-mode"
    )
  }).length
}

async function renderApp(
  sample: Experiment,
  options?: {
    readonly modes?: ("inline" | "fullscreen")[]
    readonly save?: (file: DownloadFile) => void
    readonly opening?: CallToolResult
    readonly result?: CallToolResult
    readonly holdFullscreen?: boolean
  },
) {
  const modes = options?.modes ?? ["inline", "fullscreen"]
  const calls: string[] = []
  const channel = memoryChannel()
  const host = createFakeHost({
    transport: channel.host,
    context: {
      theme: "light",
      displayMode: "inline",
      availableDisplayModes: modes,
    },
    tool: {
      input: { experimentId: sample.id },
      outcome: {
        result:
          options?.result ??
          answered(sample.title, { experiment: JSON.parse(JSON.stringify(sample)) }),
      },
    },
    handlers: {
      callTool: ({ name, arguments: args }) => {
        calls.push(name)
        if (name === "list_runs") {
          return answered("runs", {
            experimentId: sample.id,
            runs: runsNewestFirst(sample).map((run) => ({ id: run.id })),
          })
        }
        if (name === "get_run") {
          const runId = args?.runId
          return answered("run", { experimentId: sample.id, run: { id: runId } })
        }
        if (name === "open_file") {
          return (
            options?.opening ??
            answered("opening", {
              opening: { kind: "unavailable", reason: "No file here." },
            })
          )
        }
        return answered("Unknown tool.", {}, true)
      },
      ...(options?.holdFullscreen === true
        ? { requestDisplayMode: () => "inline" as const }
        : {}),
    },
  })
  const bridge = createBridge({
    transport: channel.app,
    app: { name: "experiments", version: "0.0.0" },
    displayModes: ["inline", "fullscreen"],
  })
  const view = render(
    <BridgeProvider bridge={bridge}>
      <HostThemeScope tokens={nessaUiTokens} data-testid="theme">
        <ExperimentApp save={options?.save} schedule={quiet} />
      </HostThemeScope>
    </BridgeProvider>,
  )
  await act(() => bridge.connect())
  await host.initialized
  await settle()
  return { host, calls, ...view }
}

async function openFullscreen() {
  fireEvent.click(screen.getByRole("button", { name: "Open experiment" }))
  await settle()
}

describe("the experiment app in the fake host", () => {
  it("opens the checkout experiment from the card into the full view, and Escape walks the trail", async () => {
    const checkout = experiment(checkoutSample)
    const { host } = await renderApp(checkout)
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(screen.getByRole("img", { name: "Best so far" })).toBeTruthy()
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()
    expect(host.app?.capabilities.availableDisplayModes).toEqual(["inline", "fullscreen"])

    await openFullscreen()
    expect(displayModeRequests(host)).toBe(1)
    expect(host.context.displayMode).toBe("fullscreen")
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Areas" })).toBeTruthy()
    expect(screen.getByText("Resolution rate · Test")).toBeTruthy()

    const path = pathToBest(checkout).map((step) => `Run ${step.run.number}`)
    const pathList = screen.getByRole("list", { name: "Path to the best" })
    const pathButtons = within(pathList).getAllByRole("button")
    expect(
      pathButtons.map((button) => button.textContent?.match(/Run \d+/)?.[0]),
    ).toEqual(path)

    const first = pathButtons[0]
    if (first === undefined) throw new Error("the path has a run")
    fireEvent.click(first)
    await settle()
    expect(
      host.log.some((entry) => JSON.stringify(entry.message).includes("get_run")),
    ).toBe(true)
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
    expect(document.activeElement).toBe(document.querySelector(".detail-focus"))

    fireEvent.keyDown(document, { key: "Escape" })
    await settle()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
    expect(document.activeElement).toBe(document.querySelector(".surface"))
    expect(displayModeRequests(host)).toBe(1)

    const overviewTab = screen.getByRole("tab", { name: "Overview" })
    overviewTab.focus()
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" })
    const areasTab = screen.getByRole("tab", { name: "Areas" })
    expect(areasTab.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(areasTab)
    fireEvent.keyDown(areasTab, { key: "Home" })
    expect(overviewTab.getAttribute("aria-selected")).toBe("true")

    fireEvent.click(screen.getByRole("tab", { name: "Areas" }))
    const dot = screen.getAllByRole("button", { name: /#\d+/ })[0]
    if (dot === undefined) throw new Error("the map has a run")
    fireEvent.click(dot)
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })
    await settle()

    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    expect(
      host.log.some((entry) => JSON.stringify(entry.message).includes("list_runs")),
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Queued" }))
    const queued = screen.getAllByRole("button", { name: /Run \d+/ })
    expect(queued.length).toBeGreaterThan(0)
    expect(queued.every((button) => button.textContent?.includes("Queued"))).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "All" }))
    const row = screen.getAllByRole("button", { name: /^Run \d+/ })[0]
    if (row === undefined) throw new Error("the list has a run")
    fireEvent.click(row)
    await settle()
    const follow = screen.getAllByRole("button", { name: /^Run \d+$/ })[0]
    if (follow !== undefined) {
      fireEvent.click(follow)
      await settle()
      fireEvent.keyDown(document, { key: "Escape" })
      await settle()
    }
    fireEvent.keyDown(document, { key: "Escape" })
    await settle()
    expect(document.activeElement).toBe(document.querySelector(".surface"))
  })

  it("omits areas for a latency experiment, and a regression reads as bad", async () => {
    const latency = experiment(latencySample)
    await renderApp(latency)
    await openFullscreen()
    expect(screen.queryByRole("tab", { name: "Areas" })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Swarm" })).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(screen.getByRole("button", { name: /Run 5/ }))
    await settle()
    const delta = document.querySelector(".detail [data-slot=delta]")
    expect(delta?.getAttribute("data-tone")).toBe("bad")
    expect(screen.getByText("Answer accuracy")).toBeTruthy()
  })

  it("shows a refusal when fullscreen is not offered, and when the host keeps inline", async () => {
    const checkout = experiment(checkoutSample)
    const refused = await renderApp(checkout, { modes: ["inline"] })
    fireEvent.click(screen.getByRole("button", { name: "Open experiment" }))
    await settle()
    expect(displayModeRequests(refused.host)).toBe(0)
    expect(screen.getByRole("status").textContent).toMatch(/fullscreen/)
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()

    cleanup()
    const held = await renderApp(checkout, { holdFullscreen: true })
    await openFullscreen()
    expect(held.host.context.displayMode).toBe("inline")
    expect(screen.getByRole("status").textContent).toMatch(/inline/)
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()
  })

  it("shows a tool error and a cancellation instead of an experiment", async () => {
    const checkout = experiment(checkoutSample)
    await renderApp(checkout, { result: answered("No such experiment.", {}, true) })
    expect(screen.getByRole("alert").textContent).toBe("No such experiment.")

    cleanup()
    const channel = memoryChannel()
    const host = createFakeHost({
      transport: channel.host,
      context: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
      tool: { input: { experimentId: checkout.id } },
    })
    const bridge = createBridge({
      transport: channel.app,
      app: { name: "experiments", version: "0.0.0" },
      displayModes: ["inline", "fullscreen"],
    })
    render(
      <BridgeProvider bridge={bridge}>
        <HostThemeScope tokens={nessaUiTokens}>
          <ExperimentApp schedule={quiet} />
        </HostThemeScope>
      </BridgeProvider>,
    )
    await act(() => bridge.connect())
    await host.initialized
    await settle()
    expect(screen.getByText("Loading the experiment…")).toBeTruthy()
    host.cancelTool("Stopped.")
    await settle()
    expect(screen.getByText("Stopped.")).toBeTruthy()
  })

  it("opens a link through the host and refuses one that is not http", async () => {
    const checkout = experiment(checkoutSample)
    const save = (file: DownloadFile) => {
      saved = file
    }
    let saved: DownloadFile | undefined
    const linked = await renderApp(checkout, {
      opening: answered("link", {
        opening: { kind: "link", url: "https://example.com/change" },
      }),
      save,
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(linked.host.links).toEqual(["https://example.com/change"])

    cleanup()
    saved = undefined
    const blocked = await renderApp(checkout, {
      opening: answered("link", {
        opening: { kind: "link", url: "javascript:alert(1)" },
      }),
      save,
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(blocked.host.links).toEqual([])
    expect(screen.getByText("Couldn't open this.")).toBeTruthy()
    expect(saved).toBeUndefined()

    cleanup()
    const downloaded = await renderApp(checkout, {
      opening: answered("file", {
        opening: {
          kind: "download",
          name: "change.diff",
          mimeType: "text/plain",
          text: "diff",
        },
      }),
      save,
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(saved).toEqual({ name: "change.diff", mimeType: "text/plain", text: "diff" })
    expect(downloaded.host.links).toEqual([])
  })
})
