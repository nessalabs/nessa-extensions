import { describe, expect, it } from "vitest"

import type { Metric } from "./definition.ts"
import { changeBetween, formatValue, type Change, type Formatted } from "./metric.ts"

const percent: Metric = {
  id: "resolution",
  name: "Resolution rate",
  unit: "%",
  deltaUnit: " pts",
  better: "up",
  decimals: 1,
}
const latency: Metric = {
  id: "p95",
  name: "p95 latency",
  unit: " ms",
  better: "down",
  decimals: 0,
}

describe("formatValue", () => {
  it("writes the value to the metric's decimals, then its unit as given", () => {
    expect(formatValue(percent, 71.64)).toBe("71.6%")
    expect(formatValue(percent, 71.65)).toBe("71.7%")
    expect(formatValue(latency, 412.4)).toBe("412 ms")
    expect(formatValue({ ...latency, decimals: 3 }, 0.052)).toBe("0.052 ms")
  })

  it("writes a negative with a minus sign, and never −0", () => {
    expect(formatValue(percent, -3.46)).toBe("−3.5%")
    expect(formatValue(percent, -0.04)).toBe("0.0%")
    expect(formatValue(latency, -0)).toBe("0 ms")
  })

  it("rounds half away from zero on the decimal the number reads as", () => {
    // toFixed would write 0.3, 0.1 and 1.00: it rounds the binary double.
    expect(formatValue(percent, 0.35)).toBe("0.4%")
    expect(formatValue(percent, 0.15)).toBe("0.2%")
    expect(formatValue(percent, 0.25)).toBe("0.3%")
    expect(formatValue(percent, -0.35)).toBe("\u22120.4%")
    expect(formatValue({ ...percent, decimals: 2 }, 1.005)).toBe("1.01%")
  })

  it("writes the largest values a definition allows in plain digits", () => {
    expect(formatValue(latency, 1e15)).toBe("1000000000000000 ms")
    expect(formatValue({ ...percent, decimals: 10 }, 1e-7)).toBe("0.0000001000%")
  })

  it("writes an empty unit as nothing", () => {
    expect(formatValue({ ...percent, unit: "" }, 2)).toBe("2.0")
  })
})

describe("changeBetween", () => {
  it("is good when it moves the way the metric is better, and bad when it does not", () => {
    expect(changeBetween(percent, 0, 1.84)).toEqual({
      value: 1.8,
      size: "1.8 pts",
      tone: "good",
    })
    expect(changeBetween(percent, 0, -1.84)).toEqual({
      value: -1.8,
      size: "1.8 pts",
      tone: "bad",
    })
    expect(changeBetween(latency, 0, -40.2)).toEqual({
      value: -40,
      size: "40 ms",
      tone: "good",
    })
    expect(changeBetween(latency, 0, 40.2)).toEqual({
      value: 40,
      size: "40 ms",
      tone: "bad",
    })
  })

  it("writes its size in the delta unit, or the unit when there is none", () => {
    expect(changeBetween(percent, 0, 2).size).toBe("2.0 pts")
    expect(changeBetween({ ...percent, deltaUnit: undefined }, 0, 2).size).toBe("2.0%")
  })

  it("is neutral within the noise, the noise included, and not beyond it", () => {
    expect(changeBetween(percent, 0, 0.5, 0.5).tone).toBe("neutral")
    expect(changeBetween(percent, 0, -0.5, 0.5).tone).toBe("neutral")
    expect(changeBetween(percent, 0, 0.6, 0.5).tone).toBe("good")
    expect(changeBetween(percent, 0, -0.6, 0.5).tone).toBe("bad")
    expect(changeBetween(latency, 0, -15, 15).tone).toBe("neutral")
    expect(changeBetween(latency, 0, -16, 15).tone).toBe("good")
  })

  it("reads the noise against the change as written, so what is shown and its tone agree", () => {
    // 0.54 is written 0.5: within a noise of 0.5.
    expect(changeBetween(percent, 0, 0.54, 0.5)).toEqual({
      value: 0.5,
      size: "0.5 pts",
      tone: "neutral",
    })
  })

  it("is neutral, and 0, when it rounds to nothing, with no noise", () => {
    expect(changeBetween(percent, 0, 0.04)).toEqual({
      value: 0,
      size: "0.0 pts",
      tone: "neutral",
    })
    const negative = changeBetween(percent, 0, -0.04)
    expect(Object.is(negative.value, -0)).toBe(false)
    expect(negative.tone).toBe("neutral")
  })

  it("is the difference of the two values as they are written, so it agrees with them", () => {
    // Written 50.0% and 50.2%: a change of 0.2, not the raw 0.12 rounded to 0.1.
    expect(formatValue(percent, 50.04)).toBe("50.0%")
    expect(formatValue(percent, 50.16)).toBe("50.2%")
    expect(changeBetween(percent, 50.04, 50.16)).toEqual({
      value: 0.2,
      size: "0.2 pts",
      tone: "good",
    })
    // Written 50.0% and 50.6%: past a noise of 0.5, though the raw 0.52 is not.
    expect(changeBetween(percent, 50.04, 50.56, 0.5).tone).toBe("good")
  })

  it("carries no binary remainder", () => {
    expect(changeBetween(percent, 0.1, 0.4).value).toBe(0.3)
  })

  it("is frozen", () => {
    expect(Object.isFrozen(changeBetween(percent, 0, 1))).toBe(true)
  })
})

describe("the brands", () => {
  it("are made here and nowhere else", () => {
    // @ts-expect-error A string is not Formatted: only formatValue makes one.
    const text: Formatted = "71.6%"
    // @ts-expect-error A template literal is not Formatted either.
    const template: Formatted = `${71.6}%`
    // @ts-expect-error An object of the right shape is not a Change: only changeBetween makes one.
    const made: Change = { value: 1, size: formatValue(percent, 1), tone: "good" }
    // @ts-expect-error A spread copy of a Change is not one.
    const spread: Change = { ...changeBetween(percent, 0, 1), tone: "bad" }
    const formatted: string = formatValue(percent, 1)
    expect([text, template, made, spread, formatted]).toHaveLength(5)
  })
})
