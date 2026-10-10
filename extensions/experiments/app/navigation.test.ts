import { describe, expect, it } from "vitest"

import {
  closeRuns,
  followRun,
  navigation,
  openRun,
  popRun,
  selectView,
  trailThrough,
} from "./navigation.ts"

describe("navigation", () => {
  it("opens on the overview, with no run over it", () => {
    expect(navigation()).toEqual({ view: "overview", trail: [] })
  })

  it("keeps the trail when the view changes", () => {
    const opened = openRun(navigation(), "r3")
    expect(selectView(opened, "runs")).toEqual({ view: "runs", trail: ["r3"] })
    expect(selectView(opened, "overview")).toBe(opened)
  })

  it("opens a run as the only one on the trail, and follows another after it", () => {
    const opened = openRun(navigation(), "r3")
    expect(opened.trail).toEqual(["r3"])
    expect(openRun(opened, "r3")).toBe(opened)
    const followed = followRun(opened, "r1")
    expect(followed.trail).toEqual(["r3", "r1"])
    expect(followRun(followed, "r1")).toBe(followed)
  })

  it("pops one run, jumps back along the trail, and closes it", () => {
    const empty = navigation()
    const trail = followRun(openRun(empty, "r3"), "r1")
    expect(popRun(trail).trail).toEqual(["r3"])
    expect(popRun(empty)).toBe(empty)
    expect(trailThrough(trail, 0).trail).toEqual(["r3"])
    expect(trailThrough(trail, 1)).toBe(trail)
    expect(trailThrough(trail, 4)).toBe(trail)
    expect(closeRuns(trail).trail).toEqual([])
    expect(closeRuns(empty)).toBe(empty)
  })
})
