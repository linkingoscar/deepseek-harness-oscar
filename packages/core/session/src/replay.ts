/**
 * Public replay facade for capability inspection and effect-free simulation.
 *
 * Replay modes retain distinct evidence and effect semantics. Request
 * reconstruction, durable reproducibility evidence, and simulated execution do
 * not imply that live external effects can be reproduced.
 *
 * @module @deepseek-ai/dsh-session/replay
 */

export type {
  ReplayEvidenceDigest,
  ReplayIdentityManifest,
  ReplayReproducibilityEvidence,
  ReplaySnapshotReference,
} from './types.ts'

export {
  inspectReplayCapabilities,
  ReplayInspectionError,
} from './replay-inspection.ts'
export type {
  ReplayAvailability,
  ReplayBlockerCode,
  ReplayCapability,
  ReplayEffectSemantics,
  ReplayInspection,
  ReplayMode,
} from './replay-inspection.ts'

export {
  ReplaySimulationError,
  simulateReplayRequest,
} from './replay-simulation.ts'
export type {
  ReplaySimulation,
  ReplaySimulationExecutor,
} from './replay-simulation.ts'
