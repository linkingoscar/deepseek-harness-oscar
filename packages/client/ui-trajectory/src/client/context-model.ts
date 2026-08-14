import type {
  ConversationPromptSnapshot,
  RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  promptEnvelopeFootprint,
  type PromptEnvelopeFootprint,
} from './prompt-footprint.ts'

type AssistantRequestView = Extract<RequestView, { purpose: 'assistant' }>

/** How the request prompt envelope changed at this request boundary. */
export type PromptChangeKind =
  | 'initial'
  | 'system'
  | 'tools'
  | 'system-and-tools'
  | 'inherited'

/** One model-visible tool summarized for the Context Debugger. */
export interface ContextToolRow {
  name: string
  description: string
  chars: number
}

/** Exact request-to-request growth facts over the loaded assistant-request window. */
export interface ContextGrowth {
  /** Exact change in the reconstructable system string. */
  systemCharsDelta: number
  /** Exact change in the compact serialized tool-schema array. */
  toolSchemaCharsDelta: number
  /** Sum of system + tool-schema character deltas. */
  envelopeCharsDelta: number
  /** Provider-reported request-input delta when both adjacent requests reported usage. */
  inputTokensDelta: number | null
  addedTools: readonly string[]
  removedTools: readonly string[]
  /** Largest positive per-tool schema growth, including newly added tools. */
  largestToolGrowth?: { name: string; charsDelta: number }
}

/** One assistant request projected into the bounded Context Debugger read model. */
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
  /** Delta from the previous loaded assistant request; absent for the first one. */
  growth: ContextGrowth | null
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

function toolCharMap(prompt: ConversationPromptSnapshot): Map<string, number> {
  return new Map(prompt.tools.map(tool => [tool.name, serializedChars(tool)]))
}

function contextGrowth(
  previous: ContextRequestRow,
  footprint: PromptEnvelopeFootprint,
  prompt: ConversationPromptSnapshot,
  inputTokens: number | null,
): ContextGrowth {
  const before = toolCharMap(previous.prompt)
  const after = toolCharMap(prompt)
  const addedTools = [...after.keys()].filter(name => !before.has(name)).sort()
  const removedTools = [...before.keys()].filter(name => !after.has(name)).sort()
  let largestToolGrowth: ContextGrowth['largestToolGrowth']
  for (const [name, chars] of after) {
    const charsDelta = chars - (before.get(name) ?? 0)
    if (charsDelta <= 0) continue
    if (largestToolGrowth === undefined
      || charsDelta > largestToolGrowth.charsDelta
      || (charsDelta === largestToolGrowth.charsDelta && name < largestToolGrowth.name)) {
      largestToolGrowth = { name, charsDelta }
    }
  }
  const systemCharsDelta = footprint.systemChars - previous.footprint.systemChars
  const toolSchemaCharsDelta = footprint.toolSchemaChars - previous.footprint.toolSchemaChars
  return {
    systemCharsDelta,
    toolSchemaCharsDelta,
    envelopeCharsDelta: systemCharsDelta + toolSchemaCharsDelta,
    inputTokensDelta: inputTokens === null || previous.inputTokens === null
      ? null
      : inputTokens - previous.inputTokens,
    addedTools,
    removedTools,
    ...largestToolGrowth === undefined ? {} : { largestToolGrowth },
  }
}

/**
 * Derive bounded Context Debugger rows from the same request-inspection window
 * Trajectory already owns. Request numbering includes every inspected request
 * in the loaded window, including compaction requests. Growth compares adjacent
 * loaded assistant requests only; it never invents a delta across an unloaded
 * history boundary.
 * @param requests - bounded request-inspection records from Trajectory.
 * @returns assistant-request rows in request-sequence order with adjacent growth facts.
 */
export function contextRequestRows(requests: readonly RequestView[]): readonly ContextRequestRow[] {
  const ordered = [...requests].sort((left, right) => left.startSeq - right.startSeq)
  const rows: ContextRequestRow[] = []
  for (const [index, request] of ordered.entries()) {
    if (request.purpose !== 'assistant' || request.prompt === undefined) continue
    const footprint = promptEnvelopeFootprint(request.prompt)
    const inputTokens = requestInputTokens(request)
    const previous = rows.at(-1)
    const row: ContextRequestRow = {
      requestNumber: index + 1,
      startSeq: request.startSeq,
      turn: request.turn,
      step: request.step,
      status: request.status,
      prompt: request.prompt,
      promptChange: request.promptChange?.kind ?? 'inherited',
      footprint,
      inputTokens,
      tools: request.prompt.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        chars: serializedChars(tool),
      })),
      growth: previous === undefined
        ? null
        : contextGrowth(previous, footprint, request.prompt, inputTokens),
    }
    rows.push(row)
  }
  return rows
}
