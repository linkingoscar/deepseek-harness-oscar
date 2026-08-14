import { describe, expect, it } from 'vitest'
import type { ConversationPromptSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  promptEnvelopeFootprint,
  promptEnvelopeSummary,
} from '../src/client/prompt-footprint.ts'

function prompt(): ConversationPromptSnapshot {
  return {
    config: { provider: 'test', model: 'model' },
    system: 'system prompt',
    tools: [{
      name: 'small',
      description: 'small tool',
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'large',
      description: 'large tool '.repeat(20),
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'query '.repeat(20) },
        },
      },
    }],
  } as ConversationPromptSnapshot
}

describe('promptEnvelopeFootprint', () => {
  it('measures reconstructed system and tool-schema strings without token estimates', () => {
    const value = prompt()
    const footprint = promptEnvelopeFootprint(value)

    expect(footprint.systemChars).toBe(value.system.length)
    expect(footprint.toolCount).toBe(2)
    expect(footprint.toolSchemaChars).toBe(JSON.stringify(value.tools).length)
    expect(footprint.largestTools.map(tool => tool.name)).toEqual(['large', 'small'])
    expect(footprint.largestTools[0]?.chars).toBe(JSON.stringify(value.tools[1]).length)
  })

  it('summarizes the largest schema in the ledger label', () => {
    const summary = promptEnvelopeSummary(prompt())

    expect(summary).toContain('13 system chars')
    expect(summary).toContain('2 tools /')
    expect(summary).toContain('schema chars')
    expect(summary).toContain('largest large')
    expect(summary).not.toContain('token')
  })
})
