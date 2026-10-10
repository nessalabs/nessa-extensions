// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { flushSync } from "react-dom"
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
  metricChange,
  pathToBest,
  runsNewestFirst,
  scoreOf,
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

function revise(
  sample: Experiment,
  edit: (input: {
    definition: { verdicts: { id: string }[] }
    runs: { id: string; verdict: string }[]
  }) => void,
): Experiment {
  const input = JSON.parse(JSON.stringify(sample)) as {
    definition: { verdicts: { id: string }[] }
    runs: { id: string; verdict: string }[]
  }
  edit(input)
  const result = validateExperiment(input)
  if (result.kind !== "valid") {
    throw new Error(result.problems.map((problem) => problem.message).join("\n"))
  }
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

function findRun(runs: readonly Run[] | undefined, id: unknown): Run | undefined {
  if (typeof id !== "string" || runs === undefined) return undefined
  return runs.find((run) => run.id === id)
}

function copyRun(run: Run): Run {
  return JSON.parse(JSON.stringify(run)) as Run
}

function withTestMean(run: Run, mean: number): Run {
  const copy = copyRun(run)
  const test = copy.scores.test
  if (test === undefined) throw new Error(`${run.id} has no test score`)
  return { ...copy, scores: { ...copy.scores, test: { ...test, mean } } }
}

function deltaLabel(sample: Experiment, from: number, to: number): string {
  const change = metricChange(sample, from, to)
  const sign = change.value > 0 ? "+" : change.value < 0 ? "\u2212" : ""
  return `${sign}${change.size}`
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
    /** When set, this is the whole `list_runs` answer, in this order. */
    readonly listRuns?: readonly Run[]
    /** `get_run` answers these ids from here, ahead of the list and the snapshot. */
    readonly fetchedRuns?: readonly Run[]
    /** `get_experiment`. The default returns `sample`. A promise holds the read. */
    readonly getExperiment?: (
      experimentId: string,
    ) => CallToolResult | Promise<CallToolResult>
  },
) {
  const modes = options?.modes ?? ["inline", "fullscreen"]
  const calls: string[] = []
  const invocations: { name: string; arguments?: Record<string, unknown> }[] = []
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
        invocations.push({ name, ...(args === undefined ? {} : { arguments: args }) })
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
          const runs = (options?.listRuns ?? runsNewestFirst(sample)).map((run) =>
            jsonRun(run),
          )
          if (options?.listedRun !== undefined && options.listRuns === undefined) {
            runs.unshift(jsonRun(options.listedRun))
          }
          return answered("runs", {
            experimentId: sample.id,
            runs,
          })
        }
        if (name === "get_run") {
          const id = args?.runId
          const listedRun = options?.listedRun
          const run =
            findRun(options?.fetchedRuns, id) ??
            findRun(options?.listRuns, id) ??
            (listedRun?.id === id ? listedRun : undefined) ??
            sample.runs.find((each) => each.id === id)
          if (run === undefined || options?.bareRun === true) {
            return answered("run", { experimentId: sample.id, run: { id } })
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
  return { host, calls, invocations, ...view }
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

  it("starts the next experiment at its overview when a run is open", async () => {
    const checkout = experiment(checkoutSample)
    const latency = experiment(latencySample)
    const { host, invocations } = await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    const run = checkout.runs.find((each) => each.settledAt !== undefined)
    if (run === undefined) throw new Error("the sample has a settled run")
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${run.number}(?!\\d)`) }),
    )
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()

    const at = invocations.length
    host.sendToolInput({ experimentId: latency.id })
    await settle()
    host.sendToolResult(
      answered(latency.title, {
        experiment: JSON.parse(JSON.stringify(latency)),
      }),
    )
    await settle()

    expect(screen.getByRole("heading", { name: latency.title })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: checkout.title })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(invocations.slice(at).filter((call) => call.name === "get_run")).toEqual([])
  })

  it("starts clean when the same experiment arrives without the open run's verdict", async () => {
    const checkout = experiment(checkoutSample)
    const run = checkout.runs.find((each) => each.verdict === "queued")
    if (run === undefined) throw new Error("the sample has a queued run")
    const { host, invocations } = await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${run.number}(?!\\d)`) }),
    )
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()

    const next = revise(checkout, (input) => {
      input.definition.verdicts = input.definition.verdicts.filter(
        (verdict) => verdict.id !== "queued",
      )
      for (const each of input.runs) {
        if (each.verdict === "queued") each.verdict = "evaluating"
      }
    })
    const at = invocations.length
    host.sendToolInput({ experimentId: checkout.id })
    await settle()
    host.sendToolResult(
      answered(next.title, { experiment: JSON.parse(JSON.stringify(next)) }),
    )
    await settle()

    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("Unknown")).toBeNull()
    expect(invocations.slice(at).filter((call) => call.name === "get_run")).toEqual([])
  })

  it("starts clean when the same experiment arrives without the open run", async () => {
    const checkout = experiment(checkoutSample)
    const run = checkout.runs.find(
      (each) =>
        each.settledAt !== undefined &&
        !checkout.bestSoFar.includes(each.id) &&
        !checkout.runs.some((other) => other.parentId === each.id) &&
        !checkout.notes.some((note) => note.runId === each.id) &&
        !checkout.agents.some(
          (agent) =>
            agent.activity.kind === "evaluating" && agent.activity.runId === each.id,
        ),
    )
    if (run === undefined) throw new Error("the sample has a run nothing else names")
    const { host, invocations } = await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${run.number}(?!\\d)`) }),
    )
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()
    expect(document.querySelector(".detail")?.textContent).toContain(run.reason)

    const next = revise(checkout, (input) => {
      input.runs = input.runs.filter((each) => each.id !== run.id)
    })
    const at = invocations.length
    host.sendToolInput({ experimentId: checkout.id })
    await settle()
    host.sendToolResult(
      answered(next.title, { experiment: JSON.parse(JSON.stringify(next)) }),
    )
    await settle()

    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(document.querySelector(".detail")).toBeNull()
    expect(invocations.slice(at).filter((call) => call.name === "get_run")).toEqual([])
  })

  it("keeps the open run until get_experiment shows the next experiment, and will not open one while that is pending", async () => {
    const checkout = experiment(checkoutSample)
    const latency = experiment(latencySample)
    const witness = checkout.runs.find(
      (run) => run.id !== "r1" && run.settledAt !== undefined,
    )
    const asked = checkout.runs.find((run) => run.id === "r1")
    if (witness === undefined || asked === undefined) {
      throw new Error("the sample has r1 and another settled run")
    }
    let release: ((result: CallToolResult) => void) | undefined
    const { host, invocations } = await renderApp(checkout, {
      getExperiment: (id) =>
        new Promise((resolve) => {
          if (id !== latency.id) {
            resolve(
              answered(checkout.title, {
                experiment: JSON.parse(JSON.stringify(checkout)),
              }),
            )
            return
          }
          release = resolve
        }),
    })
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${witness.number}(?!\\d)`) }),
    )
    await settle()
    expect(screen.getByRole("navigation", { name: "Opened run" })).toBeTruthy()

    host.sendToolInput({ experimentId: latency.id })
    await settle()
    host.sendToolResult({ content: [{ type: "text", text: latency.title }] })
    await settle()
    // The text result is in hand. The experiment on screen is still checkout,
    // so the revision has not moved and the open run stays.
    expect(screen.getByRole("heading", { name: checkout.title })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: latency.title })).toBeNull()
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      `Run ${witness.number}`,
    )
    expect(invocations.filter((call) => call.name === "get_experiment")).toEqual([
      { name: "get_experiment", arguments: { experimentId: latency.id } },
    ])

    const during = invocations.length
    // The runs list stays mounted under the open run. Opening r1 from it is
    // the repro, and it must not take on the experiment that is about to leave.
    const runs = screen.getByRole("tabpanel", { name: "Runs", hidden: true })
    const pendingRow = within(runs).getByRole("button", {
      name: new RegExp(`^Run ${asked.number}(?!\\d)`),
      hidden: true,
    })
    expect((pendingRow as HTMLButtonElement).disabled).toBe(true)
    expect(runs.textContent).toContain("Loading the next experiment…")
    fireEvent.click(
      within(runs).getByRole("button", {
        name: new RegExp(`^Run ${asked.number}(?!\\d)`),
        hidden: true,
      }),
    )
    await settle()
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      `Run ${witness.number}`,
    )
    expect(invocations.slice(during).filter((call) => call.name === "get_run")).toEqual(
      [],
    )

    const at = invocations.length
    const finish = release
    if (finish === undefined) throw new Error("get_experiment was not waiting")
    finish(
      answered(latency.title, {
        experiment: JSON.parse(JSON.stringify(latency)),
      }),
    )
    await settle()

    expect(screen.getByRole("heading", { name: latency.title })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: checkout.title })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Opened run" })).toBeNull()
    expect(
      screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("true")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("The run is not the one that was asked for.")).toBeNull()
    expect(document.querySelector(".detail")).toBeNull()
    const carried = invocations
      .slice(at)
      .filter(
        (call) =>
          call.name === "get_run" &&
          call.arguments?.experimentId === latency.id &&
          (call.arguments?.runId === "r1" || call.arguments?.runId === witness.id),
      )
    expect(carried).toEqual([])
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

  it("shows the good runs when one listed run is bad, and drops a child of that run", async () => {
    const checkout = experiment(checkoutSample)
    const source = checkout.runs[0]
    if (source === undefined) throw new Error("the sample has a run")
    const bad = {
      ...(JSON.parse(JSON.stringify(source)) as Run),
      id: "r100",
      number: 100,
      verdict: "retired",
      parentId: checkout.baseline.id,
    }
    const child = {
      ...(JSON.parse(JSON.stringify(source)) as Run),
      id: "r101",
      number: 101,
      parentId: "r100",
    }
    await renderApp(checkout, { listRuns: [...checkout.runs, bad, child] })
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()

    const panel = screen.getByRole("tabpanel", { name: "Runs" })
    const rows = within(panel).getAllByRole("button", { name: /^Run / })
    expect(rows).toHaveLength(checkout.runs.length)
    expect(within(panel).queryByRole("button", { name: /^Run 100(?!\d)/ })).toBeNull()
    expect(within(panel).queryByRole("button", { name: /^Run 101(?!\d)/ })).toBeNull()
    expect(screen.getByText("2 runs could not be shown")).toBeTruthy()
    expect(screen.getByText(`${checkout.runs.length} runs`, { exact: true })).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("No runs.")).toBeNull()
  })

  it("a new child of a new parent shows a delta and a two-step lineage", async () => {
    const checkout = experiment(checkoutSample)
    const child = checkout.runs.find((run) => {
      const parent = checkout.runs.find((each) => each.id === run.parentId)
      return (
        parent !== undefined &&
        scoreOf(run, "test") !== undefined &&
        scoreOf(parent, "test") !== undefined
      )
    })
    const parent = checkout.runs.find((run) => run.id === child?.parentId)
    const childMean = child === undefined ? undefined : scoreOf(child, "test")?.mean
    const parentMean = parent === undefined ? undefined : scoreOf(parent, "test")?.mean
    if (
      child === undefined ||
      parent === undefined ||
      childMean === undefined ||
      parentMean === undefined
    ) {
      throw new Error("the sample has a scored child of a scored run")
    }
    const template = copyRun(child)
    const addedParent = withTestMean(
      {
        ...template,
        id: "r100",
        number: 100,
        parentId: checkout.baseline.id,
        reason: "A parent the opening snapshot never had.",
      },
      70,
    )
    const addedChild = withTestMean(
      {
        ...template,
        id: "r101",
        number: 101,
        parentId: addedParent.id,
        reason: "Built on the new parent.",
      },
      80,
    )
    const listed = [
      addedChild,
      addedParent,
      ...checkout.runs.map((run) =>
        run.id === parent.id ? withTestMean(run, 10) : copyRun(run),
      ),
    ]
    await renderApp(checkout, { listRuns: listed })
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()

    const stale = deltaLabel(checkout, parentMean, childMean)
    const refreshed = deltaLabel(checkout, 10, childMean)
    expect(stale).not.toBe(refreshed)
    const existing = screen.getByRole("button", {
      name: new RegExp(`^Run ${child.number}(?!\\d)`),
    })
    expect(existing.querySelector("[data-slot=delta]")?.textContent).toBe(refreshed)

    const added = screen.getByRole("button", { name: /^Run 101(?!\d)/ })
    expect(added.querySelector("[data-slot=delta]")?.textContent).toBe("+10.0 pts")
    fireEvent.click(added)
    await settle()
    const region = screen.getByRole("region", { name: "Lineage" })
    expect(
      within(region)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Baseline", "Run 100", "Run 101"])
    const detail = document.querySelector(".detail")
    expect(detail?.querySelector("[data-slot=delta]")?.textContent).toBe("+10.0 pts")
    expect(detail?.textContent).toContain("Built on the new parent.")
  })

  it("draws the run get_run returned through the accepted set", async () => {
    const checkout = experiment(checkoutSample)
    const template = checkout.runs.find((run) => run.cases !== undefined)
    if (template === undefined) throw new Error("the sample has a run with cases")
    const addedParent = withTestMean(
      {
        ...copyRun(template),
        id: "r100",
        number: 100,
        parentId: checkout.baseline.id,
        reason: "A parent the opening snapshot never had.",
      },
      70,
    )
    const listedChild = withTestMean(
      {
        ...copyRun(template),
        id: "r101",
        number: 101,
        parentId: addedParent.id,
        reason: "Listed child.",
      },
      80,
    )
    const cases = listedChild.cases
    if (cases === undefined) throw new Error("the child has cases")
    const fetchedChild = {
      ...withTestMean(listedChild, 90),
      reason: "Fetched from the server.",
      cases: { ...cases, total: 5000, fixed: 4242, broken: cases.broken },
    }
    const { calls } = await renderApp(checkout, {
      listRuns: [listedChild, addedParent, ...checkout.runs.map(copyRun)],
      fetchedRuns: [fetchedChild],
    })
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    const row = screen.getByRole("button", { name: /^Run 101(?!\d)/ })
    expect(row.querySelector("[data-slot=delta]")?.textContent).toBe("+10.0 pts")
    expect(row.textContent).toContain("Listed child.")

    fireEvent.click(row)
    await settle()
    expect(calls).toContain("get_run")
    const detail = document.querySelector(".detail")
    expect(detail?.querySelector("[data-slot=delta]")?.textContent).toBe("+20.0 pts")
    expect(detail?.textContent).toContain("Fetched from the server.")
    expect(detail?.textContent).not.toContain("Listed child.")
    expect(detail?.textContent).toContain("4,242 test cases fixed")
    expect(screen.getByRole("navigation", { name: "Opened run" }).textContent).toContain(
      "Run 101",
    )
  })

  it("shows the next run loading in the same frame the previous one closes", async () => {
    const checkout = experiment(checkoutSample)
    const opened = checkout.runs.find((run) => {
      const line = lineage(checkout, run.id)
      return line !== undefined && line.runs.length >= 2 && run.reason.length > 0
    })
    if (opened === undefined) throw new Error("no run has a parent run")
    const line = lineage(checkout, opened.id)
    const earlier = line?.runs[0]
    if (line === undefined || earlier === undefined || earlier.id === opened.id) {
      throw new Error("the run has an earlier run")
    }
    await renderApp(checkout)
    await openFullscreen()
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }))
    await settle()
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^Run ${opened.number}(?!\\d)`) }),
    )
    await settle()
    const detail = () => document.querySelector(".detail")
    expect(detail()?.textContent).toContain(opened.reason)

    const follow = within(screen.getByRole("region", { name: "Lineage" })).getByRole(
      "button",
      { name: new RegExp(`^Run ${earlier.number}$`) },
    )
    flushSync(() => {
      follow.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(detail()?.textContent).not.toContain(opened.reason)
    expect(detail()?.textContent).toContain("Loading this run…")
    await settle()
    expect(detail()?.textContent).toContain(earlier.reason)
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
