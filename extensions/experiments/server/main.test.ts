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

describe("main", () => {
  it.each(["legacy", "modern"] as const)(
    "serves the samples over stdio, as a child process, to a %s-era client",
    async (era) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("./main.ts", import.meta.url))],
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
