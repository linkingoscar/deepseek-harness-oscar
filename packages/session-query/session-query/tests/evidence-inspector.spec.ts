import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type ReplayEvidenceDigest, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { readSessionEvidence } from '../src/evidence-inspector.ts'

const sessionId = SessionId('evidence-fixture')
const rootCallId = CallId('root')

function requestHeader(seq = 0): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time: seq,
    data: {
      header: { config: { provider: 'fixture', model: 'fixture-model' } },
      reason: 'initial',
    },
  }
}

function start(seq: number, parent: string, sub: string, name = 'read_file'): SessionEvent {
  return {
    type: 'tool/code-dispatch-start',
    seq,
    time: seq,
    data: {
      rootCallId,
      parentCallId: CallId(parent),
      subCallId: CallId(sub),
      name,
      arguments: {},
    },
  }
}

function settle(
  seq: number,
  parent: string,
  sub: string,
  overrides: Partial<SessionEvent<'tool/code-dispatch'>['data']> = {},
  name = 'read_file',
): SessionEvent {
  return {
    type: 'tool/code-dispatch',
    seq,
    time: seq,
    data: {
      rootCallId,
      parentCallId: CallId(parent),
      subCallId: CallId(sub),
      name,
      arguments: {},
      isError: false,
      content: [],
      ...overrides,
    },
  }
}

function digest(fill: string): ReplayEvidenceDigest {
  return { algorithm: 'sha256', digest: fill.repeat(64) }
}

function completeReplayEvidence(seq: number): SessionEvent {
  return {
    type: 'replay/reproducibility-evidence',
    seq,
    time: seq,
    data: {
      version: 1,
      requestHeaderSeq: 0,
      identity: { runtime: digest('a') },
      executionEnvironmentSnapshot: {
        format: 'fixture',
        locator: 'fixture://execution-environment',
        digest: digest('b'),
      },
      externalStateSnapshot: {
        format: 'fixture',
        locator: 'fixture://external-state',
        digest: digest('c'),
      },
    },
  }
}

function inspect(events: readonly SessionEvent[], boundary?: number) {
  return readSessionEvidence(sessionId, events, {
    ...(boundary === undefined ? {} : { boundary }),
    sourceKind: 'live',
  })
}

describe('readSessionEvidence', () => {
  it('projects an empty session without inventing execution or replay evidence', () => {
    const result = inspect([])

    expect(result.session).toEqual({
      id: sessionId,
      boundary: null,
      eventCount: 0,
      sourceKind: 'live',
      stableForkBoundary: true,
    })
    expect(result.execution).toEqual({
      runs: 0,
      started: 0,
      settled: 0,
      failed: 0,
      deliveredValueBytes: 0,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 0,
      maxRunPeakInFlight: 0,
      unsettled: 0,
      orphanSettles: 0,
      runsWithIncompleteEvidence: 0,
      byTool: {},
    })
    expect(result.replay.reproducibilityEvidencePresent).toBe(false)
    expect(result.replay.snapshotReferences).toEqual({ executionEnvironment: false, externalState: false })
    expect(result.replay.modes['request-reconstruction'].availability).toBe('unavailable')
    expect(result.replay.modes.simulated.availability).toBe('unavailable')
  })

  it('projects the latest reconstructable request and existing replay capabilities', () => {
    const result = inspect([requestHeader()])

    expect(result.replay.latestRequestHeaderSeq).toBe(0)
    expect(result.replay.requestHeader).toEqual({
      config: { provider: 'fixture', model: 'fixture-model' },
    })
    expect(result.replay.modes['request-reconstruction'].availability).toBe('available')
    expect(result.replay.modes.simulated).toEqual(expect.objectContaining({
      availability: 'conditional',
      blockers: ['SIMULATED_EXECUTOR_REQUIRED'],
    }))
    expect(result.replay.modes['live-fork']).toEqual(expect.objectContaining({
      availability: 'conditional',
      blockers: ['LIVE_SOURCE_REQUIRED'],
    }))
  })

  it('summarizes a normal Code Mode run and preserves the per-tool summary', () => {
    const result = inspect([
      start(0, 'parent-1', 'sub-1'),
      settle(1, 'parent-1', 'sub-1', { deliveredValueBytes: 7 }),
    ])

    expect(result.execution).toEqual(expect.objectContaining({
      runs: 1,
      started: 1,
      settled: 1,
      failed: 0,
      deliveredValueBytes: 7,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 0,
      maxRunPeakInFlight: 1,
      unsettled: 0,
      orphanSettles: 0,
      runsWithIncompleteEvidence: 0,
    }))
    expect(result.execution.byTool.read_file).toEqual({
      runs: 1,
      started: 1,
      settled: 1,
      failed: 0,
      deliveredValueBytes: 7,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 0,
    })
  })

  it('keeps tool failure distinct from delivery rejection', () => {
    const result = inspect([
      start(0, 'parent-1', 'sub-1'),
      settle(1, 'parent-1', 'sub-1', { isError: true }),
    ])

    expect(result.execution).toEqual(expect.objectContaining({
      settled: 1,
      failed: 1,
      deliveryRejected: 0,
      deliveredValueBytes: 0,
    }))
  })

  it('keeps delivery rejection distinct from tool failure and delivered bytes', () => {
    const result = inspect([
      start(0, 'parent-1', 'sub-1'),
      settle(1, 'parent-1', 'sub-1', {
        deliveryRejection: {
          reason: 'maxTotalDeliveredValueBytes',
          valueBytes: 9,
          deliveredBeforeBytes: 4,
          limitBytes: 8,
        },
      }),
    ])

    expect(result.execution).toEqual(expect.objectContaining({
      settled: 1,
      failed: 0,
      deliveryRejected: 1,
      deliveredValueBytes: 0,
      unmeasuredDeliveredValues: 0,
    }))
  })

  it('preserves unmeasured successful delivery-byte evidence', () => {
    const result = inspect([
      start(0, 'parent-1', 'sub-1'),
      settle(1, 'parent-1', 'sub-1'),
    ])

    expect(result.execution.deliveredValueBytes).toBe(0)
    expect(result.execution.unmeasuredDeliveredValues).toBe(1)
    expect(result.execution.byTool.read_file?.unmeasuredDeliveredValues).toBe(1)
  })

  it('surfaces unsettled dispatch evidence and incomplete runs', () => {
    const result = inspect([start(0, 'parent-1', 'sub-1')])

    expect(result.execution).toEqual(expect.objectContaining({
      started: 1,
      settled: 0,
      unsettled: 1,
      orphanSettles: 0,
      runsWithIncompleteEvidence: 1,
    }))
  })

  it('surfaces orphan settle evidence without synthesizing a start', () => {
    const result = inspect([settle(0, 'parent-1', 'sub-1', { deliveredValueBytes: 3 })])

    expect(result.execution).toEqual(expect.objectContaining({
      started: 0,
      settled: 1,
      unsettled: 0,
      orphanSettles: 1,
      runsWithIncompleteEvidence: 1,
    }))
  })

  it('preserves aggregate byte overflow as null', () => {
    const result = inspect([
      start(0, 'parent-1', 'sub-1'),
      settle(1, 'parent-1', 'sub-1', { deliveredValueBytes: Number.MAX_SAFE_INTEGER }),
      start(2, 'parent-2', 'sub-2'),
      settle(3, 'parent-2', 'sub-2', { deliveredValueBytes: 1 }),
    ])

    expect(result.execution.deliveredValueBytes).toBeNull()
    expect(result.execution.unmeasuredDeliveredValues).toBe(0)
  })

  it('reports validated replay evidence and snapshot-reference presence', () => {
    const result = inspect([requestHeader(), completeReplayEvidence(1)])

    expect(result.replay.reproducibilityEvidencePresent).toBe(true)
    expect(result.replay.snapshotReferences).toEqual({ executionEnvironment: true, externalState: true })
    expect(result.replay.modes.reproducible.blockers).toEqual(['REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED'])
  })

  it('reports absent replay evidence without weakening existing reproducible blockers', () => {
    const result = inspect([requestHeader()])

    expect(result.replay.reproducibilityEvidencePresent).toBe(false)
    expect(result.replay.snapshotReferences).toEqual({ executionEnvironment: false, externalState: false })
    expect(result.replay.modes.reproducible.blockers).toEqual([
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ])
  })

  it('inherits replay fail-closed behavior for malformed latest evidence', () => {
    const malformedLatest = {
      type: 'replay/reproducibility-evidence',
      seq: 2,
      time: 2,
      data: { version: 2, requestHeaderSeq: 0 },
    } as unknown as SessionEvent
    const result = inspect([requestHeader(), completeReplayEvidence(1), malformedLatest])

    expect(result.replay.reproducibilityEvidencePresent).toBe(false)
    expect(result.replay.snapshotReferences).toEqual({ executionEnvironment: false, externalState: false })
    expect(result.replay.modes.reproducible.blockers).toEqual([
      'EXECUTION_ENVIRONMENT_NOT_SNAPSHOTTED',
      'EXTERNAL_STATE_NOT_SNAPSHOTTED',
      'REPRODUCIBLE_EXECUTOR_NOT_IMPLEMENTED',
    ])
  })

  it('uses one selected prefix for session, execution, and replay facts', () => {
    const result = inspect([
      requestHeader(),
      completeReplayEvidence(1),
      start(2, 'parent-1', 'sub-1'),
    ], 0)

    expect(result.session).toEqual(expect.objectContaining({ boundary: 0, eventCount: 1 }))
    expect(result.execution.started).toBe(0)
    expect(result.replay.reproducibilityEvidencePresent).toBe(false)
  })

  it('defaults direct inspection source kind to supplied-log', () => {
    const result = readSessionEvidence(SessionId('supplied'), [])

    expect(result.session.sourceKind).toBe('supplied-log')
  })
})
