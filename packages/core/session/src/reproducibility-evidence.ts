/**
 * Runtime collection helpers for request-scoped replay reproducibility evidence.
 * Durable payload ownership stays in `types.ts`; this module only validates and
 * combines same-boundary contributions before one atomic event is appended.
 *
 * @module @deepseek-ai/dsh-session/reproducibility-evidence
 */

import type {
  ReplayEvidenceDigest,
  ReplayIdentityManifest,
  ReplayReproducibilityEvidence,
  ReplayReproducibilityEvidenceContribution,
  ReplayReproducibilityEvidenceSink,
  ReplaySnapshotReference,
} from './types.ts'

export type {
  ReplayReproducibilityEvidenceContribution,
  ReplayReproducibilityEvidenceSink,
} from './types.ts'

const SHA256_HEX = /^[0-9a-f]{64}$/
const IDENTITY_KEYS = ['runtime', 'configuration', 'toolSchemas', 'pluginGraph'] as const

type IdentityKey = typeof IDENTITY_KEYS[number]

/** True when an object contains no keys outside the schema being validated. */
function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const expected = new Set(allowed)
  return Object.keys(value).every(key => expected.has(key))
}

/** Validate and detach one digest. */
function normalizeDigest(value: unknown): ReplayEvidenceDigest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasOnlyKeys(value, ['algorithm', 'digest'])) return undefined
  const algorithm = 'algorithm' in value ? value.algorithm : undefined
  const digest = 'digest' in value ? value.digest : undefined
  if (algorithm !== 'sha256' || typeof digest !== 'string' || !SHA256_HEX.test(digest)) return undefined
  return Object.freeze({ algorithm: 'sha256', digest })
}

/** Validate an identity manifest atomically. */
function normalizeIdentity(value: unknown): ReplayIdentityManifest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasOnlyKeys(value, IDENTITY_KEYS)) return undefined

  const runtimeInput = 'runtime' in value ? value.runtime : undefined
  const configurationInput = 'configuration' in value ? value.configuration : undefined
  const toolSchemasInput = 'toolSchemas' in value ? value.toolSchemas : undefined
  const pluginGraphInput = 'pluginGraph' in value ? value.pluginGraph : undefined
  const runtime = runtimeInput === undefined ? undefined : normalizeDigest(runtimeInput)
  const configuration = configurationInput === undefined ? undefined : normalizeDigest(configurationInput)
  const toolSchemas = toolSchemasInput === undefined ? undefined : normalizeDigest(toolSchemasInput)
  const pluginGraph = pluginGraphInput === undefined ? undefined : normalizeDigest(pluginGraphInput)

  if (runtimeInput !== undefined && runtime === undefined) return undefined
  if (configurationInput !== undefined && configuration === undefined) return undefined
  if (toolSchemasInput !== undefined && toolSchemas === undefined) return undefined
  if (pluginGraphInput !== undefined && pluginGraph === undefined) return undefined
  if (runtime === undefined && configuration === undefined && toolSchemas === undefined && pluginGraph === undefined) {
    return undefined
  }

  return Object.freeze({
    ...(runtime === undefined ? {} : { runtime }),
    ...(configuration === undefined ? {} : { configuration }),
    ...(toolSchemas === undefined ? {} : { toolSchemas }),
    ...(pluginGraph === undefined ? {} : { pluginGraph }),
  })
}

/** Validate and detach one snapshot reference. */
function normalizeSnapshotReference(value: unknown): ReplaySnapshotReference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasOnlyKeys(value, ['format', 'locator', 'digest'])) return undefined
  const format = 'format' in value ? value.format : undefined
  const locator = 'locator' in value ? value.locator : undefined
  const digestInput = 'digest' in value ? value.digest : undefined
  const digest = normalizeDigest(digestInput)
  if (typeof format !== 'string' || format.trim().length === 0
    || typeof locator !== 'string' || locator.trim().length === 0
    || digest === undefined) return undefined
  return Object.freeze({ format, locator, digest })
}

interface NormalizedEvidenceFields {
  readonly identity?: ReplayIdentityManifest
  readonly executionEnvironmentSnapshot?: ReplaySnapshotReference
  readonly externalStateSnapshot?: ReplaySnapshotReference
}

/** Normalize the three evidence fields shared by contribution and durable-record schemas. */
function normalizeEvidenceFields(value: object): NormalizedEvidenceFields | undefined {
  const identityInput = 'identity' in value ? value.identity : undefined
  const environmentInput = 'executionEnvironmentSnapshot' in value ? value.executionEnvironmentSnapshot : undefined
  const externalInput = 'externalStateSnapshot' in value ? value.externalStateSnapshot : undefined
  const identity = identityInput === undefined ? undefined : normalizeIdentity(identityInput)
  const executionEnvironmentSnapshot = environmentInput === undefined
    ? undefined
    : normalizeSnapshotReference(environmentInput)
  const externalStateSnapshot = externalInput === undefined
    ? undefined
    : normalizeSnapshotReference(externalInput)

  if (identityInput !== undefined && identity === undefined) return undefined
  if (environmentInput !== undefined && executionEnvironmentSnapshot === undefined) return undefined
  if (externalInput !== undefined && externalStateSnapshot === undefined) return undefined
  if (identity === undefined && executionEnvironmentSnapshot === undefined && externalStateSnapshot === undefined) {
    return undefined
  }

  return Object.freeze({
    ...(identity === undefined ? {} : { identity }),
    ...(executionEnvironmentSnapshot === undefined ? {} : { executionEnvironmentSnapshot }),
    ...(externalStateSnapshot === undefined ? {} : { externalStateSnapshot }),
  })
}

/** Validate a contribution as one detached record before it mutates collector state. */
function normalizeContribution(value: unknown): ReplayReproducibilityEvidenceContribution | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasOnlyKeys(value, ['identity', 'executionEnvironmentSnapshot', 'externalStateSnapshot'])) return undefined
  return normalizeEvidenceFields(value)
}

/**
 * Validate one evidence payload as an atomic version-1 durable record.
 * @param value - Untrusted durable event data to validate and detach.
 * @returns A frozen normalized evidence record, or `undefined` when validation fails.
 */
export function normalizeReplayReproducibilityEvidence(value: unknown): ReplayReproducibilityEvidence | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !hasOnlyKeys(value, [
      'version',
      'requestHeaderSeq',
      'identity',
      'executionEnvironmentSnapshot',
      'externalStateSnapshot',
    ])) return undefined

  const version = 'version' in value ? value.version : undefined
  const requestHeaderSeq = 'requestHeaderSeq' in value ? value.requestHeaderSeq : undefined
  if (version !== 1 || typeof requestHeaderSeq !== 'number'
    || !Number.isSafeInteger(requestHeaderSeq) || requestHeaderSeq < 0) return undefined
  const fields = normalizeEvidenceFields(value)
  if (fields === undefined) return undefined
  return Object.freeze({ version: 1, requestHeaderSeq, ...fields })
}

function digestEquals(left: ReplayEvidenceDigest, right: ReplayEvidenceDigest): boolean {
  return left.digest === right.digest
}

function snapshotEquals(left: ReplaySnapshotReference, right: ReplaySnapshotReference): boolean {
  return left.format === right.format
    && left.locator === right.locator
    && digestEquals(left.digest, right.digest)
}

/**
 * Same-boundary evidence collector used by the agent loop.
 *
 * Conflicting valid writers fail closed per field: the disputed field is
 * removed from the final record and cannot be restored by a later writer.
 * This keeps the result independent of listener ordering. Invalid
 * contributions throw before mutating state; the agent notification dispatcher
 * contains that listener failure so another contributor can still participate.
 */
export class ReplayReproducibilityEvidenceCollector implements ReplayReproducibilityEvidenceSink {
  private readonly identity: Partial<Record<IdentityKey, ReplayEvidenceDigest>> = {}
  private readonly identityConflicts = new Set<IdentityKey>()
  private executionEnvironmentSnapshot: ReplaySnapshotReference | undefined
  private executionEnvironmentConflict = false
  private externalStateSnapshot: ReplaySnapshotReference | undefined
  private externalStateConflict = false
  private sealed = false

  add(contribution: ReplayReproducibilityEvidenceContribution): void {
    if (this.sealed) throw new Error('replay reproducibility evidence collector is sealed')
    const normalized = normalizeContribution(contribution)
    if (normalized === undefined) {
      throw new TypeError('invalid replay reproducibility evidence contribution')
    }

    if (normalized.identity !== undefined) {
      for (const key of IDENTITY_KEYS) {
        const incoming = normalized.identity[key]
        if (incoming === undefined || this.identityConflicts.has(key)) continue
        const current = this.identity[key]
        if (current === undefined) {
          this.identity[key] = incoming
        } else if (!digestEquals(current, incoming)) {
          Reflect.deleteProperty(this.identity, key)
          this.identityConflicts.add(key)
        }
      }
    }

    if (normalized.executionEnvironmentSnapshot !== undefined && !this.executionEnvironmentConflict) {
      if (this.executionEnvironmentSnapshot === undefined) {
        this.executionEnvironmentSnapshot = normalized.executionEnvironmentSnapshot
      } else if (!snapshotEquals(this.executionEnvironmentSnapshot, normalized.executionEnvironmentSnapshot)) {
        this.executionEnvironmentSnapshot = undefined
        this.executionEnvironmentConflict = true
      }
    }

    if (normalized.externalStateSnapshot !== undefined && !this.externalStateConflict) {
      if (this.externalStateSnapshot === undefined) {
        this.externalStateSnapshot = normalized.externalStateSnapshot
      } else if (!snapshotEquals(this.externalStateSnapshot, normalized.externalStateSnapshot)) {
        this.externalStateSnapshot = undefined
        this.externalStateConflict = true
      }
    }
  }

  /**
   * Seal the synchronous capture and build its single durable payload.
   * @param requestHeaderSeq - exact `request/header` event sequence being described.
   * @returns an immutable payload, or `undefined` when nothing unambiguous was captured.
   */
  finalize(requestHeaderSeq: number): ReplayReproducibilityEvidence | undefined {
    if (this.sealed) throw new Error('replay reproducibility evidence collector is already sealed')
    this.sealed = true
    if (!Number.isSafeInteger(requestHeaderSeq) || requestHeaderSeq < 0) {
      throw new TypeError('requestHeaderSeq must be a non-negative safe integer')
    }

    const identity = Object.keys(this.identity).length === 0
      ? undefined
      : Object.freeze({ ...this.identity }) as ReplayIdentityManifest
    if (identity === undefined
      && this.executionEnvironmentSnapshot === undefined
      && this.externalStateSnapshot === undefined) return undefined

    return Object.freeze({
      version: 1,
      requestHeaderSeq,
      ...(identity === undefined ? {} : { identity }),
      ...(this.executionEnvironmentSnapshot === undefined
        ? {}
        : { executionEnvironmentSnapshot: this.executionEnvironmentSnapshot }),
      ...(this.externalStateSnapshot === undefined ? {} : { externalStateSnapshot: this.externalStateSnapshot }),
    })
  }
}
