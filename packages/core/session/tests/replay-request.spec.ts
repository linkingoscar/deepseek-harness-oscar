import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { reconstructReplayRequest, ReplayRequestSnapshotError } from '../src/replay-request.ts'

const CONFIG = { provider: 'mock', model: 'm' }

function userEvent(
  seq: number,
  text: string,
  surfaceOp: 'append' | { op: 'replace'; start: number; end: number } = 'append',
  sourceEventSeqs?: number[],
): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: seq,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
    surfaceOp,
    ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }),
  }
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: seq,
    data: {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: text.length === 0 ? [] : [{ type: 'text', text }],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      }),
    },
    surfaceOp: 'append',
  }
}

function headerEvent(
  seq: number,
  model: string,
  system: string,
  reason: 'initial' | 'change' = 'initial',
): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time: seq,
    data: { header: { config: { provider: 'mock', model }, system }, reason },
  }
}

describe('reconstructReplayRequest', () => {
  it('returns undefined when the log contains no request/header', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      userEvent(1, 'hello'),
    ]
    expect(reconstructReplayRequest(events)).toBeUndefined()
  })

  it('reconstructs the selected request without leaking later history backward', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      userEvent(2, 'before first request'),
      headerEvent(3, 'm', 'system one'),
      assistantEvent(4, 'first answer'),
      { type: 'step/end', seq: 5, time: 5, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 6, time: 6, data: { turn: 1, step: 2 } },
      userEvent(7, 'before second request'),
      headerEvent(8, 'later', 'system two', 'change'),
    ]

    const first = reconstructReplayRequest(events, 3)
    const latest = reconstructReplayRequest(events)

    expect(first).toMatchObject({
      requestHeaderSeq: 3,
      header: { config: CONFIG, system: 'system one' },
      step: { turn: 1, step: 1 },
    })
    expect(first?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'before first request' }] }),
    ])

    expect(latest).toMatchObject({
      requestHeaderSeq: 8,
      header: { config: { provider: 'mock', model: 'later' }, system: 'system two' },
      step: { turn: 1, step: 2 },
    })
    expect(latest?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'before first request' }] }),
      expect.objectContaining({ role: 'assistant', content: [{ type: 'text', text: 'first answer' }] }),
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'before second request' }] }),
    ])
  })

  it('uses the canonical folded surface, including replacements, for request history', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      userEvent(1, 'old one'),
      userEvent(2, 'old two'),
      userEvent(3, 'compacted summary', { op: 'replace', start: 1, end: 2 }, [1, 2]),
      headerEvent(4, 'm', 'system'),
    ]

    const snapshot = reconstructReplayRequest(events)
    expect(snapshot?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'compacted summary' }] }),
    ])
  })

  it('skips empty assistant messages exactly like live Session history derivation', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      assistantEvent(1, ''),
      userEvent(2, 'visible'),
      headerEvent(3, 'm', 'system'),
    ]

    const snapshot = reconstructReplayRequest(events)
    expect(snapshot?.messages).toEqual([
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'visible' }] }),
    ])
  })

  it('requires an explicit seq to identify a real request/header and a contiguous prefix', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      userEvent(1, 'hello'),
      headerEvent(2, 'm', 'system'),
    ]

    expect(() => reconstructReplayRequest(events, -1)).toThrow(ReplayRequestSnapshotError)
    expect(() => reconstructReplayRequest(events, 3)).toThrow(/must identify an existing non-negative event/)
    expect(() => reconstructReplayRequest(events, 1)).toThrow(/not "request\/header"/)

    const broken = structuredClone(events)
    broken[1]!.seq = 9
    expect(() => reconstructReplayRequest(broken, 2)).toThrow(/seq 9 is not contiguous; expected 1/)
  })
})
