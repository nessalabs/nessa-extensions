/**
 * The experiment app's entry. The host renders this document in a sandbox;
 * `mountApp` opens the bridge. The view follows.
 */
import { nessaUiTokens } from "@nessalabs/app-shell"
import { HostThemeScope, mountApp } from "@nessalabs/app-shell/react"

import { ExperimentApp } from "./experiment-app.tsx"
import manifest from "../package.json" with { type: "json" }
import "./experiment.css"

const root = document.getElementById("root")
if (root !== null) {
  mountApp(
    root,
    <HostThemeScope tokens={nessaUiTokens}>
      <ExperimentApp />
    </HostThemeScope>,
    {
      app: { name: manifest.name, version: manifest.version },
      displayModes: ["inline", "fullscreen"],
    },
  )
}
