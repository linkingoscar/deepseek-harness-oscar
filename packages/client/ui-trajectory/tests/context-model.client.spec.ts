import { describe, expect, it } from 'vitest'
import type { RequestView } from '@deepseek-ai/dsh-client-runtime/client'
import { contextRequestRows } from '../src/client/context-model.ts'

const prompt = {
  config: { provider: 'test', model: 'model' },
  system: 'context debugger',
  tools: [{
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  }],
}

describe('contextRequestRows', () => {
  it('keeps request ordinals aligned across compaction and assistant requests', () => {
    const rows = contextRequestRows([{
      purpose: 'compaction',
      startSeq: 10,
      turn: 1,
      step: 0,
      status: 'complete',
      startedAt: 10,
      completedAt: 20,
    }, {
      purpose: 'assistant',
      startSeq: 20,
      turn: 2,
      step: 3,
      status: 'complete',
      startedAt: 30,
      completedAt: 40,
      prompt,
      promptChange: { seq: 20, time: 30, kind: 'tools' },
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
      },
    }] as unknown as RequestView[])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      requestNumber: 2,
      turn: 2,
      step: 3,
      promptChange: 'tools',
      inputTokens: 125,
    })
    expect(rows[0]?.footprint.systemChars).toBe(prompt.system.length)
    expect(rows[0]?.tools[0]?.name).toBe('read')
  })

  it('marks repeated prompt envelopes as inherited', () => {
    const rows = contextRequestRows([{
      purpose: 'assistant',
      startSeq: 1,
      turn: 1,
      step: 1,
      status: 'running',
      startedAt: 1,
      completedAt: null,
      prompt,
    }] as unknown as RequestView[])

    expect(rows[0]?.promptChange).toBe('inherited')
    expect(rows[0]?.inputTokens).toBeNull()
  })

  it('treats foreign or malformed usage as unavailable', () => {
    const rows = contextRequestRows([{
      purpose: 'assistant',
      startSeq: 1,
      turn: 1,
      step: 1,
      status: 'complete',
      startedAt: 1,
      completedAt: 2,
      prompt,
      usage: { inputTokens: '100', cacheReadTokens: 25 },
    }] as unknown as RequestView[])

    expect(rows[0]?.inputTokens).toBeNull()
  })
})
