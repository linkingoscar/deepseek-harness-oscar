/**
 * Caller-supplied replay snapshot resolution and artifact-integrity verification.
 *
 * This module resolves only durable snapshot references already selected by
 * replay inspection. It performs no default external I/O, restores no state,
 * and does not implement reproducible execution.
 */

import { createHash } from 'node:crypto'
import { inspectReplayCapabilities } from './replay-inspection.ts'
import type { ReplayEvidenceDigest, ReplaySnapshotReference, SessionEvent } from './types.ts'

/** The two independently owned snapshot classes in reproducibility evidence. */
export type ReplaySnapshotKind = 'execution-environment' | 'external-state'

/**
 * Caller-owned adapter that materializes one opaque durable snapshot reference.
 *
 * Core never interprets `format` or `locator`; the resolver owns that mapping.
 * Returned bytes are copied before hashing so resolver-owned mutable buffers do
 * not remain aliased to a verified result.
 */
export interface ReplaySnapshotResolver {
  /** Stable non-empty identity for diagnostics and future executor provenance. */
  readonly id: string
  /** Resolve the exact bytes addressed by one durable snapshot reference. */
  resolve(reference: ReplaySnapshotReference): Uint8Array | Promise<Uint8Array>
}

/** Why a supplied resolver object does not satisfy {@link ReplaySnapshotResolver}. */
export type ReplaySnapshotResolverContractFailure = 'invalid-id' | 'missing-resolve'

/** Why a valid resolver invocation did not yield usable snapshot bytes. */
export type ReplaySnapshotResolveFailure = 'resolver-error' | 'invalid-result'

/**
 * Resolution outcome for one snapshot class.
 *
 * The union intentionally keeps absence, resolver-contract failure, resolution
 * failure, digest mismatch, and successful verification distinct. Consumers
 * must not collapse these states into one boolean when explaining replay
 * readiness.
 */
export type ReplaySnapshotResolution =
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'reference-absent'
  }
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'resolver-absent'
    readonly reference: ReplaySnapshotReference
  }
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'resolver-contract-invalid'
    readonly reference: ReplaySnapshotReference
    readonly reason: ReplaySnapshotResolverContractFailure
  }
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'resolve-failed'
    readonly reference: ReplaySnapshotReference
    readonly resolverId: string
    readonly reason: ReplaySnapshotResolveFailure
  }
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'digest-mismatch'
    readonly reference: ReplaySnapshotReference
    readonly resolverId: string
    readonly expectedDigest: ReplayEvidenceDigest
    readonly actualDigest: ReplayEvidenceDigest
  }
  | {
    readonly kind: ReplaySnapshotKind
    readonly status: 'verified'
    readonly reference: ReplaySnapshotReference
    readonly resolverId: string
    /** Digest computed over the returned artifact bytes. */
    readonly actualDigest: ReplayEvidenceDigest
    /** Detached bytes that matched the durable digest at verification time. */
    readonly bytes: Uint8Array
  }

/** Request-scoped verification report for both independent replay snapshot classes. */
export interface ReplaySnapshotResolutionReport {
  /** Inclusive replay boundary used to select request-scoped evidence. */
  readonly boundary: number | null
  /** Historical request selected by replay inspection, when one exists. */
  readonly latestRequestHeaderSeq?: number
  /** Durable reproducibility-evidence event selected for that request, when valid. */
  readonly reproducibilityEvidenceSeq?: number
  /** Execution-environment snapshot outcome. */
  readonly executionEnvironment: ReplaySnapshotResolution
  /** External-state snapshot outcome. */
  readonly externalState: ReplaySnapshotResolution
}

type ResolverValidation =
  | { readonly status: 'absent' }
  | {
    readonly status: 'invalid'
    readonly reason: ReplaySnapshotResolverContractFailure
  }
  | {
    readonly status: 'valid'
    readonly resolver: ReplaySnapshotResolver
    readonly resolverId: string
  }

/** Validate the caller-owned resolver once before either snapshot is invoked. */
function validateResolver(resolver: ReplaySnapshotResolver | undefined): ResolverValidation {
  if (resolver === undefined) return { status: 'absent' }
  if (typeof resolver !== 'object' || resolver === null
    || typeof resolver.id !== 'string' || resolver.id.trim().length === 0) {
    return { status: 'invalid', reason: 'invalid-id' }
  }
  if (typeof resolver.resolve !== 'function') {
    return { status: 'invalid', reason: 'missing-resolve' }
  }
  return { status: 'valid', resolver, resolverId: resolver.id }
}

/** Compute the first-version replay artifact digest over the artifact bytes themselves. */
function sha256(bytes: Uint8Array): ReplayEvidenceDigest {
  return Object.freeze({
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
  })
}

/** Resolve and verify one snapshot reference without affecting the other class. */
async function resolveOne(
  kind: ReplaySnapshotKind,
  reference: ReplaySnapshotReference | undefined,
  resolver: ResolverValidation,
): Promise<ReplaySnapshotResolution> {
  if (reference === undefined) return Object.freeze({ kind, status: 'reference-absent' })
  if (resolver.status === 'absent') {
    return Object.freeze({ kind, status: 'resolver-absent', reference })
  }
  if (resolver.status === 'invalid') {
    return Object.freeze({
      kind,
      status: 'resolver-contract-invalid',
      reference,
      reason: resolver.reason,
    })
  }

  let resolved: unknown
  try {
    resolved = await resolver.resolver.resolve(reference)
  } catch {
    return Object.freeze({
      kind,
      status: 'resolve-failed',
      reference,
      resolverId: resolver.resolverId,
      reason: 'resolver-error',
    })
  }
  if (!(resolved instanceof Uint8Array)) {
    return Object.freeze({
      kind,
      status: 'resolve-failed',
      reference,
      resolverId: resolver.resolverId,
      reason: 'invalid-result',
    })
  }

  const bytes = Uint8Array.from(resolved)
  const actualDigest = sha256(bytes)
  if (actualDigest.digest !== reference.digest.digest) {
    return Object.freeze({
      kind,
      status: 'digest-mismatch',
      reference,
      resolverId: resolver.resolverId,
      expectedDigest: reference.digest,
      actualDigest,
    })
  }

  return Object.freeze({
    kind,
    status: 'verified',
    reference,
    resolverId: resolver.resolverId,
    actualDigest,
    bytes,
  })
}

/**
 * Resolve and SHA-256 verify snapshot artifacts for the request selected by replay inspection.
 *
 * Request and boundary semantics are delegated to {@link inspectReplayCapabilities};
 * this function never reimplements latest-evidence selection or malformed-record
 * fallback rules. The two snapshot classes are resolved independently and a
 * failure in one does not suppress verification of the other.
 *
 * This operation does not restore either artifact and does not change replay
 * capability availability. In particular,
 * `REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED` remains authoritative even when both
 * snapshots verify successfully.
 *
 * @param events - Full current-format session log in sequence order.
 * @param resolver - Optional caller-supplied artifact resolver. Core provides no default resolver.
 * @param boundary - Optional inclusive event sequence passed to replay inspection.
 * @returns Immutable request-scoped outcomes for execution-environment and external-state artifacts.
 */
export async function resolveReplaySnapshots(
  events: readonly SessionEvent[],
  resolver?: ReplaySnapshotResolver,
  boundary?: number,
): Promise<ReplaySnapshotResolutionReport> {
  const inspection = inspectReplayCapabilities(events, boundary)
  const evidence = inspection.reproducibilityEvidence
  const validatedResolver = validateResolver(resolver)
  const executionEnvironment = await resolveOne(
    'execution-environment',
    evidence?.executionEnvironmentSnapshot,
    validatedResolver,
  )
  const externalState = await resolveOne(
    'external-state',
    evidence?.externalStateSnapshot,
    validatedResolver,
  )

  return Object.freeze({
    boundary: inspection.boundary,
    ...(inspection.latestRequestHeaderSeq === undefined
      ? {}
      : { latestRequestHeaderSeq: inspection.latestRequestHeaderSeq }),
    ...(inspection.reproducibilityEvidenceSeq === undefined
      ? {}
      : { reproducibilityEvidenceSeq: inspection.reproducibilityEvidenceSeq }),
    executionEnvironment,
    externalState,
  })
}
