import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveCodeRunExecutionAccounting } from '../src/execution-accounting.ts'
import type {} from '../src/types.ts'

type CodeEvent = SessionEvent<'tool/code-dispatch-start' | 'tool/code-dispatch'>

function start(
  seq: number,
  time: number,
  parent: string,
  n: number,
  name: string,
): CodeEvent {
  const parentCallId = CallId(parent)
  return {
    type: 'tool/code-dispatch-start',
    seq,
    time,
    data: {
      rootCallId: CallId('root'),
      parentCallId,
      subCallId: CallId(`${parent}:code:${n}`),
      name,
      arguments: {},
    },
  }
}

function settle(
  seq: number,
  time: number,
  parent: string,
  n: number,
  name: string,
  isError = false,
): CodeEvent {
  const parentCallId = CallId(parent)
  return {
    type: 'tool/code-dispatch',
    seq,
    time,
    data: {
      rootCallId: CallId('root'),
      parentCallId,
      subCallId: CallId(`${parent}:code:${n}`),
      name,
      arguments: {},
      isError,
      content: [],
    },
  }
}

describe('Code Mode execution accounting', () => {
  it('derives peak in-flight from durable event order', () => {
    const accounting = deriveCodeRunExecutionAccounting([
      start(1, 100, 'parent', 1, 'read_file'),
      start(2, 101, 'parent', 2, 'grep'),
      settle(3, 110, 'parent', 1, 'read_file'),
      start(4, 111, 'parent', 3, 'read_file'),
      settle(5, 120, 'parent', 2, 'grep'),
      settle(6, 125, 'parent', 3, 'read_file'),
    ])

    expect(accounting).toEqual([{
      rootCallId: CallId('root'),
      parentCallId: CallId('parent'),
      started: 3,
      settled: 3,
      failed: 0,
      peakInFlight: 2,
      unsettled: 0,
      orphanSettles: 0,
      firstSeq: 1,
      lastSeq: 6,
      dispatchWindowMs: 25,
      byTool: {
        read_file: { started: 2, settled: 2, failed: 0 },
        grep: { started: 1, settled: 1, failed: 0 },
      },
    }])
  })

  it('keeps error accounting and parent runs independent', () => {
    const accounting = deriveCodeRunExecutionAccounting([
      start(1, 100, 'parent-a', 1, 'bash'),
      settle(2, 105, 'parent-a', 1, 'bash', true),
      start(3, 106, 'parent-b', 1, 'read_file'),
      settle(4, 109, 'parent-b', 1, 'read_file'),
    ])

    expect(accounting).toHaveLength(2)
    expect(accounting[0]).toMatchObject({
      parentCallId: CallId('parent-a'),
      started: 1,
      settled: 1,
      failed: 1,
      peakInFlight: 1,
      byTool: { bash: { started: 1, settled: 1, failed: 1 } },
    })
    expect(accounting[1]).toMatchObject({
      parentCallId: CallId('parent-b'),
      started: 1,
      settled: 1,
      failed: 0,
      peakInFlight: 1,
      byTool: { read_file: { started: 1, settled: 1, failed: 0 } },
    })
  })

  it('reports incomplete or sliced durable evidence instead of normalizing it away', () => {
    const accounting = deriveCodeRunExecutionAccounting([
      start(10, 200, 'parent', 1, 'read_file'),
      settle(11, 201, 'parent', 99, 'grep', true),
    ])

    expect(accounting[0]).toMatchObject({
      started: 1,
      settled: 1,
      failed: 1,
      peakInFlight: 1,
      unsettled: 1,
      orphanSettles: 1,
      byTool: {
        read_file: { started: 1, settled: 0, failed: 0 },
        grep: { started: 0, settled: 1, failed: 1 },
      },
    })
  })
})
