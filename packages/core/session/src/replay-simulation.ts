/**
 * Effect-free simulated replay over reconstructed historical requests.
 *
 * This module validates the caller-supplied simulation contract and delegates
 * only the opaque evaluation result to that executor. It performs no live fork,
 * model call, tool dispatch, session append, or external-state restoration.
 */

import { reconstructReplayRequest } from './replay-request.ts'
import type { ReplayRequestSnapshot } from './replay-request.ts'
import type { SessionEvent } from './types.ts'

/** Caller-supplied executor for simulated replay. */
export interface ReplaySimulationExecutor<Result = unknown> {
  /** Stable human-readable executor identity included in the replay result. */
  readonly id: string
  /** Simulated replay is effect-free by contract. */
  readonly effects: 'none'
  /** Evaluate one reconstructed historical request without mutating the source log. */
  execute(request: ReplayRequestSnapshot): Result | Promise<Result>
}

/** Result of one executor-driven simulated replay. */
export interface ReplaySimulation<Result = unknown> {
  /** Replay mode, fixed for discriminated consumers. */
  readonly mode: 'simulated'
  /** Executor identity copied from the validated executor contract. */
  readonly executorId: string
  /** Exact Harness-owned historical request supplied to the executor. */
  readonly request: ReplayRequestSnapshot
  /** Opaque executor-owned simulation result. */
  readonly result: Result
}

/** Error raised before a simulated executor is entered. */
export class ReplaySimulationError extends Error {
  /**
   * @param message - Human-readable simulated replay contract failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'ReplaySimulationError'
  }
}

/**
 * Execute one historical request through a caller-supplied effect-free executor.
 *
 * @param events - Full validated current-format session log in sequence order.
 * @param executor - Effect-free executor used to evaluate the reconstructed request.
 * @param requestHeaderSeq - Optional exact historical `request/header`; omitted selects the latest.
 * @returns The reconstructed request plus the executor's opaque result.
 */
export async function simulateReplayRequest<Result>(
  events: readonly SessionEvent[],
  executor: ReplaySimulationExecutor<Result>,
  requestHeaderSeq?: number,
): Promise<ReplaySimulation<Result>> {
  const executorValue: unknown = executor
  if (typeof executorValue !== 'object' || executorValue === null) {
    throw new ReplaySimulationError('simulated replay executor must be an object')
  }
  const executorId = 'id' in executorValue ? executorValue.id : undefined
  const executorEffects = 'effects' in executorValue ? executorValue.effects : undefined
  if (typeof executorId !== 'string' || executorId.trim().length === 0) {
    throw new ReplaySimulationError('simulated replay executor id must be a non-empty string')
  }
  if (executorEffects !== 'none') {
    throw new ReplaySimulationError('simulated replay executor must declare effects: "none"')
  }

  const request = reconstructReplayRequest(events, requestHeaderSeq)
  if (request === undefined) {
    throw new ReplaySimulationError('simulated replay requires a reconstructable request/header')
  }

  const result = await executor.execute(request)
  return Object.freeze({
    mode: 'simulated',
    executorId,
    request,
    result,
  })
}
