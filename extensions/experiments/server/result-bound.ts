/**
 * The most bytes of JSON Nessa's conversation view keeps of the opening
 * tool result. A larger structured result is dropped whole (`<=` keeps
 * 16,384). The text stays. This is that view only: a call the app makes
 * itself is a different bound, 56KB of the whole result, which the host
 * enforces.
 */
export const structuredResultBytes = 16_384

/** Whether `data` would be dropped whole from the opening tool result. */
export function structuredResultTooLarge(data: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(data)) > structuredResultBytes
}
