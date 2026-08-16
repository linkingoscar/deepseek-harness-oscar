import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReplayRequestSnapshot } from '../src/replay-request.ts'
import * as replayFacade from '../src/replay.ts'
import {
  inspectReplayCapabilities,
  ReplayInspectionError,
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

describe('inspectReplayCapabilities', () => {
  it('keeps internal replay helpers off the public facade', () => {
    expect(Object.keys(replayFacade).sort()).toEqual([
      'ReplayInspectionError',
      'ReplaySimulationError',
      'inspectReplayCapabilities',
      'resolveReplaySnapshots',
      'simulateReplayRequest',
    ])
  })

  it('keeps an empty transcript inspectable without inventing request or reproducibility evidence', () => {
    const inspection = inspectReplayCapabilities([])

    expect(inspection).toMatchObject({
      boundary: null,
      eventCount: 0,
      stableForkBoundary: true,
      modes: {
        transcript: { availability: 'available', effects: 'none', blockers: [] },
        'request-reconstruction': {
          availability: 'unavailable',
          effects: 'none',
          blockers: ['NO_REQUEST_HEADER'],
        },
        simulated: {
          availability: 'unavailable',
          effects: 'none',
          blockers: ['NO_REQUEST_HEADER', 'SIMULATED_EXECUTOR_REQUIRED'],
        },
        'live-fork': {
          availability: 'conditional',
          effects: 'live-if-executed',
          blockers: ['LIVE_SOURCE_REQUIRED'],
        },
        reproducible: {
          availability: 'unavailable',
          effects: 'live-if-executed',
          blockers: [
            'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
            'EXTERNAL_STATE_NOT_SNAPSHOTTED',
            'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
          ],
        },
      },
    })
    expect(inspection).not.toHaveProperty('requestHeader')
    expect(inspection).not.toHaveProperty('latestRequestHeaderSeq')
    expect(inspection).not.toHaveProperty('reproducibilityEvidence')
  })

  it('reports a completed request prefix as reconstructable and simulation-ready when an executor is supplied', () => {
    const inspection = inspectReplayCapabilities(completedRequest('one'))

    expect(inspection.boundary).toBe(2)
    expect(inspection.eventCount).toBe(3)
    expect(inspection.stableForkBoundary).toBe(true)
    expect(inspection.latestRequestHeaderSeq).toBe(1)
    expect(inspection.requestHeader).toEqual({ config: CONFIG, system: 'one' })
    expect(inspection.modes['request-reconstruction']).toEqual({
      mode: 'request-reconstruction', availability: 'available', effects: 'none', blockers: [],
    })
    expect(inspection.modes.simulated).toEqual({
      mode: 'simulated', availability: 'conditional', effects: 'none', blockers: ['SIMULATED_EXECUTOR_REQUIRED'],
    })
    expect(inspection.modes['live-fork']).toEqual({
      mode: 'live-fork', availability: 'conditional', effects: 'live-if-executed', blockers: ['LIVE_SOURCE_REQUIRED'],
    })
  })

  it('freezes the capability table, capability records, and blocker lists', () => {
    const inspection = inspectReplayCapabilities(completedRequest())

    expect(Object.isFrozen(inspection)).toBe(true)
    expect(Object.isFrozen(inspection.modes)).toBe(true)
    for (const capability of Object.values(inspection.modes)) {
      expect(Object.isFrozen(capability)).toBe(true)
      expect(Object.isFrozen(capability.blockers)).toBe(true)
    }
  })

  it('keeps identity fingerprints distinct from restorable snapshot evidence', () => {
    const events: SessionEvent[] = [
      ...completedRequest(),
      evidenceEvent(3, {
        version: 1,
        requestHeaderSeq: 1,
        identity: {
          runtime: digest('a'),
          configuration: digest('b'),
          toolSchemas: digest('c'),
          pluginGraph: digest('d'),
        },
      }),
    ]

    const inspection = inspectReplayCapabilities(events)
    expect(inspection.reproducibilityEvidenceSeq).toBe(3)
    expect(inspection.reproducibilityEvidence?.identity?.runtime).toEqual(digest('a'))
    expect(inspection.modes.reproducible).toEqual({
      mode: 'reproducible',
      availability: 'unavailable',
      effects: 'live-if-executed',
      blockers: [
        'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
        'EXTERNAL_STATE_NOT_SNAPSHOTTED',
        'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
      ],
    })
  })

  it('removes only snapshot-presence blockers when both snapshot references are durably evidenced', () => {
    const evidence: ReplayReproducibilityEvidence = {
      version: 1,
      requestHeaderSeq: 1,
      identity: { runtime: digest('a') },
      executionEnvironmentSnapshot: snapshot('environment', 'e'),
      externalStateSnapshot: snapshot('external', 'f'),
    }
    const inspection = inspectReplayCapabilities([
      ...completedRequest(),
      evidenceEvent(3, evidence),
    ])

    expect(inspection.reproducibilityEvidenceSeq).toBe(3)
    expect(inspection.reproducibilityEvidence).toEqual(evidence)
    expect(Object.isFrozen(inspection.reproducibilityEvidence)).toBe(true)
    expect(inspection.modes.reproducible).toEqual({
      mode: 'reproducible',
      availability: 'unavailable',
      effects: 'live-if-executed',
      blockers: ['REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'],
    })
  })

  it('fails closed on malformed latest replacement evidence instead of falling back to an older valid claim', () => {
    const valid = evidenceEvent(3, {
      version: 1,
      requestHeaderSeq: 1,
      executionEnvironmentSnapshot: snapshot('environment', 'e'),
      externalStateSnapshot: snapshot('external', 'f'),
    })
    const malformed = {
      type: 'replay/reproducibility-evidence',
      seq: 4,
      time: 14,
      data: {
        version: 1,
        requestHeaderSeq: 1,
        executionEnvironmentSnapshot: {
          format: 'fixture-v1',
          locator: '',
          digest: digest('e'),
        },
        externalStateSnapshot: snapshot('external', 'f'),
      },
    } as unknown as SessionEvent

    const inspection = inspectReplayCapabilities([...completedRequest(), valid, malformed])
    expect(inspection).not.toHaveProperty('reproducibilityEvidence')
    expect(inspection.modes.reproducible.blockers).toEqual([
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ])
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

  it('scopes reproducibility evidence to the exact request and the selected inspection boundary', () => {
    const events: SessionEvent[] = [
      ...completedRequest('first'),
      evidenceEvent(3, {
        version: 1,
        requestHeaderSeq: 1,
        executionEnvironmentSnapshot: snapshot('environment', 'e'),
        externalStateSnapshot: snapshot('external', 'f'),
      }),
      { type: 'turn/start', seq: 4, time: 14, data: { turn: 2 } },
      {
        type: 'request/header',
        seq: 5,
        time: 15,
        data: { header: { config: { provider: 'mock', model: 'later' }, system: 'second' }, reason: 'change' },
      },
      { type: 'turn/end', seq: 6, time: 16, data: { turn: 2, reason: { kind: 'completed' } } },
    ]

    const first = inspectReplayCapabilities(events, 3)
    const second = inspectReplayCapabilities(events)
    expect(first.reproducibilityEvidenceSeq).toBe(3)
    expect(first.modes.reproducible.blockers).toEqual(['REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'])
    expect(second.latestRequestHeaderSeq).toBe(5)
    expect(second).not.toHaveProperty('reproducibilityEvidence')
    expect(second.modes.reproducible.blockers).toEqual([
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ])
  })

  it('rejects ignorable evidence records from strengthening required replay semantics', () => {
    const ignored = {
      ...evidenceEvent(3, {
        version: 1,
        requestHeaderSeq: 1,
        executionEnvironmentSnapshot: snapshot('environment', 'e'),
        externalStateSnapshot: snapshot('external', 'f'),
      }),
      ignorable: true,
    } as SessionEvent
    const inspection = inspectReplayCapabilities([...completedRequest(), ignored])

    expect(inspection).not.toHaveProperty('reproducibilityEvidence')
    expect(inspection.modes.reproducible.blockers).toContain('EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED')
    expect(inspection.modes.reproducible.blockers).toContain('EXTERNAL_STATE_NOT_SNAPSHOTTED')
  })

  it('rejects live-fork readiness when the selected prefix ends inside an open turn', () => {
    const events: SessionEvent[] = [
      ...completedRequest(),
      { type: 'turn/start', seq: 3, time: 13, data: { turn: 2 } },
    ]
    const inspection = inspectReplayCapabilities(events)

    expect(inspection.stableForkBoundary).toBe(false)
    expect(inspection.modes['live-fork']).toEqual({
      mode: 'live-fork',
      availability: 'unavailable',
      effects: 'live-if-executed',
      blockers: ['OPEN_TURN', 'LIVE_SOURCE_REQUIRED'],
    })
    // The earlier request remains reconstructable; an open later turn does not
    // erase evidence for a request already durably recorded.
    expect(inspection.modes['request-reconstruction'].availability).toBe('available')
  })

  it('honors an earlier boundary instead of leaking later request-header evidence backward', () => {
    const events: SessionEvent[] = [
      ...completedRequest('first'),
      { type: 'turn/start', seq: 3, time: 13, data: { turn: 2 } },
      {
        type: 'request/header',
        seq: 4,
        time: 14,
        data: { header: { config: { provider: 'mock', model: 'later' }, system: 'second' }, reason: 'change' },
      },
      { type: 'turn/end', seq: 5, time: 15, data: { turn: 2, reason: { kind: 'completed' } } },
    ]

    const first = inspectReplayCapabilities(events, 2)
    const second = inspectReplayCapabilities(events)
    expect(first.latestRequestHeaderSeq).toBe(1)
    expect(first.requestHeader).toEqual({ config: CONFIG, system: 'first' })
    expect(second.latestRequestHeaderSeq).toBe(4)
    expect(second.requestHeader).toEqual({ config: { provider: 'mock', model: 'later' }, system: 'second' })
  })

  it('refuses nonexistent, unsafe, fractional, and non-contiguous boundaries instead of guessing', () => {
    const events = completedRequest()
    expect(() => inspectReplayCapabilities(events, -1)).toThrow(ReplayInspectionError)
    expect(() => inspectReplayCapabilities(events, Number.NaN)).toThrow(ReplayInspectionError)
    expect(() => inspectReplayCapabilities(events, 1.5)).toThrow(ReplayInspectionError)
    expect(() => inspectReplayCapabilities(events, Number.MAX_SAFE_INTEGER + 1)).toThrow(ReplayInspectionError)
    expect(() => inspectReplayCapabilities(events, 3)).toThrow(/must be an existing non-negative event seq/)
    expect(() => inspectReplayCapabilities([], 0)).toThrow(/does not exist in an empty session log/)

    const broken = structuredClone(events)
    broken[1]!.seq = 9
    expect(() => inspectReplayCapabilities(broken, 2)).toThrow(/not contiguous at index 1/)
  })
})

describe('simulateReplayRequest', () => {
  it('supplies the exact reconstructed request to an effect-free executor and returns its opaque result', async () => {
    const execute = vi.fn((request: ReplayRequestSnapshot) => ({
      system: request.header.system,
      messageCount: request.messages.length,
    }))
    const executor: ReplaySimulationExecutor<{ system: string | undefined; messageCount: number }> = {
      id: 'fixture-simulator',
      effects: 'none',
      execute,
    }

    const result = await simulateReplayRequest(completedRequest('historical'), executor)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toBe(result.request)
    expect(result).toMatchObject({
      mode: 'simulated',
      executorId: 'fixture-simulator',
      request: { requestHeaderSeq: 1, header: { config: CONFIG, system: 'historical' }, messages: [] },
      result: { system: 'historical', messageCount: 0 },
    })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('can target an earlier request without leaking a later request into the executor input', async () => {
    const events: SessionEvent[] = [
      ...completedRequest('first'),
      { type: 'turn/start', seq: 3, time: 13, data: { turn: 2 } },
      {
        type: 'request/header',
        seq: 4,
        time: 14,
        data: { header: { config: { provider: 'mock', model: 'later' }, system: 'second' }, reason: 'change' },
      },
      { type: 'turn/end', seq: 5, time: 15, data: { turn: 2, reason: { kind: 'completed' } } },
    ]
    const executor: ReplaySimulationExecutor<string | undefined> = {
      id: 'history-probe',
      effects: 'none',
      execute: request => request.header.system,
    }

    const replay = await simulateReplayRequest(events, executor, 1)
    expect(replay.request.requestHeaderSeq).toBe(1)
    expect(replay.result).toBe('first')
  })

  it('rejects missing request evidence and executors that do not uphold the effect-free contract', async () => {
    const executor: ReplaySimulationExecutor<string> = {
      id: 'fixture-simulator',
      effects: 'none',
      execute: () => 'unused',
    }
    await expect(simulateReplayRequest([], executor)).rejects.toThrow(ReplaySimulationError)
    await expect(simulateReplayRequest([], executor)).rejects.toThrow(/requires a reconstructable request\/header/)

    const unsafe = {
      id: 'live-executor',
      effects: 'live-if-executed',
      execute: () => 'unsafe',
    } as unknown as ReplaySimulationExecutor<string>
    await expect(simulateReplayRequest(completedRequest(), unsafe)).rejects.toThrow(/effects: "none"/)
  })

  it('rejects a non-object or empty executor identity before entering the executor', async () => {
    await expect(simulateReplayRequest(
      completedRequest(),
      null as unknown as ReplaySimulationExecutor<string>,
    )).rejects.toThrow(/executor must be an object/)

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
    expect(Object.isFrozen(replay.request)).toBe(true)
    expect(Object.isFrozen(replay.request.messages)).toBe(true)
    expect(replay.result).toEqual({ system: 'historical' })
  })
})
