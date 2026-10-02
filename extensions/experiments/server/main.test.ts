import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { apps, capabilitiesFor } from "@nessalabs/server-kit/testing"
import { afterEach, describe, expect, it } from "vitest"

import { checkoutExperimentId } from "../samples/index.ts"
import { experimentView, placeholderHtml } from "./view.ts"

const opened: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()))
})

/** The bin's source, and what `pnpm build` makes of it: what `npx` runs. */
const entries = [
  { name: "server/main.ts", path: fileURLToPath(new URL("./main.ts", import.meta.url)) },
  {
    name: "dist/main.js",
    path: fileURLToPath(new URL("../dist/main.js", import.meta.url)),
  },
]

describe("the bin", () => {
  it("is built before the tests run in CI, so the bundle is tested there", () => {
    // Locally the bundle is tested once `pnpm build` has made it.
    if (process.env.CI !== undefined) expect(existsSync(entries[1]!.path)).toBe(true)
  })

  it.each(
    entries
      .filter((entry) => existsSync(entry.path))
      .flatMap((entry) =>
        (["legacy", "modern"] as const).map((era) => ({ ...entry, era })),
      ),
  )(
    "$name serves the samples over stdio, as a child process, to a $era-era client",
    async ({ path, era }) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path],
        stderr: "pipe",
      })
      const client = new Client(
        { name: "main", version: "1" },
        {
          capabilities: capabilitiesFor({ era, mimeTypes: apps }),
          versionNegotiation:
            era === "legacy" ? { mode: "legacy" } : { mode: { pin: "2026-07-28" } },
        },
      )
      await client.connect(transport)
      opened.push(() => client.close())
      expect(client.getServerVersion()).toMatchObject({ name: "@nessalabs/experiments" })
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "show_experiment",
        "get_experiment",
        "list_runs",
        "get_run",
        "open_file",
      ])
      const result = await client.callTool({
        name: "show_experiment",
        arguments: { experimentId: checkoutExperimentId },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        experiment: { id: checkoutExperimentId },
      })
      expect((await client.readResource({ uri: experimentView })).contents).toMatchObject(
        [{ text: placeholderHtml }],
      )
    },
  )
})
