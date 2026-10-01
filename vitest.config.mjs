import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

import { unitProjects } from "./scripts/boundary/vitest.mjs"

// Each unit's tests run as a project of their own, held to what the unit may
// use (scripts/boundary/vitest.mjs).
export default defineConfig({
  test: {
    projects: unitProjects(
      realpathSync.native(fileURLToPath(new URL(".", import.meta.url))),
    ),
  },
})
