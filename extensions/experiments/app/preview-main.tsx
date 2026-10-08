/**
 * The screenshot page: one experiment's components in the fake host. The
 * host sends `{ sample: "checkout" | "latency" }` as the tool input after
 * the bridge connects. This is not the app (#7); it only mounts the preview.
 */
import { nessaUiTokens } from "@nessalabs/app-shell"
import { HostThemeScope, mountApp, useToolInput } from "@nessalabs/app-shell/react"

import { validateExperiment } from "../model/index.ts"
import { checkoutSample, latencySample } from "../samples/index.ts"
import { ExperimentPreview } from "./preview.tsx"
import type { Schedule } from "./use-open-file.ts"

const begun = Date.UTC(2026, 9, 1, 9)

const quiet: Schedule = { after: () => () => {} }

function sampleOf(name: unknown) {
  if (name === "latency") return latencySample(begun)
  if (name === "checkout") return checkoutSample(begun)
  return undefined
}

function PreviewApp() {
  const input = useToolInput()
  const sample = sampleOf(input?.sample)
  if (sample === undefined) return null
  const validated = validateExperiment(sample)
  if (validated.kind !== "valid") return null
  return (
    <HostThemeScope tokens={nessaUiTokens}>
      <ExperimentPreview
        experiment={validated.experiment}
        open={async () => ({ kind: "opened" })}
        schedule={quiet}
      />
    </HostThemeScope>
  )
}

const root = document.getElementById("root")
if (root !== null) {
  mountApp(root, <PreviewApp />, {
    app: { name: "experiments", version: "0.0.0" },
    displayModes: ["inline", "fullscreen"],
  })
}
