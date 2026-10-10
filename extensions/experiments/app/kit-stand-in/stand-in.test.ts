/**
 * The files under `src/` are nessa_ui at
 * e02b577a74ed99ba05c8bfba58c8984b881c3a69, byte for byte. A change to one
 * of them, or a file added or removed, fails here. `index.ts` and
 * `stand-in.css` are this app's seam and are not part of the pin.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const src = join(dirname(fileURLToPath(import.meta.url)), "src")

/** sha256 of each pinned file, from `git show e02b577a74ed99ba05c8bfba58c8984b881c3a69`. */
const pinned = {
  "components/chart-tooltip.tsx":
    "6be11d191c359b6ab24c69aa288ee2e4c0de060834465bb44269fbd93fdebdf2",
  "components/delta.tsx":
    "c17a74ed315e5a6660511c973ce848dd0f7c8ad0f495c8d2c692c19d337bd273",
  "components/meter.tsx":
    "4dbe36bc33f39012330e12e24ca88fe1ab7ec88e31ed71db633fe619c59b1f0b",
  "components/popover-surface.tsx":
    "f4f660a0eeb27ae1e5a948a601bde2b9330a0eaddd4bf21ff0a0b8c8cff70f47",
  "components/proportion-bar.tsx":
    "0a88a111d0294863e76fa115aa9480d03d1f7b98c564fae8ff5fb08d35ad6c07",
  "components/stat.tsx":
    "e35c153bd53b27221fce73af24bd6db3ceac9af4bbb4c0a76cfc59eab5922e77",
  "components/status-label.tsx":
    "de7b6466f01f6341307dd9d4f62c3455b4d9e917914d67a3561731d9e3b6a29e",
  "components/virtual-list.tsx":
    "7644e7d4737a738158ed0d9a44bf08c7df2aa9ce5aa9e6e387a0a27db835e345",
  "lib/chart-geometry.ts":
    "d9834ff03272cd9341f36d24918517762fa98b569d622f8bfcb53ee0671359e1",
  "lib/compose.ts": "eff0fae3db5e465407f11e7c626beb77d5415a10dace51d82e4b2e0cf3dad454",
  "lib/utils.ts": "d541160d6f7ed3e9ae509beaad92d31b0e54d81fae6703a8db26073bc38d0870",
} as const

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return entry.isFile() ? [relative(src, path)] : []
  })
}

describe("the kit stand-in copies", () => {
  it("match nessa_ui e02b577a byte for byte", () => {
    const present = filesUnder(src).sort()
    expect(present).toEqual(Object.keys(pinned).sort())
    for (const [file, hash] of Object.entries(pinned)) {
      const bytes = readFileSync(join(src, file))
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(hash)
    }
  })
})
