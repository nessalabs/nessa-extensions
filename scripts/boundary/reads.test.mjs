import assert from "node:assert/strict"
import fs from "node:fs"
import * as named from "node:fs"
import fsp, { readFile as namedReadFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

import { watchReads } from "./reads.mjs"

/** A directory with one file, `read.txt`, removed when the test ends. */
function directory(t) {
  const path = fs.mkdtempSync(join(tmpdir(), "nessa-extensions-reads-"))
  t.after(() => fs.rmSync(path, { recursive: true, force: true }))
  fs.writeFileSync(join(path, "read.txt"), "text")
  return path
}

/** What `use` reads while watched, as the paths the watcher was given. */
async function readsOf(use) {
  const seen = []
  const stop = watchReads((path) => seen.push(String(path)))
  try {
    await use()
  } finally {
    stop()
  }
  return seen
}

test("every way of reading a file by path is seen, in each form", async (t) => {
  const dir = directory(t)
  const file = join(dir, "read.txt")
  const to = (name) => join(dir, name)
  const uses = {
    readFile: () => new Promise((done) => fs.readFile(file, done)),
    readFileSync: () => fs.readFileSync(file),
    "named readFileSync": () => named.readFileSync(file),
    "readFileSync of a URL": () => fs.readFileSync(pathToFileURL(file)),
    createReadStream: () =>
      new Promise((done) => fs.createReadStream(file).on("close", done).resume()),
    open: () => new Promise((done) => fs.open(file, (_, fd) => fs.close(fd, done))),
    openSync: () => fs.closeSync(fs.openSync(file, "r")),
    "openSync read-write": () => fs.closeSync(fs.openSync(file, "r+")),
    "openSync by number": () => fs.closeSync(fs.openSync(file, fs.constants.O_RDONLY)),
    copyFile: () => new Promise((done) => fs.copyFile(file, to("a"), done)),
    copyFileSync: () => fs.copyFileSync(file, to("b")),
    cp: () => new Promise((done) => fs.cp(file, to("c"), done)),
    cpSync: () => fs.cpSync(file, to("d")),
    "promises readFile": () => fsp.readFile(file),
    "named promises readFile": () => namedReadFile(file),
    "promises open": async () => (await fsp.open(file)).close(),
    "promises copyFile": () => fsp.copyFile(file, to("e")),
    "promises cp": () => fsp.cp(file, to("f")),
  }
  for (const [name, use] of Object.entries(uses)) {
    const seen = await readsOf(use)
    assert.ok(
      seen.some((path) => path === file || path === pathToFileURL(file).href),
      `${name} was not seen: ${JSON.stringify(seen)}`,
    )
  }
})

test("a file opened only to write is not a read, and nothing is seen once stopped", async (t) => {
  const dir = directory(t)
  const written = join(dir, "written.txt")
  assert.deepEqual(
    await readsOf(() => {
      fs.closeSync(fs.openSync(written, "w"))
      fs.closeSync(fs.openSync(written, fs.constants.O_WRONLY))
    }),
    [],
  )
  const seen = []
  watchReads((path) => seen.push(path))()
  fs.readFileSync(join(dir, "read.txt"))
  assert.deepEqual(seen, [])
})
