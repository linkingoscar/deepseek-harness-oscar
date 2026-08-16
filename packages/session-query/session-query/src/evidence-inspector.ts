/**
 * Unified developer inspection over existing session, execution, and replay facts.
 *
 * This module is a pure read-side projection. It does not append events, persist
 * projections, define diagnostics metrics, or strengthen replay capabilities.
 *
 * @module @deepseek-ai/dsh-session-query/evidence-inspector
 */

import type { EpochHeader, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import {
  inspectReplayCapabilities,
  type ReplayCapability,
} from '@deepseek-ai/dsh-session/replay'
import { deriveCodeRunExecutionAccounting } from '@deepseek-ai/dsh-tools'
import {
  summarizeCodeRunExecutionAccounting,
  type CodeExecutionDiagnosticsSummary,
} from '@deepseek-ai/dsh-tools/execution-diagnostics'

/** How the caller obtained the inspected event log. */
export type SessionEvidenceSourceKind = 'supplied-log' | 'live' | 'persisted'

/** Read-time controls for the developer evidence projection. */
export interface SessionEvidenceReadOptions {
  /** Inclusive event sequence to inspect through; omitted selects the log tail. */
  readonly boundary?: number
  /** Source already known by the caller; direct log inspection defaults to `supplied-log`. */
  readonly sourceKind?: SessionEvidenceSourceKind
}

/** Session facts attached to one selected log prefix. */
export interface SessionEvidenceSessionSummary {
  /** Session whose event log is being inspected. */
  readonly id: SessionId
  /** Inclusive selected sequence, or `null` for an empty log. */
  readonly boundary: number | null
  /** Number of events in the selected prefix. */
  readonly eventCount: number
  /** How the caller obtained the inspected log. */
  readonly sourceKind: SessionEvidenceSourceKind
  /** Existing replay fact: whether the selected prefix is compatible with a stable fork boundary. */
  readonly stableForkBoundary: boolean
}

/** Existing replay capabilities and evidence-presence facts for one selected prefix. */
export interface SessionEvidenceReplaySummary {
  /** Seq of the latest reconstructable `request/header`, when present. */
  readonly latestRequestHeaderSeq?: number
  /** Latest reconstructable Harness-owned request header, when present. */
  readonly requestHeader?: EpochHeader
  /** Existing replay mode capability records, without reinterpretation. */
  readonly modes: Readonly<{
    'request-reconstruction': ReplayCapability
    simulated: ReplayCapability
    'live-fork': ReplayCapability
    reproducible: ReplayCapability
  }>
  /** Whether replay inspection selected a validated reproducibility-evidence record. */
  readonly reproducibilityEvidencePresent: boolean
  /** Presence of validated snapshot references in that selected evidence record. */
  readonly snapshotReferences: Readonly<{
    executionEnvironment: boolean
    externalState: boolean
  }>
}

/** Unified, non-persisted developer projection over one session log prefix. */
export interface SessionEvidenceInspection {
  /** Session/log selection facts. */
  readonly session: SessionEvidenceSessionSummary
  /** Existing Code Mode execution diagnostics derived from the selected prefix. */
  readonly execution: CodeExecutionDiagnosticsSummary
  /** Existing replay capabilities plus selected evidence-presence facts. */
  readonly replay: SessionEvidenceReplaySummary
}

/**
 * Read a unified developer evidence projection from an already obtained session
 * event log.
 *
 * The selected prefix is interpreted by the existing replay inspector and Code
 * Mode execution accounting. The function only combines those results; it does
 * not infer a stronger concurrency scope, replay mode, blocker, or durable fact.
 *
 * @param sessionId - Session id associated with the supplied event log.
 * @param events - Complete ordered event log to inspect.
 * @param options - Optional inclusive boundary and caller-known source kind.
 * @returns Session, execution, and replay facts for the same selected prefix.
 */
export function readSessionEvidence(
  sessionId: SessionId,
  events: readonly SessionEvent[],
  options: SessionEvidenceReadOptions = {},
): SessionEvidenceInspection {
  const replay = inspectReplayCapabilities(events, options.boundary)
  const prefix = replay.boundary === null ? [] : events.slice(0, replay.boundary + 1)
  const execution = summarizeCodeRunExecutionAccounting(deriveCodeRunExecutionAccounting(prefix))
  const evidence = replay.reproducibilityEvidence

  return {
    session: {
      id: sessionId,
      boundary: replay.boundary,
      eventCount: replay.eventCount,
      sourceKind: options.sourceKind ?? 'supplied-log',
      stableForkBoundary: replay.stableForkBoundary,
    },
    execution,
    replay: {
      ...(replay.latestRequestHeaderSeq === undefined ? {} : {
        latestRequestHeaderSeq: replay.latestRequestHeaderSeq,
      }),
      ...(replay.requestHeader === undefined ? {} : { requestHeader: replay.requestHeader }),
      modes: {
        'request-reconstruction': replay.modes['request-reconstruction'],
        simulated: replay.modes.simulated,
        'live-fork': replay.modes['live-fork'],
        reproducible: replay.modes.reproducible,
      },
      reproducibilityEvidencePresent: evidence !== undefined,
      snapshotReferences: {
        executionEnvironment: evidence?.executionEnvironmentSnapshot !== undefined,
        externalState: evidence?.externalStateSnapshot !== undefined,
      },
    },
  }
}
