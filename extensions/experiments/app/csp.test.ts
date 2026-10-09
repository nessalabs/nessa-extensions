import { describe, expect, it } from "vitest"
import { config } from "zod/v4"

import "./csp.ts"

describe("csp", () => {
  it("turns zod's eval probe off before a schema is built", () => {
    expect(config().jitless).toBe(true)
  })
})
