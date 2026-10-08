/**
 * A verdict as the definition wrote it: the label and the tone, on a status
 * mark. The view does not know what the verdict means.
 */
import { StatusLabel } from "./stand-in.tsx"
import type { Tone } from "../model/index.ts"
import "./verdict-label.css"

export function VerdictLabel({
  label,
  tone,
}: {
  readonly label: string
  readonly tone: Tone
}) {
  return <StatusLabel tone={tone}>{label}</StatusLabel>
}

export function VerdictList({
  verdicts,
}: {
  readonly verdicts: readonly {
    readonly id: string
    readonly label: string
    readonly tone: Tone
  }[]
}) {
  return (
    <ul className="verdicts">
      {verdicts.map((verdict) => (
        <li key={verdict.id}>
          <VerdictLabel label={verdict.label} tone={verdict.tone} />
        </li>
      ))}
    </ul>
  )
}
