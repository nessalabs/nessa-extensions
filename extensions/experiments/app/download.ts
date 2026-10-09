/**
 * Offering a download the server sent as text. The app does it: MCP Apps has
 * no download request, and the file never leaves the sandbox except as the
 * browser's own download. `name` is the suggested file name.
 */

export interface DownloadFile {
  readonly name: string
  readonly mimeType: string
  readonly text: string
}

export function saveDownload(file: DownloadFile): void {
  const blob = new Blob([file.text], { type: file.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke after the click has started the download. Revoking in this turn
  // drops the blob before the browser reads it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
