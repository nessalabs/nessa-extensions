import { describe, expect, it } from "vitest"

import type { Metric } from "./definition.ts"
import {
  changeBetween,
  formatSize,
  productOf,
  formatValue,
  type Change,
  type Formatted,
} from "./metric.ts"

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
const dollars: Metric = {
  id: "cost",
  name: "Cost",
  unit: "$",
  position: "before",
  better: "down",
  decimals: 2,
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

  it("rounds halves away from zero, small and large, and digits a double writes with an exponent", () => {
    const whole = { ...latency, unit: "" }
    expect(formatValue(whole, 2.5)).toBe("3")
    expect(formatValue(whole, -2.5)).toBe("\u22123")
    expect(formatValue({ ...whole, decimals: 1 }, 0.05)).toBe("0.1")
    expect(formatValue({ ...whole, decimals: 2 }, 123456789.125)).toBe("123456789.13")
    // String(5e-7) is "5e-7"; String(1e-7) is "1e-7".
    expect(formatValue({ ...whole, decimals: 6 }, 5e-7)).toBe("0.000001")
    expect(formatValue({ ...whole, decimals: 6 }, 1e-7)).toBe("0.000000")
    expect(formatValue({ ...whole, decimals: 6 }, -1e-7)).toBe("0.000000")
  })

  it("writes the largest values a definition allows in plain digits", () => {
    expect(formatValue(latency, 1e15)).toBe("1000000000000000 ms")
    expect(formatValue({ ...percent, decimals: 10 }, 1e-7)).toBe("0.0000001000%")
  })

  it("writes an empty unit as nothing", () => {
    expect(formatValue({ ...percent, unit: "" }, 2)).toBe("2.0")
  })

  it("writes the unit before the number when the metric says so, and after when it does not", () => {
    expect(formatValue(dollars, 0.05)).toBe("$0.05")
    expect(formatValue({ ...dollars, position: "after" }, 0.05)).toBe("0.05$")
    const { position: _position, ...absent } = dollars
    expect(formatValue(absent, 0.05)).toBe("0.05$")
    expect(formatValue({ ...percent, position: "after" }, 71.64)).toBe("71.6%")
  })

  it("writes a minus before a leading unit, and writes zero with no minus", () => {
    expect(formatValue(dollars, -0.05)).toBe("\u2212$0.05")
    expect(formatValue(dollars, 0)).toBe("$0.00")
    expect(formatValue(dollars, -0)).toBe("$0.00")
    expect(formatValue(dollars, -0.001)).toBe("$0.00")
    expect(formatValue({ ...dollars, decimals: 0 }, 0)).toBe("$0")
    expect(formatValue({ ...dollars, unit: "", position: "before" }, -2)).toBe(
      "\u22122.00",
    )
  })

  it("keeps the unit's own spacing on either side, and adds none", () => {
    expect(formatValue({ ...dollars, unit: "$ " }, 0.05)).toBe("$ 0.05")
    expect(formatValue({ ...dollars, unit: "$ " }, -0.05)).toBe("\u2212$ 0.05")
    expect(formatValue({ ...dollars, unit: " $", position: "after" }, 0.05)).toBe(
      "0.05 $",
    )
    expect(formatValue({ ...dollars, unit: " $", position: "after" }, -0.05)).toBe(
      "\u22120.05 $",
    )
  })

  it("keeps the precision rules when the unit is written first", () => {
    const one = { ...dollars, decimals: 1 }
    expect(formatValue(one, 0.35)).toBe("$0.4")
    expect(formatValue(one, 0.25)).toBe("$0.3")
    expect(formatValue(one, 0.15)).toBe("$0.2")
    expect(formatValue(one, -0.35)).toBe("\u2212$0.4")
    expect(formatValue(dollars, 1.005)).toBe("$1.01")
    expect(formatValue({ ...dollars, decimals: 0 }, 2.5)).toBe("$3")
    expect(formatValue({ ...dollars, decimals: 0 }, -2.5)).toBe("\u2212$3")
    expect(formatValue({ ...dollars, decimals: 6 }, 5e-7)).toBe("$0.000001")
    expect(formatValue({ ...dollars, decimals: 6 }, 1e-7)).toBe("$0.000000")
    expect(formatValue({ ...dollars, decimals: 6 }, -1e-7)).toBe("$0.000000")
    expect(formatValue(dollars, 1e15)).toBe("$1000000000000000.00")
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

  it("writes its size on the side the unit is written, with no sign", () => {
    expect(changeBetween(dollars, 1, 1.2).size).toBe("$0.20")
    expect(changeBetween(dollars, 1.2, 1)).toEqual({
      value: -0.2,
      size: "$0.20",
      tone: "good",
    })
    expect(changeBetween({ ...dollars, deltaUnit: "$" }, 0, 0.5).size).toBe("$0.50")
    expect(changeBetween({ ...dollars, position: "after" }, 0, 0.5).size).toBe("0.50$")
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

  it("is exact at any size the definition allows, past what a double holds", () => {
    const fine = { ...percent, decimals: 10 }
    expect(formatValue(fine, 598173.4644613)).toBe("598173.4644613000%")
    expect(changeBetween(fine, 466000, 598173.4644613).size).toBe("132173.4644613000 pts")
    const coarse = { ...percent, decimals: 3 }
    expect(changeBetween(coarse, 87020800000000, 81172513580495.73)).toEqual({
      value: -5848286419504.27,
      size: "5848286419504.270 pts",
      tone: "bad",
    })
  })

  it("reads the noise as it is written, so a change written as the noise is within it", () => {
    // A noise of 0.15 is written 0.2; a change written 0.2 is within it.
    expect(formatSize(percent, 0.15)).toBe("0.2 pts")
    expect(changeBetween(percent, 50, 50.2, 0.15).tone).toBe("neutral")
    expect(changeBetween(percent, 50, 50.3, 0.15).tone).toBe("good")
    // At no decimals, 0.5 is written 1.
    const whole = { ...percent, decimals: 0 }
    expect(formatSize(whole, 0.5)).toBe("1 pts")
    expect(changeBetween(whole, 0, 1, 0.5).tone).toBe("neutral")
    expect(changeBetween(whole, 0, -2, 0.5).tone).toBe("bad")
  })

  it("carries no binary remainder", () => {
    expect(changeBetween(percent, 0.1, 0.4).value).toBe(0.3)
  })

  it("is frozen", () => {
    expect(Object.isFrozen(changeBetween(percent, 0, 1))).toBe(true)
  })
})

describe("formatSize", () => {
  it("writes a size in the delta unit, with no sign", () => {
    expect(formatSize(percent, 1.24)).toBe("1.2 pts")
    expect(formatSize(percent, -1.24)).toBe("1.2 pts")
    expect(formatSize(latency, 15)).toBe("15 ms")
    expect(formatSize(percent, 0.35)).toBe("0.4 pts")
  })

  it("writes a size on the side the unit is written, the unit's spacing kept", () => {
    expect(formatSize(dollars, 0.2)).toBe("$0.20")
    expect(formatSize(dollars, -0.2)).toBe("$0.20")
    expect(formatSize({ ...dollars, deltaUnit: "USD " }, 1.5)).toBe("USD 1.50")
    expect(formatSize({ ...dollars, position: "after" }, 0.2)).toBe("0.20$")
  })
})

describe("productOf", () => {
  it("multiplies the two decimals exactly, and writes the product", () => {
    const cents = { ...percent, unit: "¢", decimals: 2 }
    expect(productOf(cents, 1.05, 1.9)).toEqual({ value: 1.995, formatted: "2.00¢" })
    expect(productOf(cents, 1.05, 5.1)).toEqual({ value: 5.355, formatted: "5.36¢" })
    expect(productOf(cents, 0.9, -12.7)).toEqual({
      value: -11.43,
      formatted: "\u221211.43¢",
    })
    expect(productOf(cents, 1e15, 1e15)).toEqual({
      value: 1e30,
      formatted: "1000000000000000000000000000000.00¢",
    })
    expect(productOf(cents, 1e-7, 3)).toEqual({ value: 3e-7, formatted: "0.00¢" })
  })

  it("writes a leading unit on the product, through the one formatter", () => {
    expect(productOf(dollars, 1.05, 1.9)).toEqual({ value: 1.995, formatted: "$2.00" })
    expect(productOf(dollars, 0.9, -0.05)).toEqual({
      value: -0.045,
      formatted: "\u2212$0.05",
    })
  })

  it("writes the value it gives, so a view writing it again agrees", () => {
    // The exact product, 4.144999999999999171, has more digits than a number
    // holds; the nearest number is 4.145, written 4.15.
    const cents = { ...percent, unit: "¢", decimals: 2 }
    const limit = productOf(cents, 0.9999999999999998, 4.145)
    expect(limit).toEqual({ value: 4.145, formatted: "4.15¢" })
    expect(formatValue(cents, limit.value)).toBe(limit.formatted)
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
