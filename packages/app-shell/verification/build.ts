/// <reference types="node" />
/**
 * Builds what the browser runs: the fixture app into its one HTML file with
 * the shell's own plugin (`mcpApp`), and the two host pages. Playwright's
 * global setup; its output is `verification/dist`, which `serve` in the spec
 * serves.
 */
import { fileURLToPath } from "node:url"

import { build } from "vite"

import { mcpApp } from "../src/build/index.ts"

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export const dist = at("./dist/")

export default async function buildForBrowsers() {
  await build({
    root: at("../fixture/"),
    configFile: false,
    logLevel: "warn",
    plugins: [mcpApp()],
    build: { outDir: at("./dist/app/"), emptyOutDir: true },
  })
  await build({
    root: at("./hosts/"),
    configFile: false,
    logLevel: "warn",
    base: "./",
    build: {
      outDir: at("./dist/hosts/"),
      emptyOutDir: true,
      rolldownOptions: {
        input: { fake: at("./hosts/fake.html"), reference: at("./hosts/reference.html") },
      },
    },
  })
}
