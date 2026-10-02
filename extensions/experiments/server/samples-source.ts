/**
 * The samples as a source: the checkout hill-climb, the latency experiment
 * and the one at scale, each dated from the `startedAt` it is given. It is
 * the server's source until a harness serves experiments; the harness plugs
 * into the same port (`source.ts`), in `main.ts`.
 */
import { checkoutSample, latencySample, scaleSample } from "../samples/index.ts"
import type { ExperimentSource } from "./source.ts"

/** A source of the samples, begun at `startedAt`. */
export function samplesSource(startedAt: number): ExperimentSource {
  const samples = new Map(
    [checkoutSample, latencySample, scaleSample].map((sample) => {
      const input = sample(startedAt)
      return [input.id, input] as const
    }),
  )
  return {
    ids: async () => [...samples.keys()],
    experiment: async (id) => samples.get(id),
    // A sample records what a run changed, not the files themselves.
    openFile: async () => ({
      kind: "unavailable",
      reason: "The samples record what a run changed, not the files' contents.",
    }),
  }
}
