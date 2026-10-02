import { describe, expect, it } from "vitest"

import { isId } from "./index.ts"

describe("isId", () => {
  it("holds an id to the rule an experiment's ids are held to", () => {
    for (const id of ["a", "run-1", "A.b_c:d", "9", "x".repeat(128)]) {
      expect(isId(id)).toBe(true)
    }
    for (const id of [
      "",
      " ",
      "-a",
      "a b",
      "a\nb",
      "a/b",
      "__proto__",
      "x".repeat(129),
    ]) {
      expect(isId(id)).toBe(false)
    }
  })
})
