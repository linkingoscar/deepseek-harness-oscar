/**
 * Offline reconstruction of one model request's Harness-owned inputs from the
 * durable session log.
 *
 * The projection deliberately stops at the Harness/provider boundary: it owns
 * the recorded request header and canonical model-visible surface, not hidden
 * provider framing, provider-side cache state, or external world state.
 *
 * @module @deepseek-ai/dsh-session/replay-request
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldSurface } from './surface.ts'
import type { EpochHeader, SessionEvent } from './types.ts'

/** Stable step identity surrounding a reconstructed request when present in the log. */
export interface ReplayRequestStep {
  /** Turn number from the latest preceding `step/start`. */
  turn: number
  /** Step number from the latest preceding `step/start`. */
  step: number
}

/** Harness-owned inputs that were available when one recorded request was dispatched. */
export interface ReplayRequestSnapshot {
  /** Seq of the `request/header` event anchoring this request. */
  requestHeaderSeq: number
  /** Full Harness-owned request envelope: call config, adapter defaults, system prompt, and tools. */
  header: EpochHeader
  /** Canonical model-visible history after all surface replacements that had occurred before dispatch. */
  messages: readonly Message[]
  /** Turn/step identity when the current-format log contains the surrounding `step/start`. */
  step?: ReplayRequestStep
}

/** Raised when a caller names a seq that cannot anchor a request reconstruction. */
export class ReplayRequestSnapshotError extends Error {
  /**
   * @param message - Human-readable reconstruction failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ReplayRequestSnapshotError'
  }
}

/** Resolve the request/header event to reconstruct, or return undefined when a latest request does not exist. */
function resolveRequestHeader(
  events: readonly SessionEvent[],
  requestedSeq: number | undefined,
): SessionEvent<'request/header'> | undefined {
  if (requestedSeq === undefined) {
    return events.findLast((event): event is SessionEvent<'request/header'> => event.type === 'request/header')
  }
  if (!Number.isSafeInteger(requestedSeq) || requestedSeq < 0 || requestedSeq >= events.length) {
    throw new ReplayRequestSnapshotError(
      `request header seq ${String(requestedSeq)} must identify an existing non-negative event (last seq: ${events.length - 1})`,
    )
  }
  const event = events[requestedSeq]
  if (event?.seq !== requestedSeq) {
    throw new ReplayRequestSnapshotError(
      `session log is not contiguous at request header index ${requestedSeq} (event seq: ${String(event?.seq)})`,
    )
  }
  if (event.type !== 'request/header') {
    throw new ReplayRequestSnapshotError(
      `event at seq ${requestedSeq} is ${JSON.stringify(event.type)}, not "request/header"`,
    )
  }
  return event
}

/**
 * Reconstruct the latest request, or one request named by its durable
 * `request/header` seq, without executing a model, tool, hook, or external
 * effect.
 *
 * The canonical surface is folded only through the selected header. Later
 * assistant/tool output, compaction, or injected context therefore cannot leak
 * backward into the historical request. `foldSurface()` remains the single
 * source of truth for append/replacement semantics.
 *
 * @param events - Full validated current-format session log in sequence order.
 * @param requestHeaderSeq - Optional exact `request/header` seq; omitted selects the latest recorded request.
 * @returns The Harness-owned request snapshot, or `undefined` when the log contains no request and no seq was requested.
 */
export function reconstructReplayRequest(
  events: readonly SessionEvent[],
  requestHeaderSeq?: number,
): ReplayRequestSnapshot | undefined {
  const headerEvent = resolveRequestHeader(events, requestHeaderSeq)
  if (headerEvent === undefined) return

  const prefix = events.slice(0, headerEvent.seq + 1)
  // Canonical fold also validates contiguity and surface metadata for every
  // event that can influence this historical request.
  const surface = foldSurface(prefix)
  const messages: Message[] = []
  for (const seq of surface.nodes) {
    const event = prefix[seq]
    /* v8 ignore next -- foldSurface only emits seqs from the validated prefix. */
    if (event === undefined) throw new ReplayRequestSnapshotError(`surface references missing event seq ${seq}`)
    const message = deriveEventMessage(event)
    if (message !== null) messages.push(message)
  }
  const stepEvent = prefix.findLast((event): event is SessionEvent<'step/start'> => event.type === 'step/start')

  return Object.freeze({
    requestHeaderSeq: headerEvent.seq,
    header: headerEvent.data.header,
    messages: Object.freeze(messages),
    ...(stepEvent === undefined ? {} : { step: Object.freeze({ ...stepEvent.data }) }),
  })
}
