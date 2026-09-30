import { describe, expect, it } from "vitest"

import * as entry from "./index.ts"

describe("@nessalabs/app-shell", () => {
  // Nothing is exported until #2 designs the surface. This fails the moment
  // something is, so the export arrives with tests of its own rather than
  // under this one.
  it("exports nothing yet", () => {
    expect(Object.keys(entry)).toEqual([])
  })
})
