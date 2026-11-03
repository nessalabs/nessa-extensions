---
id: "ext-inventory"
title: "Find every feature owner"
kind: "guide"
status: "implemented"
summary: "This inventory maps the workspace's source responsibilities and reachable features at the recorded revision. It distinguishes the current executable, reusable library APIs, development fixtures and future integrations. A source owner in this table is not a claim that every branch has a formal model."
parent: "nessa-extensions"
sources: ["pnpm-workspace.yaml", "packages/app-shell/src/index.ts", "packages/app-shell/src/react/index.ts", "packages/server-kit/src/index.ts", "extensions/experiments/model/index.ts", "extensions/experiments/app/index.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Find every feature owner

This inventory maps the workspace's source responsibilities and reachable features at the recorded revision. It distinguishes the current executable, reusable library APIs, development fixtures and future integrations. A source owner in this table is not a claim that every branch has a formal model.

| Surface and ownership | Reader destination | Evidence or scope |
| --- | --- | --- |
| experiments/server/main, built HTML and samples-source | [Current entry](running.md) | Implemented stdio sample executable; no HTTP CLI or published package established. |
| app-shell bridge/bridge and protocol envelope/narrow/transport | [Connect](services/app-shell/connection.md), [requests](services/app-shell/requests.md) | Unit and reference conformance tests; selected connection model. |
| bridge/tool-call and notification input/result hooks | [Opening call](services/app-shell/tool-call.md) | Pure reducer ordering tests; replacement values, no stored call database. |
| React provider/mount/hooks, resize and theming | [Presentation](services/app-shell/presentation.md) | React/size/theme tests and Chromium/WebKit host fixture. |
| server-kit definition and checked registry | [Definitions](services/server-kit/definitions.md) | Construction, copying, schema and invalid-outcome tests. |
| server-kit server/negotiation | [Visibility](services/server-kit/negotiation.md) | Modern per-request and legacy connection tests; no authentication claim. |
| server-kit stdio/HTTP/testing entry | [Transports](services/server-kit/transports.md) | Loopback protocol tests; HTTP API is not wired into the experiments bin. |
| ExperimentApp opening/recovery, display mode, snapshot token | [Open view](services/experiments/display.md) | Host-data and app integration tests; actual current app. |
| Overview/card/sparkline/climb/path/swarm/notes | [Progress](services/experiments/overview.md) | Geometry/readers/component tests; harness decisions displayed. |
| Areas/map/cards and conditional tab | [Areas](services/experiments/overview.md) | No areas means no Areas tab; hover/selection hooks. |
| Surface/navigation/runs/detail/lineage, later body acceptance | [Runs](services/experiments/runs.md) | Navigation and app tests; active and snapshot-scoped requests. |
| Case results, slices, moved-page counts | [Cases](services/experiments/changes.md) | Domain validation and component readers, not full evaluation data. |
| Changed files, query reset, virtual list, whole change | [Changes](services/experiments/changes.md) | Query/hook/component tests and large browser fixture. |
| open-file/use-open-file/useHostOpen and host-data | [File openings](services/experiments/opening.md) | Selected stale-effect model; no download implementation or undo. |
| model values/definition/experiment/validation/slice/path-data | [Records](services/experiments/records.md) | Immutable JSON contract and cross-field tests, no invented lifecycle. |
| model metric/selections and UI geometry/reading/count/series | [Records](services/experiments/records.md), [progress](services/experiments/overview.md) | Exact formatting, direction/noise, best/path/lineage and plotted geometry tests. |
| server source/reading/extension/text/result-bound | [Tool data](services/experiments/data.md) | Five tools; checked source, bounded standalone text and opening fallback. |
| server paging and app paged-call | [Large reads](services/experiments/paging.md) | Selected assembly model; wire-size and Unicode regressions. |
| app-shell fake host/frame/CSP/memory channel/conformance | [Development hosts](development.md) | Test-only peers; reference SDK and browser suites. |
| app-shell build/inline, extension Vite/CSP entry | [Build](build.md) | Single HTML resource and strict sandbox tests. |
| architecture and boundary scripts | [Build boundaries](build.md) | Architecture, real-path/typecheck, staged build and test guard regressions. |
| app kit-stand-in and tokens | [Build](build.md) | Pinned temporary copied design-system source; byte equality test. |
| packages/common | [Build](build.md) | Empty placeholder; no current feature. |
| fixtures/preview and verification/capture/large drivers | [Evidence](verification.md), [development](development.md) | Standalone development surfaces; historical real-host acceptance kept separate. |
| Real experiment harness, remote authenticated serving and npm release | [Current entry](running.md) | Not supplied by the current executable; requires external implementation/composition. |

Tests sit beside their owners. The [evidence page](verification.md) reports which commands actually ran, and the review record will identify the independent sample of reader journeys and source/model checks. The public barrels and directory owners above cover the app-shell, server-kit and experiments surfaces; vendored design-system internals are documented as a pinned dependency, not recast as independent extension features.
