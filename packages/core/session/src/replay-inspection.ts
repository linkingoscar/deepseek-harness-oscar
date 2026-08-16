/**
 * Replay capability inspection over validated current-format session logs.
 *
 * Inspection derives support claims from durable evidence only. It does not
 * execute models, dispatch tools, fork sessions, or restore external effects.
 */

import { reconstructReplayRequest } from './replay-request.ts'
import type { ReplayRequestSnapshot } from './replay-request.ts'
import { selectLatestReplayReproducibilityEvidence } from './replay-evidence.ts'
import type { EpochHeader, ReplayReproducibilityEvidence, SessionEvent } from './types.ts'

/** Replay modes kept distinct instead of collapsing different effect semantics into one operation. */
export type ReplayMode =
  | 'transcript'
  | 'request-reconstruction'
  | 'simulated'
  | 'live-fork'
  | 'reproducible'

/** Whether current durable evidence and shipped execution support make a replay mode usable. */
export type ReplayAvailability = 'available' | 'conditional' | 'unavailable'

/** Whether choosing a replay mode can lead to fresh external effects. */
export type ReplayEffectSemantics = 'none' | 'live-if-executed'

/** Machine-readable reasons a replay mode is not fully available. */
export type ReplayBlockerCode =
  | 'NO_REQUEST_HEADER'
  | 'OPEN_TURN'
  | 'LIVE_SOURCE_REQUIRED'
  | 'SIMULATED_EXECUTOR_REQUIRED'
  | 'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED'
  | 'EXTERNAL_STATE_NOT_SNAPSHOTTED'
  | 'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'

/** One replay mode's current support contract. */
export interface ReplayCapability {
  /** Replay mode being described. */
  mode: ReplayMode
  /** Current support level, independent from the evidence fields on the inspection. */
  availability: ReplayAvailability
  /** Whether executing the mode can produce fresh external effects. */
  effects: ReplayEffectSemantics
  /** Stable machine-readable blockers or caller requirements. */
  blockers: readonly ReplayBlockerCode[]
}

/** Offline replay evidence derived from one validated log prefix. */
export interface ReplayInspection {
  /** Inclusive inspected event sequence, or `null` for an empty log. */
  boundary: number | null
  /** Number of durable events in the inspected prefix. */
  eventCount: number
  /** Whether the prefix ends outside an open turn and is boundary-compatible with `SessionStore.fork()`. */
  stableForkBoundary: boolean
  /** Seq of the latest reconstructable `request/header` in the prefix, when one exists. */
  latestRequestHeaderSeq?: number
  /** Harness-owned request envelope retained as a convenience projection of {@link requestSnapshot}. */
  requestHeader?: EpochHeader
  /** Latest complete Harness-owned request snapshot: envelope plus canonical model-visible messages. */
  requestSnapshot?: ReplayRequestSnapshot
  /** Seq of the validated evidence record selected for the latest request. */
  reproducibilityEvidenceSeq?: number
  /** Validated latest atomic reproducibility-evidence record for the latest request. */
  reproducibilityEvidence?: ReplayReproducibilityEvidence
  /** Per-mode evidence and executor support contract. */
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
 * Inspect replay claims justified by a validated current-format log prefix.
 *
 * `request-reconstruction` requires a reconstructable Harness-owned request.
 * `simulated` additionally requires a caller-supplied effect-free executor.
 * `live-fork` remains conditional on a live source even at a stable boundary.
 * `reproducible` remains unavailable until a reproducible executor exists;
 * snapshot references remove only their corresponding presence blockers.
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
  const reproducibility = requestSnapshot === undefined
    ? undefined
    : selectLatestReplayReproducibilityEvidence(prefix, requestSnapshot.requestHeaderSeq)
  const reproducibleBlockers: ReplayBlockerCode[] = []

  if (reproducibility?.evidence.executionEnvironmentSnapshot === undefined) {
    reproducibleBlockers.push('EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED')
  }
  if (reproducibility?.evidence.externalStateSnapshot === undefined) {
    reproducibleBlockers.push('EXTERNAL_STATE_NOT_SNAPSHOTTED')
  }
  reproducibleBlockers.push('REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED')

  const modes: Record<ReplayMode, ReplayCapability> = {
    transcript: capability('transcript', 'available', 'none'),
    'request-reconstruction': requestSnapshot === undefined
      ? capability('request-reconstruction', 'unavailable', 'none', ['NO_REQUEST_HEADER'])
      : capability('request-reconstruction', 'available', 'none'),
    simulated: requestSnapshot === undefined
      ? capability('simulated', 'unavailable', 'none', ['NO_REQUEST_HEADER', 'SIMULATED_EXECUTOR_REQUIRED'])
      : capability('simulated', 'conditional', 'none', ['SIMULATED_EXECUTOR_REQUIRED']),
    'live-fork': stableForkBoundary
      ? capability('live-fork', 'conditional', 'live-if-executed', ['LIVE_SOURCE_REQUIRED'])
      : capability('live-fork', 'unavailable', 'live-if-executed', ['OPEN_TURN', 'LIVE_SOURCE_REQUIRED']),
    reproducible: capability('reproducible', 'unavailable', 'live-if-executed', reproducibleBlockers),
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
    ...(reproducibility === undefined ? {} : {
      reproducibilityEvidenceSeq: reproducibility.seq,
      reproducibilityEvidence: reproducibility.evidence,
    }),
    modes: Object.freeze(modes),
  })
}
