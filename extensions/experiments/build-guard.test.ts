/**
 * The experiments build, through this package's Vite config. `mcpApp`'s
 * public-directory guard has to run here: a wrapper that drops
 * `configResolved` leaves the directory unset and a file in `public/` is
 * copied into `dist`.
 *
 * `pnpm build` uses `createBuilder`. That build writes the server first and
 * empties `dist`, so a test that runs it can delete `dist/app/index.html`
 * while another test is reading it. This one builds only the client, into
 * its own directory. `build()` from Vite is the other entry and builds a
 * single environment, skipping `buildApp`, so it does not stand in for the
 * package build.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createBuilder } from "vite"
import { describe, expect, it } from "vitest"

const root = dirname(fileURLToPath(import.meta.url))

function mtime(path: string): number | null {
  return existsSync(path) ? statSync(path).mtimeMs : null
}

describe("the experiments build", () => {
  it("refuses a file in public/ and leaves the shared dist alone", async () => {
    const dir = join(root, "public")
    const stray = join(dir, "stray.txt")
    const shared = join(root, "dist", "app", "index.html")
    const canary = join(root, "dist", "build-guard-canary.txt")
    const outDir = mkdtempSync(join(tmpdir(), "experiments-build-"))
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(root, "dist"), { recursive: true })
    writeFileSync(stray, "nope")
    writeFileSync(canary, "keep")
    const before = mtime(shared)
    const canaryBefore = mtime(canary)
    try {
      const builder = await createBuilder({
        root,
        configFile: join(root, "vite.config.ts"),
        logLevel: "silent",
        environments: {
          client: {
            build: { outDir, emptyOutDir: true },
          },
        },
        builder: {
          async buildApp(built) {
            const client = built.environments.client
            if (client === undefined) {
              throw new Error("the experiments build needs its client environment")
            }
            if (client.config.build.outDir !== outDir) {
              throw new Error(
                `the client build must use its own directory, not ${client.config.build.outDir}`,
              )
            }
            await built.build(client)
          },
        },
      })
      await expect(builder.buildApp()).rejects.toThrow(
        /has files, which Vite copies beside the app/,
      )
      expect(mtime(shared)).toBe(before)
      expect(mtime(canary)).toBe(canaryBefore)
      expect(existsSync(join(root, "dist", "stray.txt"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outDir, { recursive: true, force: true })
      rmSync(canary, { force: true })
      rmSync(join(root, "dist", "stray.txt"), { force: true })
    }
  })
})
