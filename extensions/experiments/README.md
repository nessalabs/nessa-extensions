# @nessalabs/experiments

An experiment's climb, areas, runs, and run detail, as an MCP server with an
MCP App: agents trying changes to a product against a metric, keeping what
improves it. The same views serve a percent score that should rise, a latency
that should fall, or a comparison with no areas and no agents, because every
view reads the experiment through its definition
([nessa-agent ADR 333](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/333-experiments.md),
amended by [ADR 344](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/344-mcp-ui.md)).

It is built in slices. What is here is the first:

| Slice | What | Status |
| --- | --- | --- |
| [#4](https://github.com/nessalabs/nessa-extensions/issues/4) | `model/`: the definition, validation into a branded `Experiment`, the one formatter, what the views read; `samples/` | This |
| [#5](https://github.com/nessalabs/nessa-extensions/issues/5) | `server/`: the tools, on `@nessalabs/server-kit` | Planned |
| [#6](https://github.com/nessalabs/nessa-extensions/issues/6), [#7](https://github.com/nessalabs/nessa-extensions/issues/7) | `app/`: the components and the app | Planned |

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
```

`server/` and `app/` will both import `model/`; it imports neither. Tests sit
beside what they test.

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
  since the epoch — so the server can return it as a tool's `data`, and the
  app, which receives that `data` from its host, validates it again before it
  draws anything.
- **The harness decides.** Whether a run was kept, which is best (the last of
  `bestSoFar`, or the baseline while it is empty), and why, are the harness's;
  `selections.ts` reads them and never works them out from scores.
- **Numbers are written in `metric.ts`.** A value is `Formatted` text: its
  number to the metric's `decimals`, then its `unit` exactly as given (so a
  definition writes `" ms"` for a space), rounded half away from zero on the
  decimal it reads as: its shortest round-trip digits, rounded exactly in
  `bigint`, the same in every engine. A size — an interval, the noise — is `Formatted` in
  `deltaUnit`, with no sign. A change is a `Change`, made from the two values
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
  better, train and test, a cost guardrail relative to the baseline, five
  areas, six agents, runs settled, running and queued, and a keep decided
  after reruns, which settles after runs made later.
- **`latencySample`**: another kind — p95 latency in milliseconds, lower is
  better, one split, an accuracy guardrail at least a fixed value, no areas,
  no agents, no reference, no budget. If a view needs a change to show it, the
  definition is missing something.
- **`scaleSample`**: one run that moves cases out of a million and touches ten
  thousand files.
