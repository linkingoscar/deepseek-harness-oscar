import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as replayFacade from '../src/replay.ts'
import {
  inspectReplayCapabilities,
  ReplaySimulationError,
  simulateReplayRequest,
} from '../src/replay.ts'
import type {
  ReplayReproducibilityEvidence,
  ReplaySimulationExecutor,
  ReplaySnapshotReference,
} from '../src/replay.ts'

const CONFIG = { provider: 'mock', model: 'm' }

function completedRequest(system = 'system'): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    {
      type: 'request/header',
      seq: 1,
      time: 11,
      data: { header: { config: CONFIG, system }, reason: 'initial' },
    },
    { type: 'turn/end', seq: 2, time: 12, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

function digest(hex: string): { algorithm: 'sha256'; digest: string } {
  return { algorithm: 'sha256', digest: hex.repeat(64) }
}

function snapshot(name: string, hex: string): ReplaySnapshotReference {
  return {
    format: 'fixture-v1',
    locator: `fixture://${name}`,
    digest: digest(hex),
  }
}

function evidenceEvent(
  seq: number,
  evidence: ReplayReproducibilityEvidence,
): SessionEvent<'replay/reproducibility-evidence'> {
  return {
    type: 'replay/reproducibility-evidence',
    seq,
    time: 10 + seq,
    data: evidence,
  }
}

describe('replay contract hardening', () => {
  it('keeps internal replay helpers off the public facade', () => {
    expect(Object.keys(replayFacade).sort()).toEqual([
      'ReplayInspectionError',
      'ReplaySimulationError',
      'inspectReplayCapabilities',
      'simulateReplayRequest',
    ])
  })

  it('freezes the capability table, capability records, and blocker lists returned by inspection', () => {
    const inspection = inspectReplayCapabilities(completedRequest())

    expect(Object.isFrozen(inspection)).toBe(true)
    expect(Object.isFrozen(inspection.modes)).toBe(true)
    for (const capability of Object.values(inspection.modes)) {
      expect(Object.isFrozen(capability)).toBe(true)
      expect(Object.isFrozen(capability.blockers)).toBe(true)
    }
  })

  it('does not fall back to older valid evidence when the latest replacement is ignorable', () => {
    const valid = evidenceEvent(3, {
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: snapshot('environment', 'e'),
      externalStateSnapshot: snapshot('external', 'f'),
    })
    const ignored = {
      ...evidenceEvent(4, {
        version: 1,
        requestHeaderSeq: 1,
        executionEnvironmentSnapshot: snapshot('environment-later', 'a'),
        externalStateSnapshot: snapshot('external-later', 'b'),
      }),
      ignorable: true,
    } as SessionEvent

    const inspection = inspectReplayCapabilities([...completedRequest(), valid, ignored])

    expect(inspection).not.toHaveProperty('reproducibilityEvidence')
    expect(inspection).not.toHaveProperty('reproducibilityEvidenceSeq')
    expect(inspection.modes.reproducible.blockers).toEqual([
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ])
  })

  it('rejects an empty executor identity before entering the executor', async () => {
    const execute = vi.fn(() => 'unused')
    const executor = {
      id: '   ',
      effects: 'none',
      execute,
    } as ReplaySimulationExecutor<string>

    await expect(simulateReplayRequest(completedRequest(), executor)).rejects.toThrow(ReplaySimulationError)
    await expect(simulateReplayRequest(completedRequest(), executor)).rejects.toThrow(/id must be a non-empty string/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('propagates an executor failure without translating it into a replay contract error', async () => {
    const failure = new Error('fixture executor failed')
    const executor: ReplaySimulationExecutor<never> = {
      id: 'failing-fixture',
      effects: 'none',
      execute: async () => {
        throw failure
      },
    }

    await expect(simulateReplayRequest(completedRequest(), executor)).rejects.toBe(failure)
  })

  it('awaits asynchronous executor results while preserving the reconstructed historical request', async () => {
    const executor: ReplaySimulationExecutor<{ system: string | undefined }> = {
      id: 'async-fixture',
      effects: 'none',
      execute: async request => ({ system: request.header.system }),
    }

    const replay = await simulateReplayRequest(completedRequest('historical'), executor)

    expect(replay.executorId).toBe('async-fixture')
    expect(replay.request).toMatchObject({
      requestHeaderSeq: 1,
      header: { config: CONFIG, system: 'historical' },
      messages: [],
    })
    expect(replay.result).toEqual({ system: 'historical' })
  })
})
