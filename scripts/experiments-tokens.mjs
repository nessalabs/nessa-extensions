/**
 * Writes the experiments app's token defaults from nessa_ui's theme.css at
 * the commit `packages/app-shell/src/theming/nessa-ui-tokens.ts` names.
 * The app's sources say which custom properties to keep. The output is
 * `extensions/experiments/app/tokens.css`. Do not edit that file.
 *
 *   node scripts/experiments-tokens.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const pin = "e02b577a74ed99ba05c8bfba58c8984b881c3a69"
const root = join(import.meta.dirname, "..")
const app = join(root, "extensions/experiments/app")
const out = join(app, "tokens.css")

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    return entry.isFile() &&
      /\.(?:css|tsx?)$/.test(entry.name) &&
      entry.name !== "tokens.css"
      ? [path]
      : []
  })
}

function used() {
  const names = new Set()
  const pattern = /var\(\s*(--[A-Za-z0-9-]+)/g
  for (const path of files(app)) {
    const text = readFileSync(path, "utf8")
    for (const match of text.matchAll(pattern)) names.add(match[1])
  }
  return names
}

function strip(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

function blockAt(css, start) {
  const open = css.indexOf("{", start)
  if (open < 0) throw new Error(`no block after ${start}`)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    const char = css[index]
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error("unbalanced block")
}

function declarations(block, keep) {
  const lines = []
  for (const match of block.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (keep.has(match[1])) lines.push(`  ${match[1]}: ${match[2].trim()};`)
  }
  const scheme = block.match(/color-scheme\s*:\s*([^;]+);/)
  return { scheme: scheme?.[1].trim(), lines }
}

const keep = used()
const theme = strip(
  await fetch(
    `https://raw.githubusercontent.com/nessalabs/nessa_ui/${pin}/packages/react/src/theme.css`,
  ).then((response) => {
    if (!response.ok) throw new Error(`theme.css: ${response.status}`)
    return response.text()
  }),
)

const light = declarations(blockAt(theme, theme.indexOf(":root")), keep)
const lightScheme = declarations(
  blockAt(theme, theme.indexOf(':where([data-nessa-mode="light"])')),
  keep,
)
const darkStart = theme.indexOf(':where([data-nessa-mode="dark"])')
const dark = declarations(blockAt(theme, darkStart), keep)

const found = new Set(
  [...light.lines, ...dark.lines].map((line) => line.match(/(--[A-Za-z0-9-]+)/)?.[1]),
)
const missing = [...keep].filter((name) => !found.has(name))
if (missing.length > 0) throw new Error(`missing from the pin: ${missing.join(", ")}`)

const css = `/*
 * Generated from nessa_ui packages/react/src/theme.css at ${pin}, the
 * commit packages/app-shell/src/theming/nessa-ui-tokens.ts names.
 * Regenerate with node scripts/experiments-tokens.mjs. Do not edit.
 */
:root {
  color-scheme: ${lightScheme.scheme ?? "light"};
${light.lines.join("\n")}
}

:where([data-nessa-mode="dark"]) {
  color-scheme: ${dark.scheme ?? "dark"};
${dark.lines.join("\n")}
}
`
writeFileSync(out, css)
console.log(`wrote ${out} (${keep.size} tokens)`)
