import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["{packages,extensions}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
})
