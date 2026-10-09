/**
 * The extension's build: the server, `server/main.ts`, bundled into
 * `dist/main.js`, and the app, `app/index.html`, inlined into `dist/app/index.html`
 * by `@nessalabs/app-shell/build`. The server is built first and empties
 * `dist`; the app is built second and leaves the server bundle in place.
 * Vite names the page `dist/app/index.html`, after its source path.
 *
 * The app plugin applies only to the client build: it requires exactly one
 * HTML file, which the server build does not have. It is a post plugin so it
 * runs after Vite has emitted that HTML. Its `config` hook does not run on a
 * per-environment plugin, so the client environment states the same build
 * options that hook would: one script, styles and assets inline.
 */
import { defineConfig, type Plugin } from "vite"

import { mcpApp } from "@nessalabs/app-shell/build"

function experimentsApp(): Plugin {
  return {
    name: "experiments-app",
    enforce: "post",
    applyToEnvironment(environment) {
      if (environment.name !== "client") return false
      const inner = mcpApp()
      return {
        name: inner.name,
        apply: "build",
        buildStart(options) {
          const start = inner.buildStart
          if (start === undefined) return
          const handler = typeof start === "function" ? start : start.handler
          return handler.call(this, options)
        },
        generateBundle(options, bundle, isWrite) {
          const emit = inner.generateBundle
          if (emit === undefined) return
          const handler = typeof emit === "function" ? emit : emit.handler
          return handler.call(this, options, bundle, isWrite)
        },
      }
    },
  }
}

export default defineConfig({
  base: "./",
  plugins: [experimentsApp()],
  environments: {
    client: {
      consumer: "client",
      build: {
        outDir: "dist",
        emptyOutDir: false,
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        rolldownOptions: {
          input: { index: "app/index.html" },
          output: { codeSplitting: false },
        },
      },
    },
    server: {
      consumer: "server",
      resolve: { noExternal: true },
      build: {
        target: "node24",
        outDir: "dist",
        emptyOutDir: true,
        rolldownOptions: {
          input: "server/main.ts",
          output: { entryFileNames: "main.js" },
        },
      },
    },
  },
  builder: {
    buildApp: async (builder) => {
      const server = builder.environments.server
      const client = builder.environments.client
      if (server === undefined || client === undefined) {
        throw new Error("the experiments build needs its server and client environments")
      }
      await builder.build(server)
      await builder.build(client)
    },
  },
})
