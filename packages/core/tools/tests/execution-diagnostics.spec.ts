import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { CodeRunExecutionAccounting } from '../src/execution-accounting.ts'
import { summarizeCodeRunExecutionAccounting } from '../src/execution-diagnostics.ts'

function run(
  parent: string,
  overrides: Partial<CodeRunExecutionAccounting> = {},
): CodeRunExecutionAccounting {
  return {
    rootCallId: CallId('root'),
    parentCallId: CallId(parent),
    started: 0,
    settled: 0,
    failed: 0,
    deliveredValueBytes: 0,
    unmeasuredDeliveredValues: 0,
    deliveryRejected: 0,
    peakInFlight: 0,
    unsettled: 0,
    orphanSettles: 0,
    firstSeq: 1,
    lastSeq: 1,
    dispatchWindowMs: 0,
    byTool: {},
    ...overrides,
  }
}

describe('Code Mode execution diagnostics summary', () => {
  it('returns an explicit zero summary for empty evidence', () => {
    expect(summarizeCodeRunExecutionAccounting([])).toEqual({
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
  })

  it('aggregates run and per-tool execution facts without summing run-local peaks', () => {
    const summary = summarizeCodeRunExecutionAccounting([
      run('parent-a', {
        started: 2,
        settled: 2,
        deliveredValueBytes: 12,
        peakInFlight: 2,
        firstSeq: 1,
        lastSeq: 4,
        byTool: {
          read: { started: 1, settled: 1, failed: 0, deliveredValueBytes: 5, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
          grep: { started: 1, settled: 1, failed: 0, deliveredValueBytes: 7, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        },
      }),
      run('parent-b', {
        started: 1,
        settled: 1,
        deliveryRejected: 1,
        peakInFlight: 1,
        firstSeq: 5,
        lastSeq: 6,
        byTool: {
          read: { started: 1, settled: 1, failed: 0, deliveredValueBytes: 0, unmeasuredDeliveredValues: 0, deliveryRejected: 1 },
        },
      }),
      run('parent-c', {
        started: 1,
        settled: 1,
        failed: 1,
        peakInFlight: 1,
        firstSeq: 7,
        lastSeq: 8,
        byTool: {
          bash: { started: 1, settled: 1, failed: 1, deliveredValueBytes: 0, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        },
      }),
    ])

    expect(summary).toEqual({
      runs: 3,
      started: 4,
      settled: 4,
      failed: 1,
      deliveredValueBytes: 12,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 1,
      maxRunPeakInFlight: 2,
      unsettled: 0,
      orphanSettles: 0,
      runsWithIncompleteEvidence: 0,
      byTool: {
        read: { runs: 2, started: 2, settled: 2, failed: 0, deliveredValueBytes: 5, unmeasuredDeliveredValues: 0, deliveryRejected: 1 },
        grep: { runs: 1, started: 1, settled: 1, failed: 0, deliveredValueBytes: 7, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        bash: { runs: 1, started: 1, settled: 1, failed: 1, deliveredValueBytes: 0, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
      },
    })
  })

  it('surfaces incomplete durable evidence instead of normalizing it away', () => {
    const summary = summarizeCodeRunExecutionAccounting([
      run('parent-a', {
        started: 2,
        settled: 1,
        unsettled: 1,
        peakInFlight: 2,
        byTool: {
          read: { started: 2, settled: 1, failed: 0, deliveredValueBytes: 4, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        },
      }),
      run('parent-b', {
        settled: 1,
        orphanSettles: 1,
        unmeasuredDeliveredValues: 1,
        byTool: {
          grep: { started: 0, settled: 1, failed: 0, deliveredValueBytes: 0, unmeasuredDeliveredValues: 1, deliveryRejected: 0 },
        },
      }),
    ])

    expect(summary).toMatchObject({
      runs: 2,
      started: 2,
      settled: 2,
      deliveredValueBytes: 4,
      unmeasuredDeliveredValues: 1,
      maxRunPeakInFlight: 2,
      unsettled: 1,
      orphanSettles: 1,
      runsWithIncompleteEvidence: 2,
    })
  })

  it('marks cross-run and per-tool byte totals unrepresentable on safe-integer overflow', () => {
    const summary = summarizeCodeRunExecutionAccounting([
      run('parent-a', {
        deliveredValueBytes: Number.MAX_SAFE_INTEGER,
        byTool: {
          read: { started: 1, settled: 1, failed: 0, deliveredValueBytes: Number.MAX_SAFE_INTEGER, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        },
      }),
      run('parent-b', {
        deliveredValueBytes: 1,
        byTool: {
          read: { started: 1, settled: 1, failed: 0, deliveredValueBytes: 1, unmeasuredDeliveredValues: 0, deliveryRejected: 0 },
        },
      }),
    ])

    expect(summary.deliveredValueBytes).toBeNull()
    expect(summary.unmeasuredDeliveredValues).toBe(0)
    expect(summary.byTool.read?.deliveredValueBytes).toBeNull()
    expect(summary.byTool.read?.unmeasuredDeliveredValues).toBe(0)
  })
})
