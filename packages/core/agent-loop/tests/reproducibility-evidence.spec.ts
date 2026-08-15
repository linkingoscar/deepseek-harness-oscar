import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type ReplayEvidenceDigest } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function digest(hex: string): ReplayEvidenceDigest {
  return { algorithm: 'sha256', digest: hex.repeat(64).slice(0, 64) }
}

const A = digest('a')
const B = digest('b')
const C = digest('c')
const D = digest('d')

describe('request reproducibility evidence capture', () => {
  it('captures from the committed request/header before provider dispatch', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('replay-evidence'), { provider: 'mock', model: 'mock' })
    const order: string[] = []

    ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'request/header') order.push('header')
      if (event.type === 'replay/reproducibility-evidence') order.push('evidence')
    })
    ctx.on('agent/request-reproducibility-evidence', ({
      agent: subject,
      requestHeaderSeq,
      header,
      sink,
    }) => {
      if (subject !== agent) return
      order.push('capture')
      const logged = agent.session.events[requestHeaderSeq]
      expect(logged?.type).toBe('request/header')
      if (logged?.type !== 'request/header') throw new Error('expected committed request/header')
      expect(header).toBe(logged.data.header)
      expect(adapter.requests).toHaveLength(0)
      sink.add({ identity: { runtime: A, toolSchemas: B } })
    })

    send(agent, 'run')
    await agent.whenIdle()

    expect(order).toEqual(['header', 'capture', 'evidence'])
    const headerEvent = agent.session.events.find(event => event.type === 'request/header')
    const evidenceEvent = agent.session.events.find(event => event.type === 'replay/reproducibility-evidence')
    expect(headerEvent?.type).toBe('request/header')
    expect(evidenceEvent?.type).toBe('replay/reproducibility-evidence')
    if (headerEvent?.type !== 'request/header' || evidenceEvent?.type !== 'replay/reproducibility-evidence') {
      throw new Error('expected request header and reproducibility evidence')
    }
    expect(evidenceEvent.data).toEqual({
      version: 1,
      requestHeaderSeq: headerEvent.seq,
      identity: { runtime: A, toolSchemas: B },
    })
    expect(adapter.requests).toHaveLength(1)
  })

  it('contains bad contributors and removes conflicting fields without vetoing the request', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const agent = ctx.agentLoop.create(SessionId('replay-evidence-conflict'), { provider: 'mock', model: 'mock' })

    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject !== agent) return
      sink.add({ identity: { runtime: A, configuration: C } })
    })
    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject !== agent) return
      sink.add({ identity: { runtime: B } })
      throw new Error('contributor failed after a valid contribution')
    })
    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject !== agent) return
      sink.add({ identity: { pluginGraph: { algorithm: 'sha256', digest: 'bad' } } })
    })
    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject !== agent) return
      sink.add({ identity: { pluginGraph: D } })
    })

    send(agent, 'run')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    const evidenceEvent = agent.session.events.find(event => event.type === 'replay/reproducibility-evidence')
    expect(evidenceEvent?.type).toBe('replay/reproducibility-evidence')
    if (evidenceEvent?.type !== 'replay/reproducibility-evidence') throw new Error('expected evidence')
    expect(evidenceEvent.data.identity).toEqual({ configuration: C, pluginGraph: D })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent event "agent/request-reproducibility-evidence" listener threw'))
  })

  it('does not emit an evidence event when every accepted field is disputed', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('replay-evidence-empty'), { provider: 'mock', model: 'mock' })

    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject === agent) sink.add({ identity: { runtime: A } })
    })
    ctx.on('agent/request-reproducibility-evidence', ({ agent: subject, sink }) => {
      if (subject === agent) sink.add({ identity: { runtime: B } })
    })

    send(agent, 'run')
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.some(event => event.type === 'replay/reproducibility-evidence')).toBe(false)
  })
})
