/**
 * An app's built HTML with its scripts and stylesheets written into it, so
 * the app is one file: what its `ui://` resource serves, and what a host's
 * default policy lets run (scripts and styles inline; nothing fetched).
 * Pure: the build plugin (`mcp-app.ts`) gives it the HTML and the bundle's
 * files, and refuses the build on whatever it could not inline.
 */

export interface Inlined {
  html: string
  /** The bundle's files now in the HTML. */
  inlined: Set<string>
  /** Each `src` or `href` of a script or stylesheet that names no file of the bundle. */
  unresolved: string[]
  /**
   * Each script that holds both `<!--` and `<script`: written inline, the
   * HTML parser would read it into a state where `</script>` does not end
   * it. Left in place, for the build to refuse.
   */
  unsafe: string[]
}

/**
 * Code that cannot end its element early. `</script` becomes `<\/script`,
 * which reads the same inside a string, a template, a comment or a regular
 * expression (where a bare `/` could not stand anyway). `<!--` is not
 * rewritten — it means something in code (`a<!--b`, a regular expression) —
 * so a script that also holds `<script` is refused instead (`unsafe`).
 */
const inScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1")
const opensDoubleEscape = (code: string) => code.includes("<!--") && /<script/i.test(code)
const inStyle = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1")

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag)
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3])
}

/** A built file's name from how the HTML refers to it: `./assets/x.js` or `/assets/x.js`. */
const fileName = (reference: string) => reference.replace(/^\.?\//, "")

/**
 * `html` with each `<script src>` and `<link rel="stylesheet">` that names a
 * file in `files` replaced by the file's contents, and each
 * `<link rel="modulepreload">` of one removed.
 */
export function inlineIntoHtml(
  html: string,
  files: ReadonlyMap<string, string>,
): Inlined {
  const inlined = new Set<string>()
  const unresolved: string[] = []
  const unsafe: string[] = []
  const take = (reference: string | undefined): string | undefined => {
    if (reference === undefined) return undefined
    const name = fileName(reference)
    const contents = files.get(name)
    if (contents === undefined) unresolved.push(reference)
    else inlined.add(name)
    return contents
  }
  let out = html.replace(/<script\b[^>]*>\s*<\/script>/gi, (tag) => {
    const src = attribute(tag, "src")
    if (src === undefined) return tag
    const code = take(src)
    if (code === undefined) return tag
    if (opensDoubleEscape(code)) {
      unsafe.push(src)
      return tag
    }
    const module = /\stype\s*=\s*["']?module/i.test(tag) ? ' type="module"' : ""
    return `<script${module}>${inScript(code)}</script>`
  })
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attribute(tag, "rel")?.toLowerCase()
    if (rel === "stylesheet") {
      const css = take(attribute(tag, "href"))
      return css === undefined ? tag : `<style>${inStyle(css)}</style>`
    }
    if (rel === "modulepreload") {
      return take(attribute(tag, "href")) === undefined ? tag : ""
    }
    return tag
  })
  return { html: out, inlined, unresolved, unsafe }
}
