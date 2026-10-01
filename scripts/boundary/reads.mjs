/**
 * Every file this process reads through Node's `fs`, reported while watched.
 *
 * A Vite build pulls files in two ways. Modules — scripts, styles, HTML, and
 * anything imported — are resolved and loaded by the bundler, and are in its
 * module graph, which `build.mjs` reads. But some files never enter that
 * graph: an `@import` that the CSS step inlines, an asset that an HTML
 * attribute, a CSS `url()`, or `new URL(…, import.meta.url)` names, and the
 * public directory, which is copied. Vite reads those with Node's `fs`, and
 * this sees them there, whatever spelling or resolver led to them.
 *
 * Watched: `open` and `openSync` when opened for reading, `readFile`, and the
 * source of `copyFile`, `copyFileSync`, and `cpSync`, on `fs`; and `open`,
 * `readFile`, `copyFile`, and `cp` on `fs/promises`. Node's `readFileSync`,
 * `createReadStream`, and callback `cp` open their file through `fs.openSync`
 * or `fs.open`, so they are seen there; `reads.test.mjs` reads through each
 * of them, so a Node release that stops doing so fails it. Not watched: a
 * file descriptor passed instead of a path, which was opened, and so seen,
 * first; and what native code reads through no Node API, which for the
 * bundler is its module graph.
 */
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"

const { O_WRONLY } = fs.constants

/**
 * Whether `open` with these flags reads: anything not write-only. Left out —
 * or the callback in their place — they are `"r"`.
 */
function opensForReading(flags) {
  if (flags === undefined || flags === null || typeof flags === "function") return true
  if (typeof flags === "number") return (flags & 3) !== O_WRONLY
  return /[r+]/.test(String(flags))
}

const watched = [
  [fs, ["readFile", "copyFile", "copyFileSync", "cpSync"]],
  [fs.promises, ["readFile", "copyFile", "cp"]],
]
const opens = [
  [fs, ["open", "openSync"]],
  [fs.promises, ["open"]],
]

/**
 * Calls `seen(path)` with the path of every file read until the returned
 * function is called, which restores `fs`. Paths are as the caller gave them:
 * a string, a `Buffer`, or a `file:` URL.
 */
export function watchReads(seen) {
  const restore = []
  const wrap = (object, name, reads) => {
    const original = object[name]
    object[name] = function (path, ...rest) {
      if (typeof path !== "number" && reads(rest)) seen(path)
      return original.call(this, path, ...rest)
    }
    restore.push(() => {
      object[name] = original
    })
  }
  for (const [object, names] of watched) {
    for (const name of names) wrap(object, name, () => true)
  }
  for (const [object, names] of opens) {
    for (const name of names) wrap(object, name, ([flags]) => opensForReading(flags))
  }
  syncBuiltinESMExports()
  return () => {
    for (const undo of restore) undo()
    syncBuiltinESMExports()
  }
}
