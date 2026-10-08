// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import type { Opening } from "./open-file.ts"
import { useOpenFile, type Schedule } from "./use-open-file.ts"

afterEach(cleanup)

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((succeed, fail) => {
    resolve = succeed
    reject = fail
  })
  return { promise, resolve, reject }
}

function clock() {
  let pending: (() => void)[] = []
  const schedule: Schedule = {
    after(_ms, run) {
      pending.push(run)
      return () => {
        pending = pending.filter((each) => each !== run)
      }
    },
  }
  return {
    schedule,
    pending: () => pending.length,
    fire() {
      const runs = pending
      pending = []
      for (const run of runs) run()
    },
  }
}

function Probe({
  experimentId,
  runId,
  open,
  schedule,
}: {
  experimentId: string
  runId: string
  open: () => Promise<Opening>
  schedule: Schedule
}) {
  const file = useOpenFile({ experimentId, runId, open, schedule })
  const path = "search/src/a.go"
  const shown = file.shown({ kind: "file", path })
  const change = file.shown({ kind: "change" })
  return (
    <div>
      <button type="button" onClick={() => file.click({ kind: "file", path })}>
        Open file
      </button>
      <button type="button" onClick={() => file.click({ kind: "change" })}>
        Open change
      </button>
      <span data-testid="file">{shown.status}</span>
      <span data-testid="reason">{shown.status === "refused" ? shown.reason : ""}</span>
      <span data-testid="change">{change.status}</span>
      <span data-testid="change-reason">
        {change.status === "refused" ? change.reason : ""}
      </span>
    </div>
  )
}

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

describe("useOpenFile", () => {
  it("shows nothing while the request is open, then the refusal, then nothing after four seconds", async () => {
    const pending = defer<Opening>()
    const time = clock()
    render(
      <Probe
        experimentId="search-latency"
        runId="l5"
        open={() => pending.promise}
        schedule={time.schedule}
      />,
    )
    expect(screen.getByTestId("file").textContent).toBe("idle")
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(screen.getByTestId("file").textContent).toBe("asked")
    expect(screen.getByTestId("reason").textContent).toBe("")

    pending.resolve({ kind: "refused", reason: "No editor" })
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("refused")
    expect(screen.getByTestId("reason").textContent).toBe("No editor")

    act(() => time.fire())
    expect(screen.getByTestId("file").textContent).toBe("idle")
    expect(screen.getByTestId("reason").textContent).toBe("")
  })

  it("ignores an earlier answer, and a refusal that was replaced by a click", async () => {
    const first = defer<Opening>()
    const second = defer<Opening>()
    const third = defer<Opening>()
    const answers = [first, second, third]
    const time = clock()
    render(
      <Probe
        experimentId="search-latency"
        runId="l5"
        open={() => answers.shift()?.promise ?? Promise.resolve({ kind: "opened" })}
        schedule={time.schedule}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    first.resolve({ kind: "refused", reason: "Stale" })
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("asked")
    expect(screen.getByTestId("reason").textContent).toBe("")

    second.resolve({ kind: "refused", reason: "Busy" })
    await flush()
    expect(screen.getByTestId("reason").textContent).toBe("Busy")
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(screen.getByTestId("file").textContent).toBe("asked")
    act(() => time.fire())
    expect(screen.getByTestId("file").textContent).toBe("asked")
  })

  it("shows a sentence when the port rejects, and leaves the other target alone", async () => {
    const time = clock()
    render(
      <Probe
        experimentId="search-latency"
        runId="l5"
        open={() => Promise.reject(new Error("down"))}
        schedule={time.schedule}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    await flush()
    expect(screen.getByTestId("reason").textContent).toBe("Couldn't open this.")
    expect(screen.getByTestId("change").textContent).toBe("idle")
    fireEvent.click(screen.getByRole("button", { name: "Open change" }))
    await flush()
    expect(screen.getByTestId("change-reason").textContent).toBe("Couldn't open this.")
    expect(screen.getByTestId("reason").textContent).toBe("Couldn't open this.")
  })

  it("drops an answer that arrives after the run has changed", async () => {
    const pending = defer<Opening>()
    const time = clock()
    const props = {
      experimentId: "search-latency",
      open: () => pending.promise,
      schedule: time.schedule,
    }
    const view = render(<Probe {...props} runId="l5" />)
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(screen.getByTestId("file").textContent).toBe("asked")
    view.rerender(<Probe {...props} runId="l6" />)
    expect(screen.getByTestId("file").textContent).toBe("idle")
    pending.resolve({ kind: "refused", reason: "Stale" })
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("idle")
    expect(screen.getByTestId("reason").textContent).toBe("")
  })

  it("accepts a later answer after StrictMode re-runs the effect", async () => {
    const first = defer<Opening>()
    const second = defer<Opening>()
    const answers = [first, second]
    const time = clock()
    render(
      <StrictMode>
        <Probe
          experimentId="search-latency"
          runId="l5"
          open={() => answers.shift()?.promise ?? Promise.resolve({ kind: "opened" })}
          schedule={time.schedule}
        />
      </StrictMode>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(screen.getByTestId("file").textContent).toBe("asked")
    first.resolve({ kind: "opened" })
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("idle")

    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    expect(screen.getByTestId("file").textContent).toBe("asked")
    second.resolve({ kind: "refused", reason: "No editor" })
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("refused")
    expect(screen.getByTestId("reason").textContent).toBe("No editor")
  })

  it("cancels a refusal timer when the control unmounts", async () => {
    const time = clock()
    const view = render(
      <Probe
        experimentId="search-latency"
        runId="l5"
        open={() => Promise.resolve({ kind: "refused", reason: "No editor" })}
        schedule={time.schedule}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open file" }))
    await flush()
    expect(screen.getByTestId("file").textContent).toBe("refused")
    expect(time.pending()).toBe(1)
    view.unmount()
    expect(time.pending()).toBe(0)
  })
})
