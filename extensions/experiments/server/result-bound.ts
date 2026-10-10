/**
 * The most bytes of JSON a tool's structured result may be. A host keeps a
 * structured result only up to this, and drops a larger one whole — the app
 * then has no experiment. 16,384 is that bound (Nessa's conversation view).
 * Text still stands on its own when the structured result is refused.
 */
export const structuredResultBytes = 16_384

/** Whether `data` would be dropped whole by a host that keeps this bound. */
export function structuredResultTooLarge(data: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(data)) > structuredResultBytes
}
