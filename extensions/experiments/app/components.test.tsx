// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { nessaUiTokens } from "@nessalabs/app-shell"
import { createBridge } from "@nessalabs/app-shell"
import { memoryChannel } from "@nessalabs/app-shell/fake-host"
import { createFakeHost } from "@nessalabs/app-shell/fake-host"
import { BridgeProvider, HostThemeScope, useConnection } from "@nessalabs/app-shell/react"

import { fixture } from "../model/fixture.ts"
import {
  validateExperiment,
  type Experiment,
  type ExperimentInput,
  type Run,
} from "../model/index.ts"
import { checkoutSample, latencySample, scaleSample } from "../samples/index.ts"
import { ChangeView } from "./change-view.tsx"
import { changeRead } from "./reading.ts"
import { ExperimentPreview } from "./preview.tsx"
import { useChangeView } from "./use-change.ts"
import type { OpenRequest, Schedule } from "./use-open-file.ts"

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
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })

function Connection() {
  const connection = useConnection()
  return <span data-testid="connection">{connection.status}</span>
}

async function renderInHost(node: ReactNode) {
  const channel = memoryChannel()
  const host = createFakeHost({
    transport: channel.host,
    context: { theme: "light", availableDisplayModes: ["inline", "fullscreen"] },
  })
  const bridge = createBridge({
    transport: channel.app,
    app: { name: "experiments", version: "0.0.0" },
    displayModes: ["inline", "fullscreen"],
  })
  const view = render(
    <BridgeProvider bridge={bridge}>
      <HostThemeScope tokens={nessaUiTokens} data-testid="theme">
        <Connection />
        {node}
      </HostThemeScope>
    </BridgeProvider>,
  )
  await act(() => bridge.connect())
  await host.initialized
  await settle()
  return { host, ...view }
}

function textOf(component: string): string {
  return document.querySelector(`[data-component="${component}"]`)?.textContent ?? ""
}

const forbidden = /\b(areas?|splits?|costs?)\b/gi

function ScaleChange({ experiment: subject, run }: { experiment: Experiment; run: Run }) {
  const change = useChangeView({
    experiment: subject,
    run,
    open: async () => ({ kind: "opened" }),
    schedule: quiet,
  })
  if (change === undefined) return null
  return <ChangeView {...change} />
}

describe("the components in the fake host", () => {
  it("draws the checkout hill-climb from its definition", async () => {
    const checkout = experiment(checkoutSample)
    let opened: OpenRequest | undefined
    const { host } = await renderInHost(
      <ExperimentPreview
        experiment={checkout}
        open={async (request) => {
          opened = request
          if (request.path === undefined)
            return { kind: "refused", reason: "Editor declined" }
          return { kind: "opened" }
        }}
        schedule={quiet}
      />,
    )
    expect(screen.getByTestId("connection").textContent).toBe("connected")
    expect(screen.getByTestId("theme").getAttribute("data-nessa-mode")).toBe("light")
    host.changeContext({ theme: "dark" })
    await settle()
    expect(screen.getByTestId("theme").getAttribute("data-nessa-mode")).toBe("dark")

    expect(textOf("climb")).toContain("Resolution rate")
    expect(textOf("climb")).toContain("Test")
    expect(textOf("climb")).toContain("Best model, max effort")
    expect(textOf("climb")).toContain("81.5%")
    expect(document.querySelector(".climb-band")).not.toBeNull()
    expect(document.querySelector(".climb-reference")).not.toBeNull()

    const kept = screen.getAllByRole("button", { name: /#\d+ Kept/ })[0]
    if (kept === undefined) throw new Error("a kept run is on the climb")
    fireEvent.pointerEnter(kept)
    const card = screen.getByRole("tooltip")
    expect(card.textContent).toContain("Kept")
    expect(card.querySelector("[data-slot=delta]")?.getAttribute("data-tone")).toBe(
      "good",
    )
    fireEvent.pointerLeave(kept)

    expect(textOf("areas")).toContain("System prompt")
    expect(textOf("verdicts")).toContain("Kept")
    expect(textOf("verdicts")).toContain("Too costly")
    expect(textOf("cases")).toMatch(/test cases? fixed/)
    expect(textOf("cases")).toMatch(/test cases? broken/)
    expect(screen.getByRole("button", { name: "Open change" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Find a file" })).toBeTruthy()

    const dot = screen.getAllByRole("button", { name: /System prompt #/ })[0]
    if (dot === undefined) throw new Error("a run is on the map")
    fireEvent.pointerEnter(dot)
    expect(screen.getByRole("tooltip").textContent).toContain("System prompt")
    fireEvent.pointerLeave(dot)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    })
    expect(screen.getByRole("status").textContent).toBe("Editor declined")
    expect(opened?.experimentId).toBe(checkout.id)
    expect(opened?.path).toBeUndefined()
  })

  it("draws the latency experiment without an area, a split or a cost", async () => {
    const latency = experiment(latencySample)
    await renderInHost(
      <ExperimentPreview
        experiment={latency}
        open={async () => ({ kind: "opened" })}
        schedule={quiet}
      />,
    )
    const text = document.querySelector(".preview")?.textContent ?? ""
    expect(text.match(forbidden)).toBeNull()
    expect(text).toContain("p95 latency")
    expect(text).toContain("Replayed traffic")
    expect(text).toContain("Faster")
    expect(text).toContain("Slower")
    expect(text).toContain("Measuring")
    expect(text).not.toContain("81.5%")
    expect(document.querySelector(".climb-reference")).toBeNull()
    expect(document.querySelector(".map")).toBeNull()
    expect(document.querySelector(".area")).toBeNull()
    expect(document.querySelector(".cases")).toBeNull()
    expect(screen.queryByRole("button", { name: "#7 Measuring" })).toBeNull()

    const slower = screen.getByRole("button", { name: "#5 Slower" })
    fireEvent.pointerEnter(slower)
    const card = screen.getByRole("tooltip")
    expect(card.textContent).toContain("Slower")
    expect(card.textContent).toMatch(/\d+ ms/)
    expect(card.querySelector("[data-slot=delta]")?.getAttribute("data-tone")).toBe("bad")
    fireEvent.pointerLeave(slower)

    const faster = screen.getByRole("button", { name: "#6 Faster" })
    fireEvent.pointerEnter(faster)
    expect(
      screen
        .getByRole("tooltip")
        .querySelector("[data-slot=delta]")
        ?.getAttribute("data-tone"),
    ).toBe("good")
  })

  it("mounts a window of a ten-thousand-file change, and finds one file in it", async () => {
    const scale = experiment(scaleSample)
    const run = scale.runs[0]
    if (run === undefined) throw new Error("the scale sample has its run")
    const files = changeRead(run)?.files
    const early = files?.[0]
    const mid = files?.[200]
    const later = files?.[400]
    if (early === undefined || mid === undefined || later === undefined) {
      throw new Error("the change has its files")
    }
    await renderInHost(<ScaleChange experiment={scale} run={run} />)

    const paths = () =>
      [...document.querySelectorAll(".change-path")].map((node) => node.textContent)
    const rows = () => document.querySelectorAll(".change-file")
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().length).toBeLessThan(40)
    expect(paths()).toContain(early.path)
    expect(paths()).not.toContain(mid.path)

    const scroller = document.querySelector(".change-scroll")
    const first = rows()[0]
    if (!(scroller instanceof HTMLElement) || !(first instanceof HTMLElement)) {
      throw new Error("the list scrolls")
    }
    const row = Number.parseFloat(first.style.height)
    scroller.scrollTop = row * 200
    fireEvent.scroll(scroller)
    expect(paths()).not.toContain(early.path)
    expect(paths()).toContain(mid.path)
    expect(paths()).not.toContain(later.path)

    fireEvent.change(screen.getByRole("textbox", { name: "Find a file" }), {
      target: { value: later.path },
    })
    expect(rows().length).toBe(1)
    expect(paths()).toEqual([later.path])
  })

  it("clears the file query when another experiment reuses the run id", () => {
    const firstInput = fixture()
    const first = validateExperiment(firstInput)
    if (first.kind !== "valid") throw new Error("the fixture did not validate")
    const secondInput = fixture()
    secondInput.id = "exp-2"
    const changed = secondInput.runs[0]
    if (changed === undefined) throw new Error("the fixture has its run")
    changed.change = {
      summary: "Changes one other file.",
      files: [{ path: "other.ts", status: "modified", added: 1, removed: 0 }],
    }
    const second = validateExperiment(secondInput)
    if (second.kind !== "valid") throw new Error("the second experiment did not validate")
    const runA = first.experiment.runs.find((run) => run.id === "r1")
    const runB = second.experiment.runs.find((run) => run.id === "r1")
    if (runA === undefined || runB === undefined) throw new Error("both runs are r1")

    const { rerender } = render(<ScaleChange experiment={first.experiment} run={runA} />)
    const query = screen.getByRole("textbox", { name: "Find a file" })
    fireEvent.change(query, { target: { value: "a.ts" } })
    expect(
      [...document.querySelectorAll(".change-path")].map((node) => node.textContent),
    ).toEqual(["a.ts"])

    rerender(<ScaleChange experiment={second.experiment} run={runB} />)
    const cleared = screen.getByRole("textbox", { name: "Find a file" })
    if (!(cleared instanceof HTMLInputElement)) throw new Error("the query is a field")
    expect(cleared.value).toBe("")
    expect(
      [...document.querySelectorAll(".change-path")].map((node) => node.textContent),
    ).toEqual(["other.ts"])
  })
})
