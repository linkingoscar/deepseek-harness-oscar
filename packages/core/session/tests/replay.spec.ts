import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { inspectReplayCapabilities, ReplayInspectionError } from '../src/replay.ts'

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

describe('inspectReplayCapabilities', () => {
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
          blockers: ['SIMULATED_EXECUTOR_NOT_IMPLEMENTED'],
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
  })

  it('reports a completed request prefix as reconstructable and fork-compatible without upgrading live fork to unconditional', () => {
    const inspection = inspectReplayCapabilities(completedRequest('one'))

    expect(inspection.boundary).toBe(2)
    expect(inspection.eventCount).toBe(3)
    expect(inspection.stableForkBoundary).toBe(true)
    expect(inspection.latestRequestHeaderSeq).toBe(1)
    expect(inspection.requestHeader).toEqual({ config: CONFIG, system: 'one' })
    expect(inspection.modes['request-reconstruction']).toEqual({
      mode: 'request-reconstruction', availability: 'available', effects: 'none', blockers: [],
    })
    expect(inspection.modes['live-fork']).toEqual({
      mode: 'live-fork', availability: 'conditional', effects: 'live-if-executed', blockers: ['LIVE_SOURCE_REQUIRED'],
    })
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

  it('refuses nonexistent, unsafe, and non-contiguous boundaries instead of guessing', () => {
    const events = completedRequest()
    expect(() => inspectReplayCapabilities(events, -1)).toThrow(ReplayInspectionError)
    expect(() => inspectReplayCapabilities(events, 3)).toThrow(/must be an existing non-negative event seq/)
    expect(() => inspectReplayCapabilities([], 0)).toThrow(/does not exist in an empty session log/)

    const broken = structuredClone(events)
    broken[1]!.seq = 9
    expect(() => inspectReplayCapabilities(broken, 2)).toThrow(/not contiguous at index 1/)
  })
})
