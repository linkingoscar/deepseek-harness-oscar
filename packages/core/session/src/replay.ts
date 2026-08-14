/**
 * Replay-semantics inspection over a validated current-format session log.
 *
 * This module deliberately separates durable evidence from execution support:
 * an event log can prove that a request envelope and model-visible history are
 * reconstructable without proving that live effects can be reproduced.
 *
 * @module @deepseek-ai/dsh-session/replay
 */

import { reconstructReplayRequest } from './replay-request.ts'
import type { ReplayRequestSnapshot } from './replay-request.ts'
import type { EpochHeader, SessionEvent } from './types.ts'

/** Replay modes the Oscar fork distinguishes instead of collapsing into one ambiguous "replay" operation. */
export type ReplayMode =
  | 'transcript'
  | 'request-reconstruction'
  | 'simulated'
  | 'live-fork'
  | 'reproducible'

/** Whether the current durable evidence and shipped executor make a replay mode usable. */
export type ReplayAvailability = 'available' | 'conditional' | 'unavailable'

/** Whether choosing the mode itself can lead to fresh external effects. */
export type ReplayEffectSemantics = 'none' | 'live-if-executed'

/** Machine-readable reasons a replay mode is not fully available. */
export type ReplayBlockerCode =
  | 'NO_REQUEST_HEADER'
  | 'OPEN_TURN'
  | 'LIVE_SOURCE_REQUIRED'
  | 'SIMULATED_EXECUTOR_NOT_IMPLEMENTED'
  | 'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED'
  | 'EXTERNAL_STATE_NOT_SNAPSHOTTED'
  | 'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'

/** One mode's current support contract. */
export interface ReplayCapability {
  /** The replay mode being described. */
  mode: ReplayMode
  /** Current support level, kept separate from the evidence fields below. */
  availability: ReplayAvailability
  /** Whether using the mode can cause fresh external effects. */
  effects: ReplayEffectSemantics
  /** Stable machine-readable blockers or requirements. */
  blockers: readonly ReplayBlockerCode[]
}

/** Offline replay evidence derived from one log prefix. */
export interface ReplayInspection {
  /** Inclusive inspected event sequence, or `null` for an empty log/prefix. */
  boundary: number | null
  /** Number of durable events in the inspected prefix. */
  eventCount: number
  /** Whether the prefix ends outside an open turn and is therefore boundary-compatible with `SessionStore.fork()`. */
  stableForkBoundary: boolean
  /** Seq of the latest reconstructable `request/header` in the prefix, when one exists. */
  latestRequestHeaderSeq?: number
  /** Harness-owned request envelope retained as a convenience projection of {@link requestSnapshot}. */
  requestHeader?: EpochHeader
  /** Latest complete Harness-owned request snapshot: envelope plus canonical model-visible messages. */
  requestSnapshot?: ReplayRequestSnapshot
  /** Per-mode evidence/executor contract. */
  modes: Readonly<Record<ReplayMode, ReplayCapability>>
}

/** Error raised when an inspection boundary does not name a contiguous event in the supplied full log. */
export class ReplayInspectionError extends Error {
  /**
   * @param message - Human-readable inspection-boundary failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ReplayInspectionError'
  }
}

/** Resolve and validate the inclusive inspection boundary. */
function resolveBoundary(events: readonly SessionEvent[], requested: number | undefined): number | null {
  if (events.length === 0) {
    if (requested === undefined) return null
    throw new ReplayInspectionError(`replay boundary ${String(requested)} does not exist in an empty session log`)
  }
  const boundary = requested ?? events.length - 1
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary >= events.length) {
    throw new ReplayInspectionError(
      `replay boundary ${String(boundary)} must be an existing non-negative event seq (last seq: ${events.length - 1})`,
    )
  }
  for (let index = 0; index <= boundary; index++) {
    if (events[index]?.seq !== index) {
      throw new ReplayInspectionError(
        `replay prefix is not contiguous at index ${index} (event seq: ${String(events[index]?.seq)})`,
      )
    }
  }
  return boundary
}

/** Build one immutable capability record. */
function capability(
  mode: ReplayMode,
  availability: ReplayAvailability,
  effects: ReplayEffectSemantics,
  blockers: readonly ReplayBlockerCode[] = [],
): ReplayCapability {
  return Object.freeze({ mode, availability, effects, blockers: Object.freeze([...blockers]) })
}

/**
 * Inspect what replay claims are justified by a validated current-format log
 * prefix without executing a model, tool, or external effect.
 *
 * `request-reconstruction` is available only when the latest recorded request
 * can be rebuilt as both its Harness-owned request envelope and the canonical
 * model-visible messages that preceded that header. It does not claim ownership
 * of provider-added hidden framing or provider-side state.
 *
 * `live-fork` is intentionally `conditional` even at a stable boundary: the
 * offline log proves the prefix is fork-compatible, while the existing
 * `SessionStore.fork()` still requires the source session to be live. This
 * inspector never turns that condition into a stronger claim.
 *
 * `reproducible` remains unavailable because the current session format does
 * not snapshot the execution environment or external world state, and no
 * reproducible replay executor is shipped.
 *
 * @param events - Full current-format session log in sequence order.
 * @param boundary - Optional inclusive event seq to inspect through; omitted means the current log tail.
 * @returns An immutable capability report for the selected prefix.
 */
export function inspectReplayCapabilities(
  events: readonly SessionEvent[],
  boundary?: number,
): ReplayInspection {
  const resolvedBoundary = resolveBoundary(events, boundary)
  const prefix = resolvedBoundary === null ? [] : events.slice(0, resolvedBoundary + 1)
  const lastTurnBoundary = prefix.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  const stableForkBoundary = lastTurnBoundary?.type !== 'turn/start'
  const requestSnapshot = reconstructReplayRequest(prefix)

  const modes: Record<ReplayMode, ReplayCapability> = {
    transcript: capability('transcript', 'available', 'none'),
    'request-reconstruction': requestSnapshot === undefined
      ? capability('request-reconstruction', 'unavailable', 'none', ['NO_REQUEST_HEADER'])
      : capability('request-reconstruction', 'available', 'none'),
    simulated: capability('simulated', 'unavailable', 'none', ['SIMULATED_EXECUTOR_NOT_IMPLEMENTED']),
    'live-fork': stableForkBoundary
      ? capability('live-fork', 'conditional', 'live-if-executed', ['LIVE_SOURCE_REQUIRED'])
      : capability('live-fork', 'unavailable', 'live-if-executed', ['OPEN_TURN', 'LIVE_SOURCE_REQUIRED']),
    reproducible: capability('reproducible', 'unavailable', 'live-if-executed', [
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ]),
  }

  return Object.freeze({
    boundary: resolvedBoundary,
    eventCount: prefix.length,
    stableForkBoundary,
    ...(requestSnapshot === undefined ? {} : {
      latestRequestHeaderSeq: requestSnapshot.requestHeaderSeq,
      requestHeader: requestSnapshot.header,
      requestSnapshot,
    }),
    modes: Object.freeze(modes),
  })
}
