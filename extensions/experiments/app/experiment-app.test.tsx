// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  createBridge,
  nessaUiTokens,
  type CallToolResult,
  type HostCapabilities,
} from "@nessalabs/app-shell"
import {
  createFakeHost,
  memoryChannel,
  type FakeHost,
} from "@nessalabs/app-shell/fake-host"
import { BridgeProvider, HostThemeScope } from "@nessalabs/app-shell/react"

import {
  lineage,
  pathToBest,
  runsNewestFirst,
  validateExperiment,
  type Experiment,
  type ExperimentInput,
  type Run,
} from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
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

function jsonRun(run: Run, reason?: string): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(run)) as Record<string, unknown>
  if (reason !== undefined) copy.reason = reason
  return copy
}

async function renderApp(
  sample: Experiment,
  options?: {
    readonly modes?: ("inline" | "fullscreen")[]
    readonly opening?: CallToolResult
    readonly result?: CallToolResult
    readonly holdFullscreen?: boolean
    /** Replaces every `get_run` body's reason, so a test can see the body was drawn. */
    readonly runReason?: string
    readonly capabilities?: HostCapabilities
    /** `get_run` answers `{ id }` only, which is not a run. */
    readonly bareRun?: boolean
    /** A run `list_runs` adds in front of the opening snapshot's runs. */
    readonly listedRun?: Run
    /** `get_experiment`. The default returns `sample`. */
    readonly getExperiment?: (experimentId: string) => CallToolResult
  },
) {
  const modes = options?.modes ?? ["inline", "fullscreen"]
  const calls: string[] = []
  const channel = memoryChannel()
  const host = createFakeHost({
    transport: channel.host,
    ...(options?.capabilities === undefined
      ? {}
      : { capabilities: options.capabilities }),
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
        if (name === "get_experiment") {
          const id =
            typeof args?.experimentId === "string" ? args.experimentId : sample.id
          return (
            options?.getExperiment?.(id) ??
            answered(sample.title, {
              experiment: JSON.parse(JSON.stringify(sample)),
            })
          )
        }
        if (name === "list_runs") {
          const runs = runsNewestFirst(sample).map((run) => jsonRun(run))
          if (options?.listedRun !== undefined) runs.unshift(jsonRun(options.listedRun))
          return answered("runs", {
            experimentId: sample.id,
            runs,
          })
        }
        if (name === "get_run") {
          const run = sample.runs.find((each) => each.id === args?.runId)
          if (run === undefined || options?.bareRun === true) {
            return answered("run", { experimentId: sample.id, run: { id: args?.runId } })
          }
          return answered("run", {
            experimentId: sample.id,
            run: jsonRun(run, options?.runReason),
          })
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
        <ExperimentApp schedule={quiet} />
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
    const { host, calls } = await renderApp(checkout)
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(calls).not.toContain("get_experiment")
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
    expect(screen.getByRole("status").textContent).toBe(
      "This host doesn't offer a full view.",
    )
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()

    cleanup()
    const held = await renderApp(checkout, { holdFullscreen: true })
    await openFullscreen()
    expect(held.host.context.displayMode).toBe("inline")
    expect(screen.queryByText(/kept the experiment/)).toBeNull()
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()
    expect(screen.getByRole("button", { name: "Open experiment" })).toBeTruthy()
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
    const linked = await renderApp(checkout, {
      opening: answered("link", {
        opening: { kind: "link", url: "https://example.com/change" },
      }),
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(linked.host.links).toEqual(["https://example.com/change"])

    cleanup()
    const blocked = await renderApp(checkout, {
      opening: answered("link", {
        opening: { kind: "link", url: "javascript:alert(1)" },
      }),
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(blocked.host.links).toEqual([])
    expect(screen.getByText("Couldn't open this.")).toBeTruthy()

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
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(screen.getByText("This view can't download a file.")).toBeTruthy()
    expect(downloaded.host.links).toEqual([])

    cleanup()
    const noLinks = await renderApp(checkout, {
      capabilities: { serverTools: {} },
      opening: answered("link", {
        opening: { kind: "link", url: "https://example.com/change" },
      }),
    })
    await openFullscreen()
    fireEvent.click(screen.getAllByRole("button", { name: /^Run \d+/ })[0]!)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await settle()
    expect(noLinks.host.links).toEqual([])
    expect(screen.getByText("This host doesn't open links.")).toBeTruthy()
  })

  it("reads a run once across open, back, and open, and not while the card is showing", async () => {
    const checkout = experiment(checkoutSample)
    const { calls } = await renderApp(checkout)
    expect(calls).toEqual([])

    await openFullscreen()
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    expect(calls).toEqual(["list_runs"])
    fireEvent.click(screen.getByRole("button", { name: "Show the experiment inline" }))
    await settle()
    expect(calls).toEqual(["list_runs"])
    await openFullscreen()
    expect(calls).toEqual(["list_runs"])

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }))
    const pathList = screen.getByRole("list", { name: "Path to the best" })
    fireEvent.click(within(pathList).getAllByRole("button")[0]!)
    await settle()
    expect(calls).toEqual(["list_runs", "get_run"])
    expect(screen.queryByText("Loading this run…")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show the experiment inline" }))
    await settle()
    expect(calls).toEqual(["list_runs", "get_run"])
    expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull()

    await openFullscreen()
    expect(calls).toEqual(["list_runs", "get_run"])
    expect(screen.queryByText("Loading this run…")).toBeNull()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
  })

  it("draws the reason get_run returned, not the opening snapshot's", async () => {
    const checkout = experiment(checkoutSample)
    const run = pathToBest(checkout)[0]?.run
    if (run === undefined) throw new Error("the path has a run")
    await renderApp(checkout, { runReason: "Fresh from the server." })
    await openFullscreen()
    const pathList = screen.getByRole("list", { name: "Path to the best" })
    fireEvent.click(within(pathList).getAllByRole("button")[0]!)
    await settle()
    expect(screen.getByText("Fresh from the server.")).toBeTruthy()
    expect(screen.queryByText(run.reason)).toBeNull()

    cleanup()
    await renderApp(checkout, { bareRun: true })
    await openFullscreen()
    const again = screen.getByRole("list", { name: "Path to the best" })
    fireEvent.click(within(again).getAllByRole("button")[0]!)
    await settle()
    expect(screen.getByRole("alert").textContent).toMatch(/not valid|invalid|expected/i)
    expect(screen.queryByText(run.reason)).toBeNull()
  })

  it("Escape walks back one run at a time", async () => {
    const checkout = experiment(checkoutSample)
    const opened = checkout.runs.find((run) => {
      const line = lineage(checkout, run.id)
      return line !== undefined && line.runs.length >= 3
    })
    if (opened === undefined) throw new Error("no run has two ancestors")
    const line = lineage(checkout, opened.id)
    if (line === undefined) throw new Error("the run has a lineage")
    const earliest = line.runs[0]
    const middle = line.runs[1]
    if (earliest === undefined || middle === undefined) throw new Error("two ancestors")

    await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${opened.number}(?!\\d)`) }),
    )
    await settle()

    const follow = (number: number) => {
      const region = screen.getByRole("region", { name: "Lineage" })
      fireEvent.click(
        within(region).getByRole("button", { name: new RegExp(`^Run ${number}$`) }),
      )
    }
    follow(middle.number)
    await settle()
    follow(earliest.number)
    await settle()
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      `Run ${earliest.number}`,
    )

    fireEvent.keyDown(document, { key: "Escape" })
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      `Run ${middle.number}`,
    )

    fireEvent.keyDown(document, { key: "Escape" })
    await settle()
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      `Run ${opened.number}`,
    )

    fireEvent.keyDown(document, { key: "Escape" })
    await settle()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
  })

  it("loads the experiment with get_experiment when the opening result has none", async () => {
    const checkout = experiment(checkoutSample)
    const { calls } = await renderApp(checkout, {
      result: { content: [{ type: "text", text: checkout.title }] },
    })
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(calls.filter((name) => name === "get_experiment")).toEqual(["get_experiment"])
  })

  it("reads get_experiment again when a later opening result for the same id has none", async () => {
    const checkout = experiment(checkoutSample)
    const absent = (): CallToolResult => ({
      content: [{ type: "text", text: checkout.title }],
    })
    const { host, calls } = await renderApp(checkout, { result: absent() })
    expect(calls.filter((name) => name === "get_experiment")).toEqual(["get_experiment"])

    host.sendToolInput({ experimentId: checkout.id })
    await settle()
    host.sendToolResult(absent())
    await settle()
    expect(calls.filter((name) => name === "get_experiment")).toEqual([
      "get_experiment",
      "get_experiment",
    ])
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
  })

  it("shows the experiment that was asked for again after another experiment failed", async () => {
    const checkout = experiment(checkoutSample)
    const latency = experiment(latencySample)
    const absent = (title: string): CallToolResult => ({
      content: [{ type: "text", text: title }],
    })
    const { host, calls } = await renderApp(checkout, {
      result: absent(checkout.title),
      getExperiment(id) {
        if (id === latency.id) return answered("Latency failed.", {}, true)
        return answered(checkout.title, {
          experiment: JSON.parse(JSON.stringify(checkout)),
        })
      },
    })
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()

    host.sendToolInput({ experimentId: latency.id })
    await settle()
    host.sendToolResult(absent(latency.title))
    await settle()
    expect(screen.getByRole("alert").textContent).toContain("Latency failed.")

    host.sendToolInput({ experimentId: checkout.id })
    await settle()
    expect(screen.queryByText("Latency failed.")).toBeNull()
    host.sendToolResult(absent(checkout.title))
    await settle()
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(screen.queryByText("Latency failed.")).toBeNull()
    expect(calls.filter((name) => name === "get_experiment")).toEqual([
      "get_experiment",
      "get_experiment",
      "get_experiment",
    ])
  })

  it("refuses a recovered experiment whose id is not the one requested", async () => {
    const checkout = experiment(checkoutSample)
    const latency = experiment(latencySample)
    await renderApp(checkout, {
      result: { content: [{ type: "text", text: checkout.title }] },
      getExperiment: () =>
        answered(latency.title, {
          experiment: JSON.parse(JSON.stringify(latency)),
        }),
    })
    expect(screen.getByRole("alert").textContent).toBe(
      "The result is for a different experiment.",
    )
    expect(screen.queryByRole("heading", { name: latency.title })).toBeNull()
    expect(screen.queryByRole("heading", { name: checkout.title })).toBeNull()
  })

  it("counts the runs list_runs returned, not the opening snapshot", async () => {
    const checkout = experiment(checkoutSample)
    const source = checkout.runs[0]
    if (source === undefined) throw new Error("the sample has a run")
    const extra = {
      ...(JSON.parse(JSON.stringify(source)) as Run),
      id: "r100",
      number: 100,
    }
    await renderApp(checkout, { listedRun: extra })
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    const subtitle = screen.getByText(`${checkout.runs.length + 1} runs`, { exact: true })
    expect(subtitle.className).toContain("page-subtitle")
    expect(screen.queryByText(`${checkout.runs.length} runs`, { exact: true })).toBeNull()

    const filters = screen.getByRole("group", { name: "Filter by verdict" })
    fireEvent.click(within(filters).getByRole("button", { name: "Kept" }))
    const kept = [extra, ...checkout.runs].filter((run) => run.verdict === "kept").length
    expect(
      screen.getByText(`${kept} kept of ${checkout.runs.length + 1} runs`, {
        exact: true,
      }),
    ).toBeTruthy()
  })

  it("Escape in Find a file clears the query and leaves the run open", async () => {
    const checkout = experiment(checkoutSample)
    const opened = checkout.runs.find((run) => (run.change?.files.length ?? 0) > 0)
    if (opened === undefined) throw new Error("no run has a file")
    await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${opened.number}(?!\\d)`) }),
    )
    await settle()
    const field = screen.getByRole("textbox", { name: "Find a file" })
    fireEvent.change(field, { target: { value: "policy" } })
    expect((field as HTMLInputElement).value).toBe("policy")
    fireEvent.keyDown(field, { key: "Escape" })
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
    expect(
      (screen.getByRole("textbox", { name: "Find a file" }) as HTMLInputElement).value,
    ).toBe("")
  })
})
