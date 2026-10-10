#!/usr/bin/env node
/**
 * The extension's entry: `npx @nessalabs/experiments` serves it over this
 * process's stdin and stdout. Its experiments are the samples, dated from
 * when it starts; a harness plugs in here, as another `ExperimentSource`
 * (`source.ts`).
 */
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { serveOverStdio } from "@nessalabs/server-kit"

import { experimentsExtension } from "./extension.ts"
import { samplesSource } from "./samples-source.ts"

/**
 * The built app. Vite writes it at `dist/app/index.html`, beside this file
 * once it is bundled (`./app/index.html`) and one directory up when this
 * file is run as source.
 */
function readAppHtml(): string {
  const candidates = [
    fileURLToPath(new URL("./app/index.html", import.meta.url)),
    fileURLToPath(new URL("../dist/app/index.html", import.meta.url)),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (found === undefined) {
    throw new Error(
      "the experiment app is not built (dist/app/index.html). Run pnpm build.",
    )
  }
  return readFileSync(found, "utf8")
}

// Read at startup. A missing app fails here, not on the first resources/read.
const appHtml = readAppHtml()

serveOverStdio(
  experimentsExtension({
    source: samplesSource(Date.now()),
    html: () => appHtml,
  }),
  // stdout is the protocol's; what goes wrong is said on stderr.
  { onerror: (error) => console.error(error) },
)
