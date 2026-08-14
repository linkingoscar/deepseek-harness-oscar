/**
 * Derived execution accounting for Code Mode runs.
 *
 * The projection is deliberately behavior-neutral: it reconstructs facts from
 * the durable `tool/code-dispatch-start` / `tool/code-dispatch` event pair and
 * does not add a second telemetry ledger to the session log.
 *
 * @module @deepseek-ai/dsh-tools/execution-accounting
 */

import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from './types.ts'

/** Per-tool durable dispatch counts inside one `run_code` call. */
export interface CodeToolAccounting {
  /** Dispatches whose start event was durably appended. */
  started: number
  /** Started dispatches whose settle event was durably appended. */
  settled: number
  /** Settled dispatches whose durable outcome is an error. */
  failed: number
  /** Exact measured JSON bytes delivered by successful settles carrying byte evidence. */
  deliveredValueBytes: number
  /** Successful settles whose delivered-value byte evidence is unavailable or cannot be represented exactly. */
  unmeasuredDeliveredValues: number
  /** Successful tool outcomes explicitly rejected at the Code Mode delivery boundary. */
  deliveryRejected: number
}

/**
 * Facts derivable from durable Code Mode sub-dispatch events for one parent
 * `run_code` call.
 *
 * `peakInFlight` is reconstructed from event sequence order, not timestamps:
 * each start enters the live set and its matching settle leaves it. That makes
 * the value independent of millisecond clock resolution.
 */
export interface CodeRunExecutionAccounting {
  rootCallId: CallId
  parentCallId: CallId
  /** Number of sub-dispatches that actually entered the scheduler/body pipeline. */
  started: number
  /** Number of durable sub-dispatch outcomes. */
  settled: number
  /** Number of settled outcomes marked as errors. */
  failed: number
  /** Exact measured JSON bytes delivered by successful settles carrying byte evidence. */
  deliveredValueBytes: number
  /** Successful settles whose delivered-value byte evidence is unavailable or cannot be represented exactly. */
  unmeasuredDeliveredValues: number
  /** Successful tool outcomes explicitly rejected at the Code Mode delivery boundary. */
  deliveryRejected: number
  /** Maximum number of started-but-not-yet-settled sub-dispatches observed in event order. */
  peakInFlight: number
  /** Started calls that have no matching settle event in the supplied log slice. */
  unsettled: number
  /** Settle events that have no matching start event in the supplied log slice. */
  orphanSettles: number
  /** First durable sub-dispatch event sequence for this run. */
  firstSeq: number
  /** Last durable sub-dispatch event sequence for this run. */
  lastSeq: number
  /** Wall-clock span between the first and last durable sub-dispatch event. */
  dispatchWindowMs: number
  /** Per-tool counts keyed by the durable tool name. */
  byTool: Readonly<Record<string, CodeToolAccounting>>
}

interface MutableRunAccounting {
  rootCallId: CallId
  parentCallId: CallId
  started: number
  settled: number
  failed: number
  deliveredValueBytes: number
  unmeasuredDeliveredValues: number
  deliveryRejected: number
  peakInFlight: number
  orphanSettles: number
  firstSeq: number
  lastSeq: number
  firstTime: number
  lastTime: number
  active: Set<string>
  byTool: Map<string, CodeToolAccounting>
}

function toolCounter(run: MutableRunAccounting, name: string): CodeToolAccounting {
  let counter = run.byTool.get(name)
  if (counter === undefined) {
    counter = { started: 0, settled: 0, failed: 0, deliveredValueBytes: 0, unmeasuredDeliveredValues: 0, deliveryRejected: 0 }
    run.byTool.set(name, counter)
  }
  return counter
}

function getRun(
  runs: Map<string, MutableRunAccounting>,
  event: SessionEvent<'tool/code-dispatch-start' | 'tool/code-dispatch'>,
): MutableRunAccounting {
  const key = String(event.data.parentCallId)
  let run = runs.get(key)
  if (run === undefined) {
    run = {
      rootCallId: event.data.rootCallId,
      parentCallId: event.data.parentCallId,
      started: 0,
      settled: 0,
      failed: 0,
      deliveredValueBytes: 0,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 0,
      peakInFlight: 0,
      orphanSettles: 0,
      firstSeq: event.seq,
      lastSeq: event.seq,
      firstTime: event.time,
      lastTime: event.time,
      active: new Set<string>(),
      byTool: new Map<string, CodeToolAccounting>(),
    }
    runs.set(key, run)
  }
  run.lastSeq = event.seq
  run.lastTime = event.time
  return run
}

/**
 * Reconstruct per-`run_code` execution accounting from a session event stream
 * or an ordered slice of one.
 *
 * Only durable Code Mode dispatch events are consumed. Calls submitted but
 * abandoned before scheduler start intentionally do not appear: there is no
 * durable evidence for them today, so this projection does not invent a count.
 *
 * @param events - Ordered session events or a contiguous ordered slice to inspect.
 * @returns One accounting record for each parent `run_code` call represented by the supplied durable events.
 */
export function deriveCodeRunExecutionAccounting(
  events: readonly SessionEvent[],
): CodeRunExecutionAccounting[] {
  const runs = new Map<string, MutableRunAccounting>()

  for (const event of events) {
    if (event.type === 'tool/code-dispatch-start') {
      const run = getRun(runs, event)
      run.started += 1
      run.active.add(String(event.data.subCallId))
      run.peakInFlight = Math.max(run.peakInFlight, run.active.size)
      toolCounter(run, event.data.name).started += 1
      continue
    }
    if (event.type !== 'tool/code-dispatch') continue

    const run = getRun(runs, event)
    run.settled += 1
    if (event.data.isError) run.failed += 1
    const counter = toolCounter(run, event.data.name)
    counter.settled += 1
    if (event.data.isError) counter.failed += 1
    else {
      if (event.data.deliveryRejection !== undefined) {
        run.deliveryRejected += 1
        counter.deliveryRejected += 1
      } else {
        const delivered = event.data.deliveredValueBytes
        if (typeof delivered === 'number' && Number.isSafeInteger(delivered) && delivered >= 0) {
        const runTotal = run.deliveredValueBytes + delivered
        if (Number.isSafeInteger(runTotal)) run.deliveredValueBytes = runTotal
        else run.unmeasuredDeliveredValues += 1
        const toolTotal = counter.deliveredValueBytes + delivered
        if (Number.isSafeInteger(toolTotal)) counter.deliveredValueBytes = toolTotal
        else counter.unmeasuredDeliveredValues += 1
        } else {
          run.unmeasuredDeliveredValues += 1
          counter.unmeasuredDeliveredValues += 1
        }
      }
    }

    const subCallId = String(event.data.subCallId)
    if (run.active.has(subCallId)) run.active.delete(subCallId)
    else run.orphanSettles += 1
  }

  return [...runs.values()].map((run) => ({
    rootCallId: run.rootCallId,
    parentCallId: run.parentCallId,
    started: run.started,
    settled: run.settled,
    failed: run.failed,
    deliveredValueBytes: run.deliveredValueBytes,
    unmeasuredDeliveredValues: run.unmeasuredDeliveredValues,
    deliveryRejected: run.deliveryRejected,
    peakInFlight: run.peakInFlight,
    unsettled: run.active.size,
    orphanSettles: run.orphanSettles,
    firstSeq: run.firstSeq,
    lastSeq: run.lastSeq,
    dispatchWindowMs: Math.max(0, run.lastTime - run.firstTime),
    byTool: Object.fromEntries(run.byTool),
  }))
}
