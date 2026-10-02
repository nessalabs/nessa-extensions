/**
 * The experiment view: the `ui://` resource `show_experiment` names. Its HTML
 * is the built app's (#7); until the app is built, it is this placeholder,
 * which says so and nothing more. `experimentsExtension` takes the HTML as a
 * function, so when the app lands, `main.ts` hands it the built file instead.
 */

export const experimentView = "ui://experiments/experiment"

/** The view's document until the app is built (#7). */
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
