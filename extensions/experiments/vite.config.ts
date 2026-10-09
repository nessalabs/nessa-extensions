/**
 * The extension's build: the server, `server/main.ts`, bundled into
 * `dist/main.js`, and the app, `app/index.html`, inlined into `dist/app/index.html`
 * by `@nessalabs/app-shell/build`. The server is built first and empties
 * `dist`; the app is built second and leaves the server bundle in place.
 * Vite names the page `dist/app/index.html`, after its source path.
 *
 * The app plugin applies only to the client build: it requires exactly one
 * HTML file, which the server build does not have. It is a post plugin so it
 * runs after Vite has emitted that HTML.
 *
 * Vite ignores `config` and `configResolved` on a plugin returned from
 * `applyToEnvironment`. Those two run here, on the same `mcpApp()` instance
 * whose `buildStart` then sees the public directory and refuses a file in
 * it. `config` is what inlines the script, the styles, and every asset.
 */
import { defineConfig, type Plugin } from "vite"

import { mcpApp } from "@nessalabs/app-shell/build"

function handler<Args extends readonly unknown[], Result>(
  hook: ((...args: Args) => Result) | { handler: (...args: Args) => Result } | undefined,
): ((...args: Args) => Result) | undefined {
  if (hook === undefined) return undefined
  return typeof hook === "function" ? hook : hook.handler
}

function experimentsApp(): Plugin {
  const inner = mcpApp()
  return {
    name: "experiments-app",
    enforce: "post",
    config(config, env) {
      return handler(inner.config)?.call(this, config, env)
    },
    configResolved(config) {
      return handler(inner.configResolved)?.call(this, config)
    },
    applyToEnvironment(environment) {
      if (environment.name !== "client") return false
      return {
        name: inner.name,
        apply: "build",
        enforce: "post",
        buildStart(options) {
          return handler(inner.buildStart)?.call(this, options)
        },
        generateBundle(options, bundle, isWrite) {
          return handler(inner.generateBundle)?.call(this, options, bundle, isWrite)
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
        rolldownOptions: {
          input: { index: "app/index.html" },
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
