import type {
  ConversationPromptSnapshot,
  RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  promptEnvelopeFootprint,
  type PromptEnvelopeFootprint,
} from './prompt-footprint.ts'

type AssistantRequestView = Extract<RequestView, { purpose: 'assistant' }>

export type PromptChangeKind =
  | 'initial'
  | 'system'
  | 'tools'
  | 'system-and-tools'
  | 'inherited'

export interface ContextToolRow {
  name: string
  description: string
  chars: number
}

export interface ContextRequestRow {
  requestNumber: number
  startSeq: number
  turn: number
  step: number
  status: AssistantRequestView['status']
  prompt: ConversationPromptSnapshot
  promptChange: PromptChangeKind
  footprint: PromptEnvelopeFootprint
  inputTokens: number | null
  tools: readonly ContextToolRow[]
}

function serializedChars(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0
}

function finiteTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function requestInputTokens(request: AssistantRequestView): number | null {
  if (typeof request.usage !== 'object' || request.usage === null) return null
  const usage = request.usage as Record<string, unknown>
  if (typeof usage.inputTokens !== 'number' || !Number.isFinite(usage.inputTokens)) return null
  return finiteTokenCount(usage.inputTokens)
    + finiteTokenCount(usage.cacheReadTokens)
    + finiteTokenCount(usage.cacheWriteTokens)
}

/**
 * Derive bounded Context Debugger rows from the same request-inspection window
 * Trajectory already owns. Request numbering includes every inspected request
 * in the loaded window, including compaction requests.
 */
export function contextRequestRows(requests: readonly RequestView[]): readonly ContextRequestRow[] {
  const ordered = [...requests].sort((left, right) => left.startSeq - right.startSeq)
  const rows: ContextRequestRow[] = []
  for (const [index, request] of ordered.entries()) {
    if (request.purpose !== 'assistant' || request.prompt === undefined) continue
    rows.push({
      requestNumber: index + 1,
      startSeq: request.startSeq,
      turn: request.turn,
      step: request.step,
      status: request.status,
      prompt: request.prompt,
      promptChange: request.promptChange?.kind ?? 'inherited',
      footprint: promptEnvelopeFootprint(request.prompt),
      inputTokens: requestInputTokens(request),
      tools: request.prompt.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        chars: serializedChars(tool),
      })),
    })
  }
  return rows
}
