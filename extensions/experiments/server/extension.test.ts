import { overHttp, overStdio, apps, type Era } from "@nessalabs/server-kit/testing"
import type { Extension } from "@nessalabs/server-kit"
import { afterEach, describe, expect, it } from "vitest"

import { runsNewestFirst, validateExperiment, type Experiment } from "../model/index.ts"
import {
  checkoutExperimentId,
  checkoutSample,
  latencyExperimentId,
  scaleSample,
} from "../samples/index.ts"
import { experimentsExtension } from "./extension.ts"
import { structuredResultBytes } from "./result-bound.ts"
import { samplesSource } from "./samples-source.ts"
import type { ExperimentSource, FileOpening } from "./source.ts"
import { experimentText, runText } from "./text.ts"
import { experimentView, placeholderHtml } from "./view.ts"

const startedAt = Date.UTC(2026, 0, 1)

/** The standard's MIME type for an MCP App's HTML. */
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"

const samples = experimentsExtension({
  source: samplesSource(startedAt),
  html: () => placeholderHtml,
})

/** A source over the samples whose file openings, and anything else, a test chooses. */
function sourceWith(overrides: Partial<ExperimentSource>): Extension {
  return experimentsExtension({
    source: { ...samplesSource(startedAt), ...overrides },
    html: () => placeholderHtml,
  })
}

const opened: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((close) => close()))
})

/** Each way a client reaches the server: stdio in both eras, HTTP in 2026-07-28's. */
const reaches = [
  { transport: "stdio", era: "legacy" },
  { transport: "stdio", era: "modern" },
  { transport: "http", era: "modern" },
] as const satisfies readonly { transport: "stdio" | "http"; era: Era }[]

const clients = reaches.flatMap((reach) => [
  { ...reach, apps: true, name: `${reach.transport} ${reach.era}, with MCP Apps` },
  { ...reach, apps: false, name: `${reach.transport} ${reach.era}, without MCP Apps` },
])

type Reach = (typeof clients)[number]

async function connect(reach: Reach, extension: Extension = samples) {
  const connection = await (reach.transport === "stdio" ? overStdio : overHttp)(
    extension,
    { era: reach.era, ...(reach.apps ? { mimeTypes: apps } : {}) },
  )
  opened.push(connection.close)
  return connection.client
}

/** The sample `make` makes, validated as the server validates it. */
function validated(make: (startedAt: number) => unknown): Experiment {
  const validation = validateExperiment(make(startedAt))
  if (validation.kind !== "valid") throw new Error("a sample is not valid")
  return validation.experiment
}

const checkout = validated(checkoutSample)

/** The text of a tool's answer. */
function textOf(result: { content?: unknown }): string {
  const [first] = result.content as readonly { type: string; text?: string }[]
  expect(first?.type).toBe("text")
  return first?.text ?? ""
}

const withApps = clients.filter((reach) => reach.apps)
const withoutApps = clients.filter((reach) => !reach.apps)

describe("the tools a client is offered", () => {
  it.each(withApps)(
    "are all five, with their views and callers, to $name",
    async (reach) => {
      const client = await connect(reach)
      const { tools } = await client.listTools()
      expect(
        tools.map((tool) => ({
          name: tool.name,
          ui: tool._meta?.ui,
          annotations: tool.annotations,
        })),
      ).toEqual([
        {
          name: "show_experiment",
          ui: { resourceUri: experimentView, visibility: ["model", "app"] },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        ...["get_experiment", "list_runs", "get_run"].map((name) => ({
          name,
          ui: { resourceUri: experimentView, visibility: ["app"] },
          annotations: { readOnlyHint: true, destructiveHint: false },
        })),
        {
          name: "open_file",
          ui: undefined,
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
      ])
    },
  )

  it.each(withoutApps)(
    "are only those the model may call, without _meta, to $name",
    async (reach) => {
      const client = await connect(reach)
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual(["show_experiment", "open_file"])
      expect(tools.map((tool) => tool._meta)).toEqual([undefined, undefined])
    },
  )

  it.each(withoutApps)("leave the app's tools unknown to $name", async (reach) => {
    const client = await connect(reach)
    for (const name of ["get_experiment", "list_runs", "get_run"]) {
      await expect(
        client.callTool({
          name,
          arguments: { experimentId: checkoutExperimentId, runId: "r1" },
        }),
      ).rejects.toMatchObject({
        code: -32602,
        message: expect.stringContaining(`Unknown tool: ${name}`),
      })
    }
  })
})

describe("the experiment view", () => {
  it.each(withApps)("is listed, and read as an MCP App, by $name", async (reach) => {
    const client = await connect(reach)
    expect((await client.listResources()).resources).toEqual([
      {
        uri: experimentView,
        name: "experiment",
        title: "Experiment",
        description: "An experiment's climb, areas, runs, and run detail.",
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: { prefersBorder: true } },
      },
    ])
    expect((await client.readResource({ uri: experimentView })).contents).toEqual([
      {
        uri: experimentView,
        mimeType: RESOURCE_MIME_TYPE,
        text: placeholderHtml,
        _meta: { ui: { prefersBorder: true } },
      },
    ])
  })

  it.each(withoutApps)("is not listed to $name", async (reach) => {
    const client = await connect(reach)
    expect((await client.listResources()).resources).toEqual([])
  })

  it("is the HTML it was given", async () => {
    const html = "<!doctype html><title>Built</title>"
    const client = await connect(
      withApps[0]!,
      experimentsExtension({ source: samplesSource(startedAt), html: () => html }),
    )
    expect(
      (await client.readResource({ uri: experimentView })).contents[0],
    ).toMatchObject({ text: html })
  })
})

describe("show_experiment", () => {
  it.each(clients)(
    "answers $name with text that stands on its own, and the experiment as data",
    async (reach) => {
      const client = await connect(reach)
      const result = await client.callTool({
        name: "show_experiment",
        arguments: { experimentId: checkoutExperimentId },
      })
      expect(result.isError).toBeFalsy()
      expect(textOf(result)).toBe(experimentText(checkout))
      expect(result.structuredContent).toEqual({
        experiment: JSON.parse(JSON.stringify(checkout)),
      })
    },
  )

  it.each([checkoutExperimentId, latencyExperimentId])(
    "shows the sample %s",
    async (id) => {
      const client = await connect(clients[0])
      const result = await client.callTool({
        name: "show_experiment",
        arguments: { experimentId: id },
      })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ experiment: { id } })
    },
  )

  it("keeps every served structured result within what a host keeps", async () => {
    const client = await connect(clients[0]!)
    for (const id of [checkoutExperimentId, latencyExperimentId]) {
      const shown = await client.callTool({
        name: "show_experiment",
        arguments: { experimentId: id },
      })
      const listed = await client.callTool({
        name: "list_runs",
        arguments: { experimentId: id },
      })
      const runs = (listed.structuredContent as { runs: { id: string }[] }).runs
      expect(
        Buffer.byteLength(JSON.stringify(shown.structuredContent)),
      ).toBeLessThanOrEqual(structuredResultBytes)
      expect(
        Buffer.byteLength(JSON.stringify(listed.structuredContent)),
      ).toBeLessThanOrEqual(structuredResultBytes)
      for (const run of runs) {
        const read = await client.callTool({
          name: "get_run",
          arguments: { experimentId: id, runId: run.id },
        })
        expect(
          Buffer.byteLength(JSON.stringify(read.structuredContent)),
        ).toBeLessThanOrEqual(structuredResultBytes)
      }
    }
  })

  it("refuses a structured result a host would drop whole", async () => {
    const client = await connect(
      clients[0]!,
      experimentsExtension({
        source: {
          ids: async () => ["search-latency-at-scale"],
          experiment: async () => scaleSample(startedAt),
          openFile: async () => ({ kind: "unavailable", reason: "none" }),
        },
        html: () => placeholderHtml,
      }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: "search-latency-at-scale" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(`${structuredResultBytes} bytes`)
    expect(result.structuredContent).toBeUndefined()
  })

  it("says which experiments there are when asked for one there is not", async () => {
    const client = await connect(clients[1])
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: "nope" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `show_experiment failed: There is no experiment "nope". The experiments are: ${checkoutExperimentId}, ${latencyExperimentId}.`,
    )
    expect(result.structuredContent).toBeUndefined()
  })

  it("refuses an experiment that is not valid, naming each rule it breaks", async () => {
    const broken = { ...checkoutSample(startedAt), bestSoFar: ["r404"] }
    const client = await connect(
      clients[0],
      sourceWith({ experiment: async () => broken }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: checkoutExperimentId },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^show_experiment failed: Experiment "checkout-hillclimb" can't be shown: it is not a valid experiment\.\n- best-runs-kept at bestSoFar\.\d+: /,
    )
    expect(result.structuredContent).toBeUndefined()
  })

  it("refuses an experiment with a field given as undefined, which JSON cannot carry", async () => {
    const sample = checkoutSample(startedAt)
    const client = await connect(
      clients[0],
      sourceWith({
        experiment: async () => ({
          ...sample,
          definition: { ...sample.definition, noise: undefined },
        }),
      }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: checkoutExperimentId },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^show_experiment failed: Experiment "checkout-hillclimb" can't be shown: it is not a valid experiment\.\n- shape at definition\.noise: /,
    )
  })

  it("refuses an answer for another experiment than the one asked for", async () => {
    const client = await connect(
      clients[0],
      sourceWith({ experiment: async () => checkoutSample(startedAt) }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: latencyExperimentId },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `show_experiment failed: the source answered experiment "${checkoutExperimentId}" for "${latencyExperimentId}"`,
    )
  })

  it("reads what the source handed over once, and serves only its copy", async () => {
    let reads = 0
    const held = Object.defineProperty(checkoutSample(startedAt), "title", {
      enumerable: true,
      get: () => (++reads === 1 ? "First read" : "A later read"),
    })
    const client = await connect(clients[0], sourceWith({ experiment: async () => held }))
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: checkoutExperimentId },
    })
    expect(reads).toBe(1)
    expect(textOf(result)).toMatch(/^First read \(experiment checkout-hillclimb\)\n/)
    expect(result.structuredContent).toMatchObject({
      experiment: { title: "First read" },
    })
  })

  it("takes null from the source as no experiment", async () => {
    const client = await connect(clients[0], sourceWith({ experiment: async () => null }))
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: "nope" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `show_experiment failed: There is no experiment "nope". The experiments are: ${checkoutExperimentId}, ${latencyExperimentId}.`,
    )
  })

  it("refuses a source that lists an experiment it then does not have", async () => {
    const client = await connect(
      clients[0],
      sourceWith({ experiment: async () => undefined }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: checkoutExperimentId },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `show_experiment failed: the source lists experiment "${checkoutExperimentId}" but has none`,
    )
  })

  it("reads the ids the source listed once, and names only its copy", async () => {
    let reads = 0
    const listed = Object.defineProperty(["a"], 0, {
      enumerable: true,
      get: () => (++reads === 1 ? "first" : "later"),
    })
    const client = await connect(clients[0], sourceWith({ ids: async () => listed }))
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: "nope" },
    })
    expect(reads).toBe(1)
    expect(textOf(result)).toBe(
      `show_experiment failed: There is no experiment "nope". The experiments are: first.`,
    )
  })

  it("hands the source the call's signal, so a cancelled call reaches it", async () => {
    let sawAbort: (aborted: boolean) => void = () => {}
    const aborted = new Promise<boolean>((resolve) => (sawAbort = resolve))
    let begun: () => void = () => {}
    const started = new Promise<void>((resolve) => (begun = resolve))
    const client = await connect(
      clients[1],
      sourceWith({
        experiment: (_id, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              sawAbort(true)
              resolve(undefined)
            })
            begun()
          }),
      }),
    )
    const cancel = new AbortController()
    const call = client.callTool(
      { name: "show_experiment", arguments: { experimentId: checkoutExperimentId } },
      { signal: cancel.signal },
    )
    await started
    cancel.abort()
    await expect(call).rejects.toThrow()
    expect(await aborted).toBe(true)
  })

  it("hands the source the call's signal when it lists the experiments", async () => {
    let sawAbort: (aborted: boolean) => void = () => {}
    const aborted = new Promise<boolean>((resolve) => (sawAbort = resolve))
    let begun: () => void = () => {}
    const started = new Promise<void>((resolve) => (begun = resolve))
    const client = await connect(
      clients[1],
      sourceWith({
        ids: (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              sawAbort(true)
              resolve([])
            })
            begun()
          }),
      }),
    )
    const cancel = new AbortController()
    const call = client.callTool(
      { name: "show_experiment", arguments: { experimentId: "nope" } },
      { signal: cancel.signal },
    )
    await started
    cancel.abort()
    await expect(call).rejects.toThrow()
    expect(await aborted).toBe(true)
  })

  it.each([
    ["an id that is not a string", [7]],
    ["a blank id", [""]],
    ["an id with a line break", ["a\nInjected line"]],
    ["an id twice", ["a", "a"]],
  ])("refuses a source that lists %s", async (_, listed) => {
    const client = await connect(
      clients[0],
      sourceWith({ ids: async () => listed as unknown as string[] }),
    )
    const result = await client.callTool({
      name: "show_experiment",
      arguments: { experimentId: "nope" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^show_experiment failed: the source listed its experiments wrongly/,
    )
  })
})

describe("the app's tools", () => {
  const appClients = withApps

  it.each(appClients)(
    "get_experiment answers $name as show_experiment does",
    async (reach) => {
      const client = await connect(reach)
      const result = await client.callTool({
        name: "get_experiment",
        arguments: { experimentId: checkoutExperimentId },
      })
      expect(textOf(result)).toBe(experimentText(checkout))
      expect(result.structuredContent).toEqual({
        experiment: JSON.parse(JSON.stringify(checkout)),
      })
    },
  )

  it.each(appClients)(
    "list_runs answers $name with the runs newest first",
    async (reach) => {
      const client = await connect(reach)
      const result = await client.callTool({
        name: "list_runs",
        arguments: { experimentId: checkoutExperimentId },
      })
      const runs = runsNewestFirst(checkout)
      expect(result.structuredContent).toEqual({
        experimentId: checkoutExperimentId,
        runs: JSON.parse(JSON.stringify(runs)),
      })
      const lines = textOf(result).split("\n")
      expect(lines[0]).toBe(`The runs of ${checkout.title}, newest first:`)
      expect(
        lines.slice(1).map((line) => /^- run \d+ \(([^)]+)\)/.exec(line)?.[1]),
      ).toEqual(runs.map((run) => run.id))
    },
  )

  it("list_runs says when there are no runs yet", async () => {
    const fresh = { ...checkoutSample(startedAt) }
    const empty = {
      ...fresh,
      runs: [],
      bestSoFar: [],
      notes: [],
      agents: fresh.agents.map((agent) => ({
        ...agent,
        activity: { kind: "resting" as const, note: "Waiting." },
      })),
    }
    const client = await connect(
      withApps[0]!,
      sourceWith({ experiment: async () => empty }),
    )
    const result = await client.callTool({
      name: "list_runs",
      arguments: { experimentId: checkoutExperimentId },
    })
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toBe(`Experiment ${checkoutExperimentId} has no runs yet.`)
    expect(result.structuredContent).toEqual({
      experimentId: checkoutExperimentId,
      runs: [],
    })
  })

  it.each(appClients)("get_run answers $name with the run in full", async (reach) => {
    const client = await connect(reach)
    const run = checkout.runs[0]!
    const result = await client.callTool({
      name: "get_run",
      arguments: { experimentId: checkoutExperimentId, runId: run.id },
    })
    expect(textOf(result)).toBe(runText(checkout, run))
    expect(result.structuredContent).toEqual({
      experimentId: checkoutExperimentId,
      run: JSON.parse(JSON.stringify(run)),
    })
  })

  it("get_run refuses a run the experiment does not have", async () => {
    const client = await connect(withApps[0]!)
    const result = await client.callTool({
      name: "get_run",
      arguments: { experimentId: checkoutExperimentId, runId: "r404" },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `get_run failed: Experiment ${checkoutExperimentId} has no run "r404".`,
    )
  })
})

describe("open_file", () => {
  const run = checkout.runs.find((each) => each.change !== undefined)!
  const path = run.change!.files[0]!.path

  async function open(
    openFile: ExperimentSource["openFile"] | undefined,
    args: Record<string, unknown>,
    reach: Reach = clients[1],
  ) {
    const client = await connect(
      reach,
      openFile === undefined ? samples : sourceWith({ openFile }),
    )
    return client.callTool({ name: "open_file", arguments: args })
  }

  it.each(clients)(
    "says to $name that the samples have no files to open",
    async (reach) => {
      const result = await open(
        undefined,
        { experimentId: checkoutExperimentId, runId: run.id, path },
        reach,
      )
      expect(result.isError).toBeFalsy()
      expect(textOf(result)).toBe(
        `Can't open ${path} in run ${run.id}: The samples record what a run changed, not the files' contents.`,
      )
      expect(result.structuredContent).toEqual({
        experimentId: checkoutExperimentId,
        runId: run.id,
        path,
        opening: {
          kind: "unavailable",
          reason: "The samples record what a run changed, not the files' contents.",
        },
      })
    },
  )

  it("answers a link, which the app opens through ui/open-link", async () => {
    const asked: unknown[] = []
    const url = "https://example.com/diff?file=1"
    const result = await open(
      async (request) => {
        asked.push(request)
        return { kind: "link", url }
      },
      { experimentId: checkoutExperimentId, runId: run.id, path },
    )
    expect(asked).toEqual([{ experimentId: checkoutExperimentId, runId: run.id, path }])
    expect(textOf(result)).toBe(`Open ${path} in run ${run.id} at ${url}`)
    expect(result.structuredContent).toEqual({
      experimentId: checkoutExperimentId,
      runId: run.id,
      path,
      opening: { kind: "link", url },
    })
  })

  it("answers contents to download, for the run's whole change when no path is given", async () => {
    const opening: FileOpening = {
      kind: "download",
      name: `${run.id}.diff`,
      mimeType: "text/x-diff",
      text: "--- a\n+++ b\n",
    }
    const asked: unknown[] = []
    const result = await open(
      async (request) => {
        asked.push(request)
        return opening
      },
      { experimentId: checkoutExperimentId, runId: run.id },
    )
    expect(asked).toEqual([{ experimentId: checkoutExperimentId, runId: run.id }])
    expect(textOf(result)).toBe(
      `Ready to download the change of run ${run.id} as ${run.id}.diff (text/x-diff):\n\n--- a\n+++ b\n`,
    )
    expect(result.structuredContent).toEqual({
      experimentId: checkoutExperimentId,
      runId: run.id,
      opening,
    })
  })

  it("refuses a path the run did not change, without asking the source", async () => {
    const asked: unknown[] = []
    const result = await open(
      async (request) => {
        asked.push(request)
        return { kind: "link", url: "https://example.com" }
      },
      { experimentId: checkoutExperimentId, runId: run.id, path: "not/changed.ts" },
    )
    expect(asked).toEqual([])
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `open_file failed: Run ${run.id} of experiment ${checkoutExperimentId} did not change "not/changed.ts".`,
    )
  })

  /** `run` without its `change` key. */
  function withoutChange<Run extends { change?: unknown }>(run: Run) {
    const { change: _change, ...rest } = run
    return rest
  }

  it("refuses a run with no change, and a run there is not", async () => {
    const sample = checkoutSample(startedAt)
    const unchanged = {
      ...sample,
      runs: sample.runs.map((each) => (each.id === run.id ? withoutChange(each) : each)),
    }
    const client = await connect(
      clients[1],
      sourceWith({ experiment: async () => unchanged }),
    )
    const none = await client.callTool({
      name: "open_file",
      arguments: { experimentId: checkoutExperimentId, runId: run.id },
    })
    expect(none.isError).toBe(true)
    expect(textOf(none)).toBe(
      `open_file failed: Run ${run.id} of experiment ${checkoutExperimentId} records no change.`,
    )
    const missing = await open(undefined, {
      experimentId: checkoutExperimentId,
      runId: "r404",
    })
    expect(missing.isError).toBe(true)
    expect(textOf(missing)).toBe(
      `open_file failed: Experiment ${checkoutExperimentId} has no run "r404".`,
    )
  })

  it("hands the source the call's signal, so a cancelled call reaches it", async () => {
    let sawAbort: (aborted: boolean) => void = () => {}
    const aborted = new Promise<boolean>((resolve) => (sawAbort = resolve))
    let begun: () => void = () => {}
    const started = new Promise<void>((resolve) => (begun = resolve))
    const client = await connect(
      clients[1],
      sourceWith({
        openFile: (_request, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              sawAbort(true)
              resolve({ kind: "unavailable", reason: "Cancelled." })
            })
            begun()
          }),
      }),
    )
    const cancel = new AbortController()
    const call = client.callTool(
      {
        name: "open_file",
        arguments: { experimentId: checkoutExperimentId, runId: run.id, path },
      },
      { signal: cancel.signal },
    )
    await started
    cancel.abort()
    await expect(call).rejects.toThrow()
    expect(await aborted).toBe(true)
  })

  it("reads the opening the source answered once, and serves only its copy", async () => {
    let reads = 0
    const answer = Object.defineProperty(
      { kind: "download", name: "a.diff", mimeType: "text/x-diff", text: "" },
      "text",
      { enumerable: true, get: () => (++reads === 1 ? "first" : "later") },
    )
    const result = await open(async () => answer as FileOpening, {
      experimentId: checkoutExperimentId,
      runId: run.id,
      path,
    })
    expect(reads).toBe(1)
    expect(textOf(result)).toMatch(/:\n\nfirst$/)
    expect(result.structuredContent).toMatchObject({ opening: { text: "first" } })
  })

  it.each([
    ["a link that is not a URL", { kind: "link", url: "not a url" }],
    ["a javascript: link", { kind: "link", url: "javascript:alert(1)" }],
    ["a data: link", { kind: "link", url: "data:text/html,<script>1</script>" }],
    ["a file: link", { kind: "link", url: "file:///etc/passwd" }],
    ["an editor's own scheme", { kind: "link", url: "vscode://file/a.ts" }],
    ["a scheme that starts as http does", { kind: "link", url: "httpx://a.example/" }],
    [
      "a scheme that starts as https does",
      { kind: "link", url: "https-evil://a.example/" },
    ],
    [
      "a download with a blank name",
      { kind: "download", name: " ", mimeType: "text/plain", text: "" },
    ],
    [
      "a download with a blank media type",
      { kind: "download", name: "a.txt", mimeType: "", text: "" },
    ],
    ["an opening of another kind", { kind: "editor" }],
    ["a key an opening does not have", { kind: "unavailable", reason: "x", extra: 1 }],
    ["a key a link does not have", { kind: "link", url: "https://a.example", extra: 1 }],
    [
      "a key a download does not have",
      { kind: "download", name: "a", mimeType: "text/plain", text: "", extra: 1 },
    ],
    ["a blank reason", { kind: "unavailable", reason: " " }],
  ])("refuses a source that answers %s", async (_, answer) => {
    const result = await open(async () => answer as unknown as FileOpening, {
      experimentId: checkoutExperimentId,
      runId: run.id,
      path,
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(
      /^open_file failed: the source answered how to open a file wrongly/,
    )
  })
})
