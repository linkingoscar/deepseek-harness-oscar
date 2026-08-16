/**
 * Request-scoped reproducibility-evidence selection for replay inspection.
 *
 * The selector is intentionally independent from capability policy: it only
 * chooses and validates the latest replacement record bound to one exact
 * historical request.
 */

import { normalizeReplayReproducibilityEvidence } from './reproducibility-evidence.ts'
import type { ReplayReproducibilityEvidence, SessionEvent } from './types.ts'

/**
 * Select the latest atomic reproducibility-evidence record for one request.
 *
 * Replacement semantics fail closed: once a later record is observed for the
 * same `requestHeaderSeq`, an ignorable or malformed replacement does not fall
 * back to an older valid claim.
 *
 * @param events - Validated current-format session events in sequence order.
 * @param requestHeaderSeq - Exact historical `request/header` sequence.
 * @returns The selected validated evidence and its event sequence, or `undefined` when the latest claim cannot strengthen replay semantics.
 */
export function selectLatestReplayReproducibilityEvidence(
  events: readonly SessionEvent[],
  requestHeaderSeq: number,
): { seq: number; evidence: ReplayReproducibilityEvidence } | undefined {
  let latest: SessionEvent<'replay/reproducibility-evidence'> | undefined
  for (const event of events) {
    if (event.type !== 'replay/reproducibility-evidence' || event.seq <= requestHeaderSeq) continue
    const data = event.data as unknown
    if (typeof data !== 'object' || data === null || Array.isArray(data)
      || !('requestHeaderSeq' in data) || data.requestHeaderSeq !== requestHeaderSeq) continue
    latest = event
  }

  if (latest === undefined || latest.ignorable === true) return undefined
  const evidence = normalizeReplayReproducibilityEvidence(latest.data)
  if (evidence === undefined || evidence.requestHeaderSeq !== requestHeaderSeq) return undefined
  return { seq: latest.seq, evidence }
}
