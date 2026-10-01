import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { ESLint } from "eslint"

const cwd = fileURLToPath(new URL("../..", import.meta.url))
const eslint = new ESLint({ cwd })

/** The rule ids ESLint reports for `code` as the file at `path`. */
async function rules(code, path) {
  const [result] = await eslint.lintText(code, { filePath: `${cwd}/${path}` })
  return result.messages.map((message) => message.ruleId)
}

const places = [
  "extensions/experiments/src/x.ts",
  "extensions/experiments/src/x.test.ts",
  "extensions/experiments/vite.config.ts",
  "packages/common/src/x.ts",
]

test("ways Node reaches a file past the guard are refused in every file of a unit", async () => {
  for (const path of places) {
    for (const [code, rule] of [
      [
        `import { createRequire } from "node:module"\nexport const r = createRequire`,
        "no-restricted-imports",
      ],
      [
        `import { createRequire } from "module"\nexport const r = createRequire`,
        "no-restricted-imports",
      ],
      [`export const fs = process.getBuiltinModule("fs")`, "no-restricted-syntax"],
      [`export * from "data:text/javascript,export const x = 1"`, "no-restricted-syntax"],
      [`import "data:text/javascript,1"`, "no-restricted-syntax"],
      [`export const m = import("data:text/javascript,1")`, "no-restricted-syntax"],
      ["export const m = import(`data:text/javascript,${1}`)", "no-restricted-syntax"],
    ]) {
      const found = await rules(code, path)
      assert.ok(found.includes(rule), `${path}: ${code} → ${found}`)
    }
  }
})

test("an ordinary import is not refused", async () => {
  for (const path of places) {
    const found = await rules(
      `import { readFileSync } from "node:fs"\nexport const r = readFileSync`,
      path,
    )
    assert.deepEqual(
      found.filter((id) => id?.startsWith("no-restricted")),
      [],
      path,
    )
  }
})
