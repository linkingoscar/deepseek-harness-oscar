import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  inspectReplayCapabilities,
  resolveReplaySnapshots,
} from '../src/replay.ts'
import type {
  ReplayReproducibilityEvidence,
  ReplaySnapshotReference,
  ReplaySnapshotResolver,
} from '../src/replay.ts'

const ENVIRONMENT_BYTES = new TextEncoder().encode('environment')
const EXTERNAL_BYTES = new TextEncoder().encode('external')
const OTHER_BYTES = new TextEncoder().encode('other')
const SHA256 = {
  environment: 'ba5285161ba6eed0085fb13784ce5c92f70ebc268b94fd66aa1d68a32884204d',
  external: '3c4623849a49a53911c4a3e48d8cead8a1858960bccdea7a1b978d73ec2f06d7',
  other: 'd9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa',
} as const

function reference(name: string, digest: string): ReplaySnapshotReference {
  return {
    format: 'fixture-v1',
    locator: `fixture://${name}`,
    digest: { algorithm: 'sha256', digest },
  }
}

function logWithEvidence(evidence?: ReplayReproducibilityEvidence): SessionEvent[] {
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: 0, time: 100, data: { turn: 1 } },
    {
      type: 'request/header',
      seq: 1,
      time: 101,
      data: { header: { config: { provider: 'mock', model: 'snapshot-test' } }, reason: 'initial' },
    },
    { type: 'turn/end', seq: 2, time: 102, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  if (evidence !== undefined) {
    events.push({
      type: 'replay/reproducibility-evidence',
      seq: 3,
      time: 103,
      data: evidence,
    })
  }
  return events
}

function bothSnapshots(): ReplayReproducibilityEvidence {
  return {
    version: 1,
    requestHeaderSeq: 1,
    executionEnvironmentSnapshot: reference('environment', SHA256.environment),
    externalStateSnapshot: reference('external', SHA256.external),
  }
}

function fixtureResolver(): ReplaySnapshotResolver {
  return {
    id: 'fixture-resolver',
    resolve(snapshot) {
      switch (snapshot.locator) {
        case 'fixture://environment': return ENVIRONMENT_BYTES
        case 'fixture://external': return EXTERNAL_BYTES
        case 'fixture://other': return OTHER_BYTES
        default: throw new Error(`unknown fixture ${snapshot.locator}`)
      }
    },
  }
}

describe('resolveReplaySnapshots', () => {
  it('resolves and SHA-256 verifies both snapshot artifacts independently', async () => {
    const result = await resolveReplaySnapshots(logWithEvidence(bothSnapshots()), fixtureResolver())

    expect(result).toMatchObject({
      boundary: 3,
      latestRequestHeaderSeq: 1,
      reproducibilityEvidenceSeq: 3,
      executionEnvironment: {
        kind: 'execution-environment',
        status: 'verified',
        resolverId: 'fixture-resolver',
        actualDigest: { algorithm: 'sha256', digest: SHA256.environment },
      },
      externalState: {
        kind: 'external-state',
        status: 'verified',
        resolverId: 'fixture-resolver',
        actualDigest: { algorithm: 'sha256', digest: SHA256.external },
      },
    })
    if (result.executionEnvironment.status !== 'verified'
      || result.externalState.status !== 'verified') throw new Error('fixture snapshots did not verify')
    expect([...result.executionEnvironment.bytes]).toEqual([...ENVIRONMENT_BYTES])
    expect([...result.externalState.bytes]).toEqual([...EXTERNAL_BYTES])
    expect(result.executionEnvironment.bytes).not.toBe(ENVIRONMENT_BYTES)
    expect(result.externalState.bytes).not.toBe(EXTERNAL_BYTES)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.executionEnvironment)).toBe(true)
    expect(Object.isFrozen(result.externalState)).toBe(true)
  })

  it('fails closed on a digest mismatch while still verifying the independent snapshot', async () => {
    const evidence: ReplayReproducibilityEvidence = {
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: reference('environment', SHA256.other),
      externalStateSnapshot: reference('external', SHA256.external),
    }

    const result = await resolveReplaySnapshots(logWithEvidence(evidence), fixtureResolver())

    expect(result.executionEnvironment).toMatchObject({
      kind: 'execution-environment',
      status: 'digest-mismatch',
      resolverId: 'fixture-resolver',
      expectedDigest: { algorithm: 'sha256', digest: SHA256.other },
      actualDigest: { algorithm: 'sha256', digest: SHA256.environment },
    })
    expect(result.externalState.status).toBe('verified')
  })

  it('classifies a synchronous resolver throw without suppressing the other snapshot', async () => {
    const resolver: ReplaySnapshotResolver = {
      id: 'throwing-resolver',
      resolve(snapshot) {
        if (snapshot.locator === 'fixture://environment') throw new Error('fixture failure')
        return EXTERNAL_BYTES
      },
    }

    const result = await resolveReplaySnapshots(logWithEvidence(bothSnapshots()), resolver)

    expect(result.executionEnvironment).toMatchObject({
      status: 'resolve-failed',
      resolverId: 'throwing-resolver',
      reason: 'resolver-error',
    })
    expect(result.externalState.status).toBe('verified')
  })

  it('classifies an asynchronous resolver rejection as a resolution failure', async () => {
    const resolver: ReplaySnapshotResolver = {
      id: 'rejecting-resolver',
      async resolve(snapshot) {
        if (snapshot.locator === 'fixture://external') throw new Error('fixture rejection')
        return ENVIRONMENT_BYTES
      },
    }

    const result = await resolveReplaySnapshots(logWithEvidence(bothSnapshots()), resolver)

    expect(result.executionEnvironment.status).toBe('verified')
    expect(result.externalState).toMatchObject({
      status: 'resolve-failed',
      resolverId: 'rejecting-resolver',
      reason: 'resolver-error',
    })
  })

  it('rejects a resolver return value that is not Uint8Array bytes', async () => {
    const resolver = {
      id: 'invalid-result-resolver',
      resolve: () => 'not-bytes',
    } as unknown as ReplaySnapshotResolver

    const result = await resolveReplaySnapshots(logWithEvidence({
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: reference('environment', SHA256.environment),
    }), resolver)

    expect(result.executionEnvironment).toMatchObject({
      status: 'resolve-failed',
      resolverId: 'invalid-result-resolver',
      reason: 'invalid-result',
    })
    expect(result.externalState.status).toBe('reference-absent')
  })

  it('distinguishes invalid resolver identity and missing resolve method from resolution failures', async () => {
    const evidence: ReplayReproducibilityEvidence = {
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: reference('environment', SHA256.environment),
    }
    const emptyId = {
      id: '   ',
      resolve: () => ENVIRONMENT_BYTES,
    } as ReplaySnapshotResolver
    const missingResolve = {
      id: 'missing-resolve',
    } as unknown as ReplaySnapshotResolver

    const invalidId = await resolveReplaySnapshots(logWithEvidence(evidence), emptyId)
    const invalidMethod = await resolveReplaySnapshots(logWithEvidence(evidence), missingResolve)

    expect(invalidId.executionEnvironment).toMatchObject({
      status: 'resolver-contract-invalid',
      reason: 'invalid-id',
    })
    expect(invalidMethod.executionEnvironment).toMatchObject({
      status: 'resolver-contract-invalid',
      reason: 'missing-resolve',
    })
  })

  it('keeps execution-environment-only evidence independent from external-state absence', async () => {
    const result = await resolveReplaySnapshots(logWithEvidence({
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: reference('environment', SHA256.environment),
    }), fixtureResolver())

    expect(result.executionEnvironment.status).toBe('verified')
    expect(result.externalState).toEqual({ kind: 'external-state', status: 'reference-absent' })
  })

  it('keeps external-state-only evidence independent from execution-environment absence', async () => {
    const result = await resolveReplaySnapshots(logWithEvidence({
      version: 1,
      requestHeaderSeq: 1,
      externalStateSnapshot: reference('external', SHA256.external),
    }), fixtureResolver())

    expect(result.executionEnvironment).toEqual({ kind: 'execution-environment', status: 'reference-absent' })
    expect(result.externalState.status).toBe('verified')
  })

  it('does not reinterpret identity fingerprints as snapshot references', async () => {
    const resolver = fixtureResolver()
    const resolve = vi.spyOn(resolver, 'resolve')
    const result = await resolveReplaySnapshots(logWithEvidence({
      version: 1,
      requestHeaderSeq: 1,
      identity: {
        runtime: { algorithm: 'sha256', digest: SHA256.environment },
      },
    }), resolver)

    expect(result.executionEnvironment.status).toBe('reference-absent')
    expect(result.externalState.status).toBe('reference-absent')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('reuses fail-closed replay evidence selection when the latest replacement is malformed', async () => {
    const resolver = fixtureResolver()
    const resolve = vi.spyOn(resolver, 'resolve')
    const valid = logWithEvidence(bothSnapshots())
    const malformed = {
      type: 'replay/reproducibility-evidence',
      seq: 4,
      time: 104,
      data: {
        version: 1,
        requestHeaderSeq: 1,
        executionEnvironmentSnapshot: {
          format: 'fixture-v1',
          locator: '',
          digest: { algorithm: 'sha256', digest: SHA256.environment },
        },
        externalStateSnapshot: reference('external', SHA256.external),
      },
    } as unknown as SessionEvent

    const result = await resolveReplaySnapshots([...valid, malformed], resolver)

    expect(result.reproducibilityEvidenceSeq).toBeUndefined()
    expect(result.executionEnvironment.status).toBe('reference-absent')
    expect(result.externalState.status).toBe('reference-absent')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps request and boundary selection scoped to the replay inspector', async () => {
    const firstEvidence: ReplayReproducibilityEvidence = {
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: reference('environment', SHA256.environment),
    }
    const events: SessionEvent[] = [
      ...logWithEvidence(firstEvidence),
      { type: 'turn/start', seq: 4, time: 104, data: { turn: 2 } },
      {
        type: 'request/header',
        seq: 5,
        time: 105,
        data: { header: { config: { provider: 'mock', model: 'later' } }, reason: 'change' },
      },
      { type: 'turn/end', seq: 6, time: 106, data: { turn: 2, reason: { kind: 'completed' } } },
      {
        type: 'replay/reproducibility-evidence',
        seq: 7,
        time: 107,
        data: {
          version: 1,
          requestHeaderSeq: 5,
          externalStateSnapshot: reference('external', SHA256.external),
        },
      },
    ]

    const earlier = await resolveReplaySnapshots(events, fixtureResolver(), 3)
    const latest = await resolveReplaySnapshots(events, fixtureResolver())

    expect(earlier.latestRequestHeaderSeq).toBe(1)
    expect(earlier.reproducibilityEvidenceSeq).toBe(3)
    expect(earlier.executionEnvironment.status).toBe('verified')
    expect(earlier.externalState.status).toBe('reference-absent')
    expect(latest.latestRequestHeaderSeq).toBe(5)
    expect(latest.reproducibilityEvidenceSeq).toBe(7)
    expect(latest.executionEnvironment.status).toBe('reference-absent')
    expect(latest.externalState.status).toBe('verified')
  })

  it('keeps reproducible replay unavailable after both artifacts verify', async () => {
    const events = logWithEvidence(bothSnapshots())
    const result = await resolveReplaySnapshots(events, fixtureResolver())
    const inspection = inspectReplayCapabilities(events)

    expect(result.executionEnvironment.status).toBe('verified')
    expect(result.externalState.status).toBe('verified')
    expect(inspection.modes.reproducible).toEqual({
      mode: 'reproducible',
      availability: 'unavailable',
      effects: 'live-if-executed',
      blockers: ['REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'],
    })
  })

  it('reports resolver absence without changing existing capability inspection', async () => {
    const events = logWithEvidence(bothSnapshots())
    const before = inspectReplayCapabilities(events)
    const result = await resolveReplaySnapshots(events)
    const after = inspectReplayCapabilities(events)

    expect(result.executionEnvironment.status).toBe('resolver-absent')
    expect(result.externalState.status).toBe('resolver-absent')
    expect(after).toEqual(before)
  })
})
