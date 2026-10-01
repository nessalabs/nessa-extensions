/**
 * The test run's guard: Vitest runs each unit's tests as a project of its
 * own, and a plugin judges every module Vite loads for it (`modules.mjs`)
 * against that unit's allow-list. The test fails at the module it may not
 * use.
 *
 * This is Vitest's own module graph, so it holds however the module was
 * named — an import TypeScript could not resolve, a `#` import whose types
 * point elsewhere than its code, `import.meta.glob`, `vi.importActual`, a
 * computed `import()`. Not judged: what Vitest leaves to Node to load — a
 * dependency in `node_modules`, which is npm's.
 *
 *   export default defineConfig({ test: { projects: unitProjects(root) } })
 */
import { join } from "node:path"

import { moduleJudge } from "./modules.mjs"
import { declaredPackages, units } from "./units.mjs"

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
      plugins: [
        {
          name: "nessa:boundary-tests",
          enforce: "pre",
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
