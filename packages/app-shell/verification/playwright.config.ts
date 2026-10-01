/// <reference types="node" />
/**
 * The app shell's browser verification: the fixture app in the fake host and
 * in the reference SDK's host, in Chromium and WebKit. Not a CI gate (the
 * standards' "browser verification for UI"): run it with `pnpm verify` in
 * this package when the shell's UI-facing behaviour changes, and put its
 * numbers in the pull request.
 */
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./build.ts",
  reporter: [["list"]],
  outputDir: "./dist/test-results",
  fullyParallel: true,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
})
