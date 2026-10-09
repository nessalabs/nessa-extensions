/**
 * The experiment view: the `ui://` resource `show_experiment` names. The bin
 * (`main.ts`) serves the built app. This placeholder is what the server tests
 * hand the extension when they are not serving that file.
 */

export const experimentView = "ui://experiments/experiment"

/**
 * A document the server tests hand the extension. The bin serves the built
 * app (`main.ts`); it does not serve this.
 */
export const placeholderHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Experiment</title>
  </head>
  <body>
    <p>The experiment view is not built yet.</p>
  </body>
</html>
`
