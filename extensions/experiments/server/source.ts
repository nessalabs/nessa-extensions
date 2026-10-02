/**
 * Where the server's experiments come from: the port a source plugs into, as
 * the standards' seams at the process boundary describe. The samples are one
 * source (`samples-source.ts`); a real harness is another, written to this
 * same port and handed to `experimentsExtension` in `main.ts`.
 *
 * What a source hands over is not trusted. Every answer is parsed into a copy
 * by `reading.ts` before anything reads it, so a source cannot hand the
 * server an experiment `validateExperiment` did not make, or an opening it
 * did not check.
 */

/** A run's change, or one file of it, to open. */
export interface FileRequest {
  readonly experimentId: string
  readonly runId: string
  /** One of the run's changed files; absent for the run's whole change. */
  readonly path?: string
}

/**
 * How a source opens a file: a link the app hands to its host's
 * `ui/open-link`, contents the app offers as a download, or why it cannot.
 */
export type FileOpening =
  | { readonly kind: "link"; readonly url: string }
  | {
      readonly kind: "download"
      readonly name: string
      readonly mimeType: string
      readonly text: string
    }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface ExperimentSource {
  /** The ids of the experiments it has. */
  ids(signal: AbortSignal): Promise<readonly string[]>
  /**
   * What it holds for the experiment `id`, as it holds it, or `undefined`
   * when it has none. The server validates it before reading it.
   */
  experiment(id: string, signal: AbortSignal): Promise<unknown>
  /**
   * How to open `request`'s file. Asked only for a run the experiment has,
   * and a path its change lists.
   */
  openFile(request: FileRequest, signal: AbortSignal): Promise<FileOpening>
}
