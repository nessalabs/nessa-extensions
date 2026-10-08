import { describe, expect, it } from "vitest"

import { countLabel, formatCount } from "./count.ts"

describe("formatCount", () => {
  it("groups thousands and leaves a small count as it is", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(12)).toBe("12")
    expect(formatCount(999)).toBe("999")
    expect(formatCount(1000)).toBe("1,000")
    expect(formatCount(1_000_000)).toBe("1,000,000")
    expect(formatCount(41_820)).toBe("41,820")
  })

  it("writes a negative with a minus sign", () => {
    expect(formatCount(-1200)).toBe("−1,200")
    expect(formatCount(-1.2)).toBe("−1")
  })

  it("writes zero when a fraction truncates to zero, including negative zero", () => {
    expect(formatCount(-0.4)).toBe("0")
    expect(formatCount(-0)).toBe("0")
  })
})

describe("countLabel", () => {
  const noun = { one: "request", other: "requests" }

  it("uses the singular for one and the plural otherwise", () => {
    expect(countLabel(1, noun)).toBe("1 request")
    expect(countLabel(0, noun)).toBe("0 requests")
    expect(countLabel(18200, noun)).toBe("18,200 requests")
  })

  it("writes the count alone when there is no noun", () => {
    expect(countLabel(3)).toBe("3")
  })
})
