import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkerThreadCodeRuntime } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import type { CodeBindingFunction, CodeBindingNamespace } from '@deepseek-ai/dsh-code-runtime'
import { makeNamespaces } from '../src/bootstrap.ts'
import type { BootstrapPort, PendingCall } from '../src/bootstrap.ts'

async function setup(maxBindingValueBytes: number) {
  const ctx = new Context()
  await ctx.plugin(WorkerThreadCodeRuntime, { maxBindingValueBytes })
  return { ctx, runtime: ctx.codeRuntime as WorkerThreadCodeRuntime }
}

function tools(functions: Record<string, (args: unknown) => Promise<unknown>>): CodeBindingNamespace[] {
  return [{
    global: 'tools',
    functions: functions as Record<string, CodeBindingFunction>,
    errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
  }]
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return undefined
  } catch (error: unknown) {
    return error
  }
}

const TOOL_ERROR_CLASS = { name: 'ToolCallError', memberNameProperty: 'toolName' } as const

describe('WorkerThreadCodeRuntime — binding value byte budget', () => {
  it('rejects an oversized argument in the worker before posting or allocating a call id', async () => {
    let posts = 0
    const port: BootstrapPort = { postMessage: () => { posts += 1 }, on: () => {} }
    const pending = new Map<number, PendingCall>()
    const nextId = { value: 1 }
    const [namespace] = makeNamespaces({
      namespaces: [{ global: 'tools', names: ['echo'], errorClass: TOOL_ERROR_CLASS }],
      maxBindingValueBytes: 4,
    }, port, pending, nextId) as [Record<string, (args: unknown) => Promise<unknown>>]

    const failure = await rejectionOf(namespace.echo?.('€') ?? Promise.resolve())
    expect(failure).toMatchObject({
      name: 'ToolCallError',
      toolName: 'echo',
      message: 'binding arguments exceeded 4 bytes',
    })
    expect(posts).toBe(0)
    expect(pending.size).toBe(0)
    expect(nextId.value).toBe(1)
  })

  it('admits worker arguments at the exact UTF-8 JSON boundary and rejects one byte below before dispatch', async () => {
    const exact = await setup(5)
    let exactCalls = 0
    const exactResult = await exact.runtime.run({
      program: 'return await tools.echo("€")',
      bindings: tools({ echo: async (args) => { exactCalls += 1; return args } }),
    })
    expect(exactResult).toEqual({ logs: [], value: '€' })
    expect(exactCalls).toBe(1)

    const over = await setup(4)
    let overCalls = 0
    const overResult = await over.runtime.run({
      program: `
        try { await tools.echo('€') } catch (error) {
          return { name: error.name, toolName: error.toolName, message: error.message };
        }
      `,
      bindings: tools({ echo: async (args) => { overCalls += 1; return args } }),
    })
    expect(overResult.value).toEqual({
      name: 'ToolCallError',
      toolName: 'echo',
      message: 'binding arguments exceeded 4 bytes',
    })
    expect(overCalls).toBe(0)
  })

  it('admits host resolutions at the exact boundary and rejects an oversized resolution before transfer', async () => {
    const exact = await setup(5)
    const exactResult = await exact.runtime.run({
      program: 'return await tools.value(null)',
      bindings: tools({ value: async () => '€' }),
    })
    expect(exactResult).toEqual({ logs: [], value: '€' })

    const over = await setup(5)
    const overResult = await over.runtime.run({
      program: `
        try { await tools.value(null) } catch (error) {
          return { name: error.name, toolName: error.toolName, message: error.message };
        }
      `,
      bindings: tools({ value: async () => '€€' }),
    })
    expect(overResult.value).toEqual({
      name: 'ToolCallError',
      toolName: 'value',
      message: 'binding resolution exceeded 5 bytes',
    })
  })

  it('rechecks forged oversized arguments at the hostile host boundary before invoking the binding', async () => {
    const { runtime } = await setup(4)
    let forgedCalls = 0
    const result = await runtime.run({
      program: `
        const { parentPort } = await import('node:worker_threads');
        parentPort.postMessage({ type: 'call', id: 7777, global: 'tools', name: 'observe', args: '€' });
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'still-running';
      `,
      bindings: tools({ observe: async () => { forgedCalls += 1; return null } }),
    })
    expect(result).toEqual({ logs: [], value: 'still-running' })
    expect(forgedCalls).toBe(0)
  })

  it('keeps the new budget disabled at zero instead of inventing a product threshold', async () => {
    const { runtime } = await setup(0)
    const payload = 'x'.repeat(256 * 1024)
    const result = await runtime.run({
      program: `return await tools.echo(${JSON.stringify(payload)})`,
      bindings: tools({ echo: async args => args }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toBe(payload)
  })

  it('requires the configured binding budget to be a non-negative safe integer', async () => {
    for (const value of [-1, 4.5, Number.POSITIVE_INFINITY]) {
      const ctx = new Context()
      await expect(ctx.plugin(WorkerThreadCodeRuntime, { maxBindingValueBytes: value }))
        .rejects.toThrow(/maxBindingValueBytes must be a non-negative safe integer/)
    }
  })
})
