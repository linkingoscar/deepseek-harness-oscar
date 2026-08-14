import type { ConversationPromptSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Exact character footprint of one model-request prompt envelope. */
export interface PromptEnvelopeFootprint {
  /** UTF-16 code units in the rendered system prompt string. */
  systemChars: number
  /** Number of model-visible tool schemas. */
  toolCount: number
  /** Characters in the compact JSON serialization of the whole tool-schema array. */
  toolSchemaChars: number
  /** Tool schemas ordered largest-first by their compact JSON serialization. */
  largestTools: readonly PromptToolFootprint[]
}

/** One tool's contribution to the serialized schema surface. */
export interface PromptToolFootprint {
  name: string
  chars: number
}

function serializedChars(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0
}

/**
 * Measure the exact string/JSON character footprint the reconstructed request
 * header exposes. This deliberately does not estimate tokens: provider
 * tokenization and message-history attribution are separate concerns.
 * @param prompt - reconstructed model-request prompt snapshot.
 * @returns exact character counts for the system and model-visible tool schemas.
 */
export function promptEnvelopeFootprint(
  prompt: ConversationPromptSnapshot,
): PromptEnvelopeFootprint {
  const largestTools = prompt.tools
    .map(tool => ({ name: tool.name, chars: serializedChars(tool) }))
    .sort((left, right) => right.chars - left.chars || left.name.localeCompare(right.name))
  return {
    systemChars: prompt.system.length,
    toolCount: prompt.tools.length,
    toolSchemaChars: serializedChars(prompt.tools),
    largestTools,
  }
}

function compactCount(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value / 1_000)}k`
}

/**
 * Render a compact ledger label for a request-header prompt envelope.
 * @param prompt - reconstructed model-request prompt snapshot.
 * @returns human-readable exact character-footprint summary.
 */
export function promptEnvelopeSummary(prompt: ConversationPromptSnapshot): string {
  const footprint = promptEnvelopeFootprint(prompt)
  const largest = footprint.largestTools[0]
  return [
    `${compactCount(footprint.systemChars)} system chars`,
    `${footprint.toolCount} tools / ${compactCount(footprint.toolSchemaChars)} schema chars`,
    ...(largest === undefined
      ? []
      : [`largest ${largest.name} ${compactCount(largest.chars)}`]),
  ].join(' · ')
}
