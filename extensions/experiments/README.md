# @nessalabs/experiments

An experiment's climb, areas, runs, and run detail, as an MCP server with an
MCP App: agents trying changes to a product against a metric, keeping what
improves it. The same views serve a percent score that should rise, a latency
that should fall, or a comparison with no areas and no agents, because every
view reads the experiment through its definition
([nessa-agent ADR 333](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/333-experiments.md),
amended by [ADR 344](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/344-mcp-ui.md)).

It is built in slices. What is here is the model, the server, and the app:

| Slice | What | Status |
| --- | --- | --- |
| [#4](https://github.com/nessalabs/nessa-extensions/issues/4) | `model/`: the definition, validation into a branded `Experiment`, the one formatter, what the views read; `samples/` | Done |
| [#5](https://github.com/nessalabs/nessa-extensions/issues/5) | `server/`: the tools, on `@nessalabs/server-kit` | Done |
| [#6](https://github.com/nessalabs/nessa-extensions/issues/6) | `app/`: the climb, the map, area cards, verdicts, cases and changes | Done |
| [#7](https://github.com/nessalabs/nessa-extensions/issues/7) | `app/`: the pages — overview, areas, runs, run detail, the inline card | Done |

## Module map

```
model/            the domain: pure, no DOM, no Node, no clock; imports neither side
  values.ts       ids, text, times, counts — the values everything is written in
  definition.ts   ExperimentDefinition, Metric, Limit, splits, guardrails, verdicts
  experiment.ts   runs, the baseline, cases, changes, areas, agents, notes; the Experiment brand
  validation.ts   validateExperiment: the only maker of an Experiment, and its rules
  slice.ts        the model of a slice (eight cells) that the rule slice-coherent checks
  path-data.ts    the SVG path grammar an area's glyph is held to
  metric.ts       formatValue, formatSize, changeBetween: the one place a metric's numbers are written
  selections.ts   what the views read: the best version, the climb, the path, lineage, order, limits
  index.ts        the model's exports; nothing sample-shaped
  fixture.ts      test support: the smallest experiment with one of everything
samples/          experiments as a source hands them over: a hill-climb, a latency, one at scale
server/           the MCP server, on @nessalabs/server-kit; runs in Node
  source.ts       ExperimentSource: the port a source of experiments plugs into
  reading.ts      the one place a source's answers are checked, each parsed into a copy
  samples-source.ts  the samples as a source, dated from when the server starts
  text.ts         what each tool says in text, standing on its own
  view.ts         the experiment view's URI, and a placeholder document the server tests inject
  extension.ts    experimentsExtension: the view and the five tools, over a source
  main.ts         the bin: the extension over stdio, on the samples, serving dist/app/index.html
app/              the MCP App, in the browser
  count.ts        how a count is written; a metric's numbers stay in metric.ts
  geometry.ts     the climb's and the map's pixels
  kit-stand-in/   a temporary copy of nessa_ui at e02b577, deleted when
                  @nessalabs/ui is installable (nessa_ui#115)
  open-file.ts    opening a file or the whole change: the latest request per target
  reading.ts      what a view shows; labels from the definition, numbers from metric.ts
  series.ts       an area's hue as the chart series ink
  tokens.css      nessa_ui's token defaults, generated from the pin in nessa-ui-tokens.ts
  use-climb.ts, use-map.ts, use-change.ts, use-open-file.ts, use-measure.ts
                  hover, the file query, opening a file, measurement
  climb-chart.tsx, exploration-map.tsx, area-card.tsx, verdict-label.tsx,
  case-results.tsx, change-view.tsx
                  the components: props in, no state of their own
  index.ts        the components' barrel
  preview.tsx     mounts every component, for the tests
  host-data.ts    the tool result and `tools/call` answers, checked before a page draws them
  navigation.ts   which view, and the runs opened over it
  page-reading.ts what the pages show, read from the definition and the harness
  sparkline.ts    the card's best-so-far line, drawn as given
  experiment-card.tsx, overview.tsx, areas-page.tsx, runs-view.tsx, run-detail.tsx
                  the pages: props in
  surface.tsx     the fullscreen view: header, view selector, pages, a run over them
  experiment-app.tsx  the view: the card inline, the surface fullscreen
  csp.ts          zod jitless, set before any schema is built: a CSP reports `new Function`
  main.tsx        the document's entry: `mountApp`, declaring inline and fullscreen
  index.html      the document the build inlines into one file
vite.config.ts    the build: dist/main.js the bin, and dist/app/index.html the app
```

`server/` and `app/` both import `model/`; it imports neither. The component
views take props. The pages' hooks own navigation, the run list, and the open
run; the component hooks own hover, measurement, the file query and opening a
file. Tests sit beside what they test.

## The model

- **The shape is declared once**, as zod schemas in `definition.ts` and
  `experiment.ts`, and the types are derived from them. Every schema is
  `.readonly()`, so what zod makes is frozen at every level and typed so.
- **An `Experiment` is only what `validateExperiment` made.** It parses its
  input into a fresh copy and reads only the copy from then on: the rules are
  checked on it, and it is what is branded and returned. The brand is a class
  with a private member, which an object spread does not copy, so `{
  ...experiment }` is not an `Experiment`. `validation.ts` says what each rule
  holds; `validation.test.ts` tests each one both ways.
- **It travels as JSON.** Everything in it is JSON — times are milliseconds
  since the epoch, an optional field is absent or a value, never `undefined`,
  and no number is `-0`, which JSON writes as `0` — so a valid experiment is
  exactly what JSON carries. The server can return it as a tool's `data`, and
  the app, which receives that `data` from its host, validates it again before
  it draws anything.
- **The harness decides.** Whether a run was kept, which is best (the last of
  `bestSoFar`, or the baseline while it is empty), and why, are the harness's;
  `selections.ts` reads them and never works them out from scores.
- **Numbers are written in `metric.ts`.** A value is `Formatted` text: its
  number to the metric's `decimals`, rounded half away from zero on the
  decimal it reads as (its shortest round-trip digits, rounded exactly in
  `bigint`, the same in every engine), and its `unit` exactly as given (so a
  definition writes `" ms"` for a space), on the side `position` says. Absent
  is after; `before` reads `$0.05`, and a minus leads both (`−$0.05`). A
  size — an interval, the noise — is `Formatted` in `deltaUnit`, with no
  sign, on that same side. A change is a `Change`, made from the two values
  it is between: the exact difference of the two as written, its size in
  `deltaUnit`, and its tone by `better` and the noise, for nessa_ui's `Delta`
  to draw. Which noise applies is decided once, in `selections.ts`
  (`metricChange` for the experiment's metric, `guardrailChange` with none),
  so the barrel exports those, not `changeBetween`. Measured numbers stay
  within ±10¹⁵, so what is worked out from two of them stays finite. Counts
  are not metric values.
- **Tables are read for what they own.** A run's `scores` and `measures` are
  keyed by ids from outside; `scoreOf` and `measureOf` read them with
  `Object.hasOwn`. A table's own `__proto__` key, which zod's record would
  drop without a word, is refused in the parse (`refuseProto`).

## Samples

`samples/` is what a source would hand over, as `ExperimentInput`, dated from
the `startedAt` it is given:

- **`checkoutSample`**: the checkout-support hill-climb — percent, higher is
  better, train and test, a cost guardrail in dollars (the unit before the
  value) relative to the baseline, five areas, six agents, runs settled,
  running and queued, and a keep decided after reruns, which settles after
  runs made later.
- **`latencySample`**: another kind — p95 latency in milliseconds, lower is
  better, one split, an accuracy guardrail at least a fixed value, no areas,
  no agents, no reference, no budget. If a view needs a change to show it, the
  definition is missing something.
- **`scaleSample`**: one run that moves cases out of a million and touches ten
  thousand files.

## The server

`npx @nessalabs/experiments` serves the extension over stdio (`server/main.ts`,
built into `dist/main.js`). Its tools, all read-only:

| Tool | Who calls it | What it answers |
| --- | --- | --- |
| `show_experiment` | the model and the app | `{ experimentId }`: the experiment, as text and as `data.experiment`, shown in the experiment view (`ui://experiments/experiment`) |
| `get_experiment` | the app | the same, for the view to read again |
| `list_runs` | the app | `{ experimentId }`: the runs newest first, as `data.runs` |
| `get_run` | the app | `{ experimentId, runId }`: one run in full, as `data.run` |
| `open_file` | the model and the app | `{ experimentId, runId, path? }`: how to open a file the run changed, or its whole change, as `data.opening`: a `link` the app hands to `ui/open-link` when the host offers `openLinks`, contents to `download` which the app refuses (the spec has no download request), or why it is `unavailable` |

- **Every answer is text that stands on its own**, for a host without MCP Apps
  and for the model, plus the model's data for the view. A client without MCP
  Apps is offered only `show_experiment` and `open_file`; the server kit holds
  that, and everything else about negotiation and what a tool answers.
- **The view's HTML is the built app.** `main.ts` reads `dist/app/index.html`
  (under `app/` beside the bundle once it is built) and hands it to `experimentsExtension`.
  The app validates that document's tool result with `validateExperiment`
  before it draws. `list_runs` and `get_run` are read again through the
  bridge, and the view draws those validated bodies: the list's order and
  each run's verdict, reason, and score, and the open run's outcome, cases,
  and change. The opening snapshot says which experiment it is, and whether
  a later run belongs to it. Inline is the card; it asks for fullscreen with
  `ui/request-display-mode` only when the host offers it, and draws the mode
  the host applied to this view. Navigation and Escape stay in the app:
  Escape closes the run on screen, one at a time, and with none open it does
  nothing. It does not close a run while a text field has the key.
- **The data comes through a port**, `ExperimentSource` (`server/source.ts`):
  the experiments' ids, an experiment by id, and how to open a run's file.
  Nothing a source answers is trusted. `reading.ts` parses each answer into a
  copy and reads only the copy: an experiment through `validateExperiment`, so
  one that breaks a rule is refused with every problem named, and an
  experiment answered for another id is refused too, as is an id the source
  lists but does not have. An unknown id is answered with the ids there are. A
  link to open is `http` or `https` only: a `javascript:` or `data:` URL from
  a source would run what the source wrote. Text names only the first of a
  long list — of runs, files, problems or ids — and counts the rest, and shows
  only the start of a long download; the limits are `text.ts`'s constants.
- **The source is the samples, for now** (`server/samples-source.ts`), dated
  from when the server starts; they record what a run changed, not the files,
  so `open_file` says it cannot open one. A real harness plugs in as another
  `ExperimentSource`, handed to `experimentsExtension` in `main.ts`
  ([#5](https://github.com/nessalabs/nessa-extensions/issues/5) records the
  decision).

## In a host

`verification/capture.mjs` records the inline card and the fullscreen view
and exits 0. The reference host (`@modelcontextprotocol/ext-apps`'s
`AppBridge`) is given the checkout sample. Nessa is the desktop behind its
sandbox proxy, through a real gateway and this extension's server. Nessa's
conversation view keeps at most 16KB of a tool's structured result and drops
a larger object whole, so the checkout result (about 232KB) arrives with no
experiment and the app says so. The capture asks for the latency sample,
which fits. The scenario runner's completion does not name the MCP tool, and
Nessa attaches the forwarded structured result only when it does;
`forward-structured.mjs` adds that name. The capture fails if the page shows
"Blocked a connection this app didn't declare". Zod's fast path probes
`new Function`, and a strict CSP reports that even when the throw is caught;
the app sets `jitless` before any schema is built, so the probe does not run.
An earlier shot of that banner was the fixture slot, which is not this server.
