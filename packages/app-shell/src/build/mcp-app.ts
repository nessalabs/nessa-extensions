/**
 * The Vite plugin that builds an app into one HTML file: its resource,
 * `text/html;profile=mcp-app`. Add it to the app's Vite build:
 *
 * ```ts
 * export default defineConfig({ plugins: [mcpApp()] })
 * ```
 *
 * It sets the build to make one script and one stylesheet, with every asset
 * written in as a `data:` URL, then writes the script and stylesheet into the
 * HTML (`inlineIntoHtml`). The build fails if anything is left that the HTML
 * would have to fetch — a second chunk, a file it names that is not in the
 * bundle — since a host's default policy would refuse it.
 */
import type { Plugin } from "vite"

import { inlineIntoHtml } from "./inline.ts"

export function mcpApp(): Plugin {
  return {
    name: "nessa:mcp-app",
    apply: "build",
    enforce: "post",
    config: () => ({
      base: "./",
      build: {
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
    generateBundle(_, bundle) {
      const pages = Object.values(bundle).filter(
        (file) => file.type === "asset" && file.fileName.endsWith(".html"),
      )
      if (pages.length !== 1) {
        this.error(`an MCP App is one HTML file; this build has ${pages.length}`)
      }
      const page = pages[0]
      if (page === undefined || page.type !== "asset") return
      const files = new Map<string, string>()
      for (const file of Object.values(bundle)) {
        if (file === page) continue
        if (file.type === "chunk") files.set(file.fileName, file.code)
        else if (typeof file.source === "string") files.set(file.fileName, file.source)
      }
      const html =
        typeof page.source === "string"
          ? page.source
          : new TextDecoder().decode(page.source)
      const result = inlineIntoHtml(html, files)
      if (result.unresolved.length > 0) {
        this.error(
          `the HTML names files the build did not make: ${result.unresolved.join(", ")}`,
        )
      }
      const left = Object.keys(bundle).filter(
        (name) => name !== page.fileName && !result.inlined.has(name),
      )
      if (left.length > 0) {
        this.error(
          `these would be fetched, which a host's policy refuses: ${left.join(", ")}`,
        )
      }
      for (const name of result.inlined) delete bundle[name]
      page.source = result.html
    },
  }
}
