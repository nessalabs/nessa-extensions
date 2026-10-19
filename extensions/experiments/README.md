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
  text.ts         standalone tool text and character-safe bounded summaries/diagnostics
  view.ts         the experiment view's URI, and a placeholder document the server tests inject
  paging.ts       continuation pages of one source revision, with no retained server state
  result-bound.ts the chat view's 16,384-byte bound on the opening structured result
  extension.ts    experimentsExtension: the view and the five tools, over a source
  main.ts         the bin: the extension over stdio, on the samples, serving dist/app/index.html
app/              the MCP App, in the browser
  count.ts        how a count is written; a metric's numbers stay in metric.ts
  geometry.ts     the climb's and the map's pixels
  kit-stand-in/   a temporary copy of nessa_ui at e02b577, byte for byte
                  under src/ (stand-in.test.ts), deleted when
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
  use-host.ts     the app's tool calls: get_experiment, list_runs, get_run, open_file
  paged-call.ts   assembles and checks continuation pages before reading their bodies
  host-data.ts    those answers, checked before a page draws them
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
and exits 0. It needs Google Chrome and Playwright's WebKit installed.
The required browser pass is `@nessalabs/app-shell`'s fake host, driven in
Chromium and WebKit: open, the overview, the runs list with a filter, a
run's detail, and its lineage. The reference host
(`@modelcontextprotocol/ext-apps`'s `AppBridge`) is extra evidence; its
Chromium pass writes the reference-host shots.
Nessa is the desktop behind its sandbox proxy, through a real gateway and
this extension's server, in Chromium. Nessa's conversation view keeps at
most 16,384 bytes of the opening tool's structured result and drops a larger
one whole, keeping the text. `show_experiment` leaves that structured result
out and still returns the text. The app then loads the experiment with
`get_experiment`. A call the app makes is a different bound: 56KB of the
whole result, JSON-encoded and then encoded again as a JSON string.
`get_experiment`, `list_runs`, `get_run`, and `open_file` split large answers
into continuation pages. Each page spends at most 40,000 bytes on its ASCII
JSON slice after the host's two enclosing JSON encodings: quotes and backslashes
cost four bytes, and other ASCII characters cost one. Non-ASCII code units are
written as JSON escapes before slicing. This leaves room for the bounded summary
and MCP envelope under the unchanged 57,344-byte host limit. This is an
extension transport choice; the host's limit stays unchanged. Small results
use their ordinary text and data. Large results carry `data.page` with
`revision`, `offset`, `total`, `json`, and an optional `next`. Call the same
tool with its original arguments and `continuation: next` until complete.
The app assembles the outcome before its existing domain readers validate it.
This is ordinary MCP `tools/call`, with no host API addition.

A continuation identifies the SHA-256 of the complete outcome, including its
text, rather than a mutable source name. The server re-reads and validates the
source on each page. A changed answer is refused instead of mixing revisions;
reopening starts a fresh read. This keeps no server-side snapshot cache or
lifetime, at the cost of repeated serialization and source validation. It bounds
calls, not the final in-memory experiment or its rendering cost.
The realistic scale fixture keeps its 10,000 changed files and million-case
evaluation; `server/paging.test.ts` requires its complete experiment to assemble
in at most 48 calls. This deterministic work bound guards against the previous
124-page read without relaxing the test deadline or relying on machine speed.

| State / event | Result | Evidence |
| --- | --- | --- |
| First read, small outcome | Return ordinary text and data | Existing server and app suites |
| First read, large outcome | Return first page and continuation | `server/paging.test.ts` |
| Continuation, unchanged outcome | Advance by the page length; omit next on final page | `server/paging.test.ts` |
| Continuation, changed outcome or offset past end | Refuse; publish no partial experiment | `server/paging.test.ts` |
| Valid non-ASCII text crosses a page boundary | Each page is ASCII; assembly preserves the original text | `server/paging.test.ts` |
| Page repeats, changes revision/total, fails to advance, or ends with invalid JSON | Fail the read before domain/UI publication | `app/paged-call.test.ts` |
| Server refuses a later page | Show the refusal, without a partial result | `app/paged-call.test.ts` |
| Source becomes malformed, or throws a long diagnostic | Bound refusal text before the server kit encodes it, including between pages | `server/paging.test.ts` |
| View changes during an outstanding read | Ignore the result and stop requesting further pages | `app/paged-call.test.ts` and hook tests |
| A model or a client without assembly reads a large result | Every page retains a bounded original text summary and its continuation instruction; a cutoff keeps complete characters | `server/paging.test.ts` and `server/text.test.ts` |
| File target is retried, its run changes, its view becomes hidden, or the control unmounts while a call waits | The existing mounted/generation/latest-request authority becomes false; issue no further page or link request | `app/use-open-file.test.tsx` and app integration tests |
| Different file targets are open concurrently | Each keeps its own latest request authority | `app/use-open-file.test.tsx` |
| Final file response arrives after its request became stale | Do not call the host's openLink | App integration tests |

The byte regression suite measures every actual stdio-entry and loopback HTTP
response with `Buffer.byteLength(JSON.stringify(JSON.stringify(result)))`,
matching Nessa's `mcp_servers/domain/app_call.rs` limit and
`conversation/application/service/app_calls.rs` encoding. It includes an
experiment over ten times checkout, a single large run, large file contents,
and quotes, backslashes, controls, surrogate halves, and non-ASCII text.
Source failures retain at most 4,096 diagnostic code units plus an explicit
truncation marker and are made well-formed Unicode, so malformed field names and thrown source errors also fit
the wire bound.
Browser qualification of this change is separate from those transport tests. The
real-host capture's child program is `verification/capture-driver.ts`. It uses
the isolated-cache launcher from [host PR #1036](https://github.com/nessalabs/nessa-agent/pull/1036);
use a host checkout containing that prerequisite for concurrent verification.
It requests a private cache and explicitly selects the development React runtime.
It uses the host client's public `prepare`/`submit` API and resumes stdin so the parent's
close releases the client, dev server and gateway even while the submission
receipt is pending. Its subprocess regression uses a client with only that
current API; it does not start a browser or modify the host.

`verification/capture-calls.ts` observes real gateway WebSocket replies during
the large capture. It measures the host's original `resultJson` string after
one further JSON encoding, rather than recreating its first serialization.

| Capture event | Required evidence | Regression |
| --- | --- | --- |
| Parent closes stdin while the submission receipt is pending | Driver closes client, dev server and gateway | `verification/capture-driver.test.ts` |
| Host dev server starts beside another verifier | Request a private Vite cache and development React runtime; host launcher owns cleanup | `verification/capture-driver.test.ts`; host `server-cache.test.mjs` |
| An app request is sent | Correlate id within its own socket; ignore other RPC methods | `verification/capture-calls.test.ts` |
| Its reply arrives | Measure original resultJson, reject refusal/tool error or excess bytes | `verification/capture-calls.test.ts` |
| Repeated or reordered pages arrive | Identical duplicates may combine; require consistent totals, contiguous offsets and the full revision hash | `verification/capture-calls.test.ts` |
| Capture finishes | No pending requests or observation errors; all four tools observed and exact experiment/run/list/file data recovered | `verification/capture-calls.test.ts` |

The
scenario runner's completion does not name the MCP tool, and Nessa attaches
the forwarded structured result only when it does; `forward-structured.mjs`
adds that name. The capture fails if the page shows "Blocked a connection
this app didn't declare". Zod's fast path probes `new Function`, and a
strict CSP reports that even when the throw is caught; the app sets
`jitless` before any schema is built, so the probe does not run. An earlier
shot of that banner was the fixture slot, which is not this server.

The large-input verifier runs after `pnpm build`:

```sh
node extensions/experiments/verification/large.mjs
node extensions/experiments/verification/large.mjs --transport-only
```

The default opens the built app in the fake host in Chromium and WebKit,
recovers a large experiment from a text-only opening, then opens its runs and
full run detail with a virtualized list of files. It forwards the app's calls
to the real extension MCP server entry. `verification/evidence/large/` holds
the per-call bytes and the browser assertions/screenshots; the transport-only
mode writes a separate file with an empty browser list. This does not establish
Nessa-host or native acceptance; those require the real gateway/browser stack.
`EXPERIMENTS_CHROMIUM_EXECUTABLE` may name an already installed Chromium binary;
both engines are still required, and a missing WebKit executable fails the run.

The file-opening lifetime belongs to `useOpenFile`'s mounted control, run
generation and latest request per target, as defined in `open-file.ts`. The
open port carries a predicate reading that existing authority; `useHostOpen`
passes it into pagination and consults it before asking the host to open a
link. No second request table or lifecycle flags live in the transport hook.

This corrects the review-loop diagnosis: a transport-only wrapper had dropped
the existing standalone-text and request-lifetime contracts. The same outcome
now supplies both bounded wire text and assembled data, and the same request
owner governs both settlement and further external effects.

For the real Nessa gateway/server harness, after building nessa-agent and the
extension, run:

```sh
NESSA_AGENT_ROOT=/absolute/path/to/nessa-agent EXPERIMENTS_LARGE=1 node extensions/experiments/verification/capture.mjs
```

The large mode uses `verification/large-server.mjs` as a real stdio server in
the harness's isolated gateway. Chromium and WebKit each open the experiment,
its run list and full run detail, assert a virtualized file list, and exercise
the file refusal. It writes engine-specific Nessa screenshots separately
from the historical PR21 captures. Final combined exact-source acceptance is
pending in the approved Mac environment. Preserve the original canonical
`jsxDEV` failure alongside the later standalone pass; cache isolation does not
conclusively explain that failure.
