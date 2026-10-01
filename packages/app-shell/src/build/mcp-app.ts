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
 * bundle, a file in the public directory, which Vite copies beside the
 * bundle rather than into it — since a host's default policy would refuse
 * it. A URL in another element (an `<img src>` to a public file) is not read
 * here; the host's policy refuses it at run time, and the browser
 * verification runs the app under that policy.
 */
/// <reference types="node" />
import { existsSync, readdirSync } from "node:fs"

import type { Plugin } from "vite"

import { inlineIntoHtml } from "./inline.ts"

export function mcpApp(): Plugin {
  let publicDir = ""
  return {
    name: "nessa:mcp-app",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir
    },
    buildStart() {
      if (
        publicDir !== "" &&
        existsSync(publicDir) &&
        readdirSync(publicDir).length > 0
      ) {
        this.error(
          `${publicDir} has files, which Vite copies beside the app for it to fetch; import them instead`,
        )
      }
    },
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
      const result = inlineIntoHtml(html, files, page.fileName)
      if (result.unresolved.length > 0) {
        this.error(
          `the HTML names what is not a file of the build: ${result.unresolved.join(", ")}. A page's tags can name only the app's own files: a host's default policy fetches nothing, and a resource from an origin the app declares in _meta.ui.csp is loaded at run time, not by the page's tags`,
        )
      }
      if (result.unsafe.length > 0) {
        this.error(
          `these cannot be written inline as they are — their text holds its closing tag, or "<!--" with "<script" (write "<\\/script"), or their tag carries an attribute that would mean nothing inline: ${result.unsafe.join(", ")}`,
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
