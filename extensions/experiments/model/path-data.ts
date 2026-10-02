/**
 * Whether text is SVG path data a browser draws in full: the `d` grammar of
 * SVG 1.1 and SVG 2 (https://www.w3.org/TR/SVG2/paths.html#PathDataBNF). It
 * is a moveto first, then commands, each followed by whole sets of its
 * numbers — two for a line, six for a curve, seven for an arc, whose two flags
 * are each `0` or `1` — separated by spaces or one comma. A browser stops
 * drawing a path at its first error, so text that only uses the right
 * characters, such as `M0 0 L`, is refused (`path-data.test.ts`).
 */

/** How many numbers each command takes, per set. */
const numbersPerSet: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
}

const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const space = /^[ \t\n\f\r]*/
const separator = /^[ \t\n\f\r]*,?[ \t\n\f\r]*/

export function isPathData(text: string): boolean {
  let rest = text.replace(space, "")
  if (rest === "") return false
  let first = true
  while (rest !== "") {
    const command = rest.charAt(0).toLowerCase()
    if (!Object.hasOwn(numbersPerSet, command)) return false
    if (first && command !== "m") return false
    first = false
    rest = rest.slice(1).replace(space, "")
    const count = numbersPerSet[command] ?? 0
    if (count === 0) continue
    // One set at least, then as many more as follow.
    for (let set = 0; ; set += 1) {
      if (set > 0) {
        const after = rest.replace(separator, "")
        if (!number.test(after)) {
          // No further set: the next command, or the end. (A comma before a
          // command is then read as one, and refused.)
          rest = rest.replace(space, "")
          break
        }
        rest = after
      }
      for (let index = 0; index < count; index += 1) {
        if (index > 0) rest = rest.replace(separator, "")
        if (command === "a" && (index === 3 || index === 4)) {
          // An arc's flags: one digit, 0 or 1, which may run into what follows.
          if (rest.charAt(0) !== "0" && rest.charAt(0) !== "1") return false
          rest = rest.slice(1)
          continue
        }
        const match = number.exec(rest)
        if (match === null) return false
        rest = rest.slice(match[0].length)
      }
    }
  }
  return true
}
