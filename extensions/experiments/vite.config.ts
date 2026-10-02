/**
 * The extension's build: its server, `server/main.ts`, bundled with
 * everything it imports — the workspace packages and npm's — into one file,
 * `dist/main.js`, which the package's `bin` runs under Node. It is built as
 * a server environment, so modules resolve as Node resolves them. The app's
 * HTML joins it with #7.
 */
import { defineConfig } from "vite"

export default defineConfig({
  environments: {
    server: {
      consumer: "server",
      resolve: { noExternal: true },
      build: {
        target: "node24",
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
          input: "server/main.ts",
          output: { entryFileNames: "main.js" },
        },
      },
    },
  },
  builder: {
    buildApp: async (builder) => {
      await builder.build(builder.environments.server)
    },
  },
})
