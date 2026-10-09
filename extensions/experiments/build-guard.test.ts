/**
 * The experiments build, through this package's Vite config. `mcpApp`'s
 * public-directory guard has to run here: a wrapper that drops
 * `configResolved` leaves the directory unset and a file in `public/` is
 * copied into `dist`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "vite"
import { describe, expect, it } from "vitest"

const root = dirname(fileURLToPath(import.meta.url))

describe("the experiments build", () => {
  it("refuses a file in public/", async () => {
    const dir = join(root, "public")
    const stray = join(dir, "stray.txt")
    mkdirSync(dir, { recursive: true })
    writeFileSync(stray, "nope")
    try {
      await expect(
        build({
          root,
          configFile: join(root, "vite.config.ts"),
          logLevel: "silent",
        }),
      ).rejects.toThrow(/has files, which Vite copies beside the app/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(join(root, "dist", "stray.txt"), { force: true })
    }
  })
})
