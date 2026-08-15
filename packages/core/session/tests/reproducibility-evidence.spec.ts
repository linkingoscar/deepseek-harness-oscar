import { describe, expect, it } from 'vitest'
import { ReplayReproducibilityEvidenceCollector } from '../src/reproducibility-evidence.ts'
import type { ReplayEvidenceDigest, ReplaySnapshotReference } from '../src/types.ts'

function digest(hex: string): ReplayEvidenceDigest {
  return { algorithm: 'sha256', digest: hex.repeat(64).slice(0, 64) }
}

function snapshot(locator: string, value: ReplayEvidenceDigest): ReplaySnapshotReference {
  return { format: 'test/v1', locator, digest: value }
}

const A = digest('a')
const B = digest('b')
const C = digest('c')
const D = digest('d')

describe('ReplayReproducibilityEvidenceCollector', () => {
  it('merges disjoint and identical same-boundary contributions', () => {
    const collector = new ReplayReproducibilityEvidenceCollector()
    collector.add({ identity: { runtime: A } })
    collector.add({ identity: { configuration: B } })
    collector.add({ identity: { runtime: A } })
    collector.add({ executionEnvironmentSnapshot: snapshot('cas://environment', C) })

    expect(collector.finalize(7)).toEqual({
      version: 1,
      requestHeaderSeq: 7,
      identity: {
        runtime: A,
        configuration: B,
      },
      executionEnvironmentSnapshot: snapshot('cas://environment', C),
    })
  })

  it('fails closed per field when valid contributors disagree', () => {
    const collector = new ReplayReproducibilityEvidenceCollector()
    collector.add({
      identity: { runtime: A, configuration: C },
      executionEnvironmentSnapshot: snapshot('cas://environment-a', A),
      externalStateSnapshot: snapshot('cas://external', D),
    })
    collector.add({
      identity: { runtime: B },
      executionEnvironmentSnapshot: snapshot('cas://environment-b', B),
    })
    // Once disputed, later writers cannot restore the field by listener order.
    collector.add({
      identity: { runtime: A },
      executionEnvironmentSnapshot: snapshot('cas://environment-a', A),
    })

    expect(collector.finalize(3)).toEqual({
      version: 1,
      requestHeaderSeq: 3,
      identity: { configuration: C },
      externalStateSnapshot: snapshot('cas://external', D),
    })
  })

  it('rejects invalid input before mutating accepted evidence', () => {
    const collector = new ReplayReproducibilityEvidenceCollector()
    collector.add({ identity: { runtime: A } })

    expect(() => {
      collector.add({
        identity: {
          configuration: { algorithm: 'sha256', digest: 'NOT-A-DIGEST' },
        },
      })
    }).toThrow(/invalid replay reproducibility evidence contribution/)

    expect(collector.finalize(1)).toEqual({
      version: 1,
      requestHeaderSeq: 1,
      identity: { runtime: A },
    })
  })

  it('seals after finalization and emits nothing when all captured fields conflict', () => {
    const collector = new ReplayReproducibilityEvidenceCollector()
    collector.add({ identity: { runtime: A } })
    collector.add({ identity: { runtime: B } })

    expect(collector.finalize(9)).toBeUndefined()
    expect(() => { collector.add({ identity: { runtime: A } }) }).toThrow(/sealed/)
    expect(() => collector.finalize(9)).toThrow(/already sealed/)
  })

  it('rejects invalid request header sequences', () => {
    const collector = new ReplayReproducibilityEvidenceCollector()
    collector.add({ identity: { runtime: A } })

    expect(() => collector.finalize(-1)).toThrow(/requestHeaderSeq/)
  })
})
