/**
 * Reading a source: the one place its answers are checked. Each is parsed
 * into a copy, and only the copy is read from then on — an experiment by
 * `validateExperiment`, the only maker of an `Experiment`; ids and openings
 * by the schemas here. A source that answers something else has failed, and
 * the tool that asked says so.
 */
import { z } from "zod/v4"

import { validateExperiment, type Experiment, type Problem } from "../model/index.ts"
import type { ExperimentSource, FileOpening, FileRequest } from "./source.ts"

/** What reading one experiment found. */
export type Reading =
  | { readonly kind: "ready"; readonly experiment: Experiment }
  /** The source has no experiment with that id; `ids` are those it has. */
  | { readonly kind: "missing"; readonly ids: readonly string[] }
  | { readonly kind: "invalid"; readonly problems: readonly Problem[] }

/** A source's answer that is not what the port says it answers. */
export class SourceError extends Error {
  override readonly name = "SourceError"
}

const ids = z.array(z.string()).readonly()

/** The ids of the experiments `source` has, checked. */
export async function readIds(
  source: ExperimentSource,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const parsed = ids.safeParse(await source.ids(signal))
  if (!parsed.success) {
    throw new SourceError(
      `the source listed its experiments wrongly: ${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data
}

/** The experiment `id` from `source`, validated. */
export async function readExperiment(
  source: ExperimentSource,
  id: string,
  signal: AbortSignal,
): Promise<Reading> {
  const held = await source.experiment(id, signal)
  if (held === undefined) {
    const known = await readIds(source, signal)
    if (known.includes(id)) {
      throw new SourceError(
        `the source lists experiment ${JSON.stringify(id)} but has none`,
      )
    }
    return { kind: "missing", ids: known }
  }
  const validation = validateExperiment(held)
  if (validation.kind === "invalid") return validation
  if (validation.experiment.id !== id) {
    throw new SourceError(
      `the source answered experiment ${JSON.stringify(validation.experiment.id)} for ${JSON.stringify(id)}`,
    )
  }
  return { kind: "ready", experiment: validation.experiment }
}

/**
 * A link a host may open: `http` or `https` only. A source is not trusted,
 * and a `javascript:` or `data:` URL handed to `ui/open-link` would run what
 * the source wrote; an editor's own scheme would be a decision of its own.
 */
const link = z.url({ protocol: /^https?$/ })

const opening = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("link"), url: link }).readonly(),
  z
    .strictObject({
      kind: z.literal("download"),
      name: z.string().regex(/\S/),
      mimeType: z.string().regex(/\S/),
      text: z.string(),
    })
    .readonly(),
  z
    .strictObject({ kind: z.literal("unavailable"), reason: z.string().regex(/\S/) })
    .readonly(),
])

/** How `source` opens `request`'s file, checked. */
export async function readOpening(
  source: ExperimentSource,
  request: FileRequest,
  signal: AbortSignal,
): Promise<FileOpening> {
  const parsed = opening.safeParse(await source.openFile(request, signal))
  if (!parsed.success) {
    throw new SourceError(
      `the source answered how to open a file wrongly: ${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data
}
