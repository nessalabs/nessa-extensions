import { describe, expect, it } from "vitest"

import {
  answer,
  click,
  elapsed,
  openFileMachine,
  shown,
  type Opening,
  type Target,
} from "./open-file.ts"

const file: Target = { kind: "file", path: "search/src/planner.go" }
const change: Target = { kind: "change" }
const opened: Opening = { kind: "opened" }
const refused: Opening = { kind: "refused", reason: "No answer from the editor" }

describe("opening a file", () => {
  it("goes from idle to asked on a click, and shows nothing new", () => {
    const machine = openFileMachine()
    expect(shown(machine, file)).toEqual({ status: "idle" })
    const next = click(machine, file)
    expect(shown(next.machine, file)).toEqual({ status: "asked" })
    expect(next.request).toBe(1)
  })

  it("keeps the target asked for the new request when it is clicked again", () => {
    const first = click(openFileMachine(), file)
    const second = click(first.machine, file)
    expect(second.request).toBe(first.request + 1)
    expect(shown(second.machine, file)).toEqual({ status: "asked" })
    const afterOld = answer(second.machine, file, first.request, refused)
    expect(afterOld).toBe(second.machine)
    expect(shown(afterOld, file)).toEqual({ status: "asked" })
  })

  it("returns to idle when the latest request opens", () => {
    const asked = click(openFileMachine(), file)
    const next = answer(asked.machine, file, asked.request, opened)
    expect(shown(next, file)).toEqual({ status: "idle" })
  })

  it("shows the refusal when the latest request is refused", () => {
    const asked = click(openFileMachine(), file)
    const next = answer(asked.machine, file, asked.request, refused)
    expect(shown(next, file)).toEqual({
      status: "refused",
      reason: "No answer from the editor",
    })
  })

  it("lets an earlier request's answer go while the target is asked", () => {
    const first = click(openFileMachine(), file)
    const second = click(first.machine, file)
    expect(answer(second.machine, file, first.request, opened)).toBe(second.machine)
  })

  it("lets an earlier request's answer go once the target is idle", () => {
    const asked = click(openFileMachine(), file)
    const idle = answer(asked.machine, file, asked.request, opened)
    const stale = asked.request
    expect(answer(idle, file, stale, refused)).toBe(idle)
    expect(shown(idle, file)).toEqual({ status: "idle" })
  })

  it("lets an earlier request's answer go while the refusal is showing", () => {
    const first = click(openFileMachine(), file)
    const second = click(first.machine, file)
    const refusal = answer(second.machine, file, second.request, refused)
    expect(answer(refusal, file, first.request, opened)).toBe(refusal)
    expect(shown(refusal, file).status).toBe("refused")
  })

  it("clears the refusal when its four seconds pass", () => {
    const asked = click(openFileMachine(), file)
    const refusal = answer(asked.machine, file, asked.request, refused)
    const next = elapsed(refusal, file, asked.request)
    expect(shown(next, file)).toEqual({ status: "idle" })
  })

  it("clears the refusal and asks again when the control is clicked", () => {
    const asked = click(openFileMachine(), file)
    const refusal = answer(asked.machine, file, asked.request, refused)
    const again = click(refusal, file)
    expect(shown(again.machine, file)).toEqual({ status: "asked" })
    expect(elapsed(again.machine, file, asked.request)).toBe(again.machine)
  })

  it("keeps a file's request apart from the whole-change control", () => {
    const fileClick = click(openFileMachine(), file)
    const changeClick = click(fileClick.machine, change)
    const fileRefused = answer(changeClick.machine, file, fileClick.request, refused)
    expect(shown(fileRefused, file).status).toBe("refused")
    expect(shown(fileRefused, change)).toEqual({ status: "asked" })
  })
})
