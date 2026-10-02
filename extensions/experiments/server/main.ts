#!/usr/bin/env node
/**
 * The extension's entry: `npx @nessalabs/experiments` serves it over this
 * process's stdin and stdout. Its experiments are the samples, dated from
 * when it starts; a harness plugs in here, as another `ExperimentSource`
 * (`source.ts`).
 */
import { serveOverStdio } from "@nessalabs/server-kit"

import { experimentsExtension } from "./extension.ts"
import { samplesSource } from "./samples-source.ts"
import { placeholderHtml } from "./view.ts"

serveOverStdio(
  experimentsExtension({
    source: samplesSource(Date.now()),
    html: () => placeholderHtml,
  }),
  // stdout is the protocol's; what goes wrong is said on stderr.
  { onerror: (error) => console.error(error) },
)
