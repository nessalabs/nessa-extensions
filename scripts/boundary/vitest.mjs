/**
 * The test run's guard: Vitest runs each unit's tests as a project of its
 * own, and a plugin judges every module Vite loads for it (`modules.mjs`)
 * against that unit's allow-list. The test fails at the module it may not
 * use.
 *
 * This is Vitest's own module graph, so it holds however the module was
 * named — an import TypeScript could not resolve, a `#` import whose types
 * point elsewhere than its code, `import.meta.glob`, `vi.importActual`, an
 * `import()` of a computed path. Not judged, and so held by review: what
 * Vitest leaves to Node to load — anything under a `node_modules` directory,
 * a unit's own nested one included, and what it imports in turn — and what a
 * test's code does with Node's full access, such as `createRequire` or an
 * `import()` of a `data:` URL, as for the Vite configuration's code.
 *
 *   export default defineConfig({ test: { projects: unitProjects(root) } })
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

import { moduleJudge } from "./modules.mjs"
import { declaredPackages, units } from "./units.mjs"

/**
 * The experiments kit copies import `@/…`, nessa_ui's alias, and those
 * files are inside the unit. Pointing the alias there does not widen what
 * the guard allows: the resolved file is still judged.
 */
function kitAlias(unitDir) {
  const src = join(unitDir, "app/kit-stand-in/src")
  if (!existsSync(src)) return {}
  return {
    resolve: {
      alias: [{ find: /^@\//, replacement: `${src}/` }],
    },
  }
}

/**
 * One Vitest project per unit under `root` (a real path), each with the
 * guard. Each unit's tests are its `*.test.ts` and `*.test.tsx` files.
 */
export function unitProjects(root) {
  return units(root).map((unit) => {
    const judge = moduleJudge({
      root,
      unit,
      declared: declaredPackages(root, unit),
      base: join(root, unit),
    })
    return {
      ...kitAlias(join(root, unit)),
      plugins: [
        {
          name: "nessa:boundary-tests",
          transform(_code, id) {
            const refusal = judge(id)
            if (refusal !== null) {
              throw new Error(`${unit}: its tests use ${refusal[0]}, ${refusal[1]}`)
            }
            return null
          },
        },
      ],
      test: {
        name: unit,
        root: join(root, unit),
        include: ["**/*.test.{ts,tsx}"],
        environment: "node",
      },
    }
  })
}
