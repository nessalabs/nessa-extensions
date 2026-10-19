/** A real stdio server for Nessa's isolated large-experiment browser scenario. */
import { readFileSync } from "node:fs"
import { serveOverStdio } from "@nessalabs/server-kit"
import { experimentsExtension } from "../server/extension.ts"
import { scaleSample } from "../samples/index.ts"

const sample = scaleSample(Date.UTC(2026, 9, 1))
const html = readFileSync(new URL("../dist/app/index.html", import.meta.url), "utf8")
serveOverStdio(
  experimentsExtension({
    source: {
      ids: async () => [sample.id],
      experiment: async (id) => (id === sample.id ? sample : undefined),
      openFile: async () => ({
        kind: "unavailable",
        reason: "The sample records changes, not file contents.",
      }),
    },
    html: () => html,
  }),
  { onerror: (error) => console.error(error) },
)
