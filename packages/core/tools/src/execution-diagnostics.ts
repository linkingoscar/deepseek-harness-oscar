/**
 * Behavior-neutral diagnostic summaries derived from Code Mode execution
 * accounting. This module consumes already-derived durable facts and never
 * reads or influences live scheduler state.
 *
 * @module @deepseek-ai/dsh-tools/execution-diagnostics
 */

import type { CodeRunExecutionAccounting, CodeToolAccounting } from './execution-accounting.ts'

/** Aggregated durable execution facts for one tool name across Code Mode runs. */
export interface CodeToolExecutionSummary {
  /** Runs whose durable accounting contains at least one event for this tool. */
  runs: number
  /** Dispatches whose start event was durably appended. */
  started: number
  /** Started or orphan dispatches whose settle event was durably appended. */
  settled: number
  /** Settled dispatches whose durable outcome is an error. */
  failed: number
  /**
   * Exact sum of measured successful delivered-value bytes, or `null` when
   * the supplied exact subtotals cannot themselves be represented as one safe
   * integer. This is independent of {@link unmeasuredDeliveredValues}.
   */
  deliveredValueBytes: number | null
  /** Successful settles whose delivered-value byte evidence is unavailable upstream. */
  unmeasuredDeliveredValues: number
  /** Successful tool outcomes explicitly rejected at the Code Mode delivery boundary. */
  deliveryRejected: number
}

/**
 * Diagnostic roll-up across a supplied collection of Code Mode run-accounting
 * records. Every field is derived from those records; no scheduler or session
 * state is consulted.
 */
export interface CodeExecutionDiagnosticsSummary {
  /** Number of represented `run_code` accounting records. */
  runs: number
  /** Total durable sub-dispatch starts across represented runs. */
  started: number
  /** Total durable sub-dispatch settles across represented runs. */
  settled: number
  /** Total settled error outcomes. */
  failed: number
  /**
   * Exact sum of measured successful delivered-value bytes, or `null` when
   * the supplied exact run subtotals cannot be represented as one safe integer.
   */
  deliveredValueBytes: number | null
  /** Successful settles whose delivered-value byte evidence is unavailable upstream. */
  unmeasuredDeliveredValues: number
  /** Successful outcomes explicitly rejected by the Code Mode delivery boundary. */
  deliveryRejected: number
  /**
   * Largest run-local `peakInFlight` in the supplied accounting records.
   * This is deliberately not named a session/global peak: run summaries do
   * not contain enough ordering evidence to reconstruct overlap between runs.
   */
  maxRunPeakInFlight: number
  /** Started calls lacking a matching settle in the supplied evidence. */
  unsettled: number
  /** Settle events lacking a matching start in the supplied evidence. */
  orphanSettles: number
  /** Runs carrying at least one unsettled start or orphan settle. */
  runsWithIncompleteEvidence: number
  /** Per-tool aggregate execution facts keyed by durable tool name. */
  byTool: Readonly<Record<string, CodeToolExecutionSummary>>
}

type MutableCodeToolExecutionSummary = CodeToolExecutionSummary

function addExactBytes(total: number | null, value: number): number | null {
  if (total === null || !Number.isSafeInteger(value) || value < 0) return null
  const next = total + value
  return Number.isSafeInteger(next) ? next : null
}

function toolSummary(
  tools: Map<string, MutableCodeToolExecutionSummary>,
  name: string,
): MutableCodeToolExecutionSummary {
  let summary = tools.get(name)
  if (summary === undefined) {
    summary = {
      runs: 0,
      started: 0,
      settled: 0,
      failed: 0,
      deliveredValueBytes: 0,
      unmeasuredDeliveredValues: 0,
      deliveryRejected: 0,
    }
    tools.set(name, summary)
  }
  return summary
}

function addToolAccounting(summary: MutableCodeToolExecutionSummary, accounting: CodeToolAccounting): void {
  summary.runs += 1
  summary.started += accounting.started
  summary.settled += accounting.settled
  summary.failed += accounting.failed
  summary.deliveredValueBytes = addExactBytes(summary.deliveredValueBytes, accounting.deliveredValueBytes)
  summary.unmeasuredDeliveredValues += accounting.unmeasuredDeliveredValues
  summary.deliveryRejected += accounting.deliveryRejected
}

/**
 * Aggregate run-level execution accounting into one DevTools-friendly summary.
 *
 * The function is intentionally a second-stage projection: callers decide the
 * session/log slice passed to `deriveCodeRunExecutionAccounting`, then this
 * function rolls those durable facts up without inventing evidence that was
 * absent from the slice.
 *
 * @param runs - Run-level accounting records to summarize.
 * @returns Aggregate execution diagnostics with per-tool detail.
 */
export function summarizeCodeRunExecutionAccounting(
  runs: readonly CodeRunExecutionAccounting[],
): CodeExecutionDiagnosticsSummary {
  let started = 0
  let settled = 0
  let failed = 0
  let deliveredValueBytes: number | null = 0
  let unmeasuredDeliveredValues = 0
  let deliveryRejected = 0
  let maxRunPeakInFlight = 0
  let unsettled = 0
  let orphanSettles = 0
  let runsWithIncompleteEvidence = 0
  const byTool = new Map<string, MutableCodeToolExecutionSummary>()

  for (const run of runs) {
    started += run.started
    settled += run.settled
    failed += run.failed
    deliveredValueBytes = addExactBytes(deliveredValueBytes, run.deliveredValueBytes)
    unmeasuredDeliveredValues += run.unmeasuredDeliveredValues
    deliveryRejected += run.deliveryRejected
    maxRunPeakInFlight = Math.max(maxRunPeakInFlight, run.peakInFlight)
    unsettled += run.unsettled
    orphanSettles += run.orphanSettles
    if (run.unsettled > 0 || run.orphanSettles > 0) runsWithIncompleteEvidence += 1

    for (const [name, accounting] of Object.entries(run.byTool)) {
      addToolAccounting(toolSummary(byTool, name), accounting)
    }
  }

  return {
    runs: runs.length,
    started,
    settled,
    failed,
    deliveredValueBytes,
    unmeasuredDeliveredValues,
    deliveryRejected,
    maxRunPeakInFlight,
    unsettled,
    orphanSettles,
    runsWithIncompleteEvidence,
    byTool: Object.fromEntries(byTool),
  }
}
