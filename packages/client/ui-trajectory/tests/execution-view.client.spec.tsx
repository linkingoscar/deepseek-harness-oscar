// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT,
  type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ExecutionView } from '../src/client/ExecutionView.tsx'
import { en, type TrajectoryKey } from '../src/client/locales.ts'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'

afterEach(cleanup)
const SID = 'execution-test' as SessionId

function useSession() {
  const trajectory: TrajectorySnapshot = {
    eventNodes: [], eventLocations: new Map(), requests: [], callSchemas: new Map(), partial: null, runningCalls: [],
    executionAccounting: [{
      rootCallId: 'root' as never, parentCallId: 'run-1' as never,
      started: 3, settled: 2, failed: 1, deliveredValueBytes: 12,
      unmeasuredDeliveredValues: 1, peakInFlight: 2, unsettled: 1, orphanSettles: 0,
      firstSeq: 10, lastSeq: 14, dispatchWindowMs: 25,
      byTool: {
        read: { started: 2, settled: 2, failed: 1, deliveredValueBytes: 12, unmeasuredDeliveredValues: 1 },
        grep: { started: 1, settled: 0, failed: 0, deliveredValueBytes: 0, unmeasuredDeliveredValues: 0 },
      },
    }],
  }
  const snapshot = {
    sessionId: SID,
    views: { get: (target: string) => target === 'trajectory' ? trajectory : undefined },
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [],
  } as unknown as ConversationSnapshot
  return bindSnapshotSelector(createSnapshotStore(snapshot))
}

describe('ExecutionView', () => {
  it('renders durable run and per-tool execution facts without normalizing unknown evidence away', () => {
    const props = { useSession: useSession(), t: (key: TrajectoryKey) => en[key] } as unknown as ComponentProps<typeof ExecutionView>
    render(<ExecutionView {...props} />)
    expect(screen.getByText('run_code run-1')).toBeTruthy()
    expect(screen.getByText('2/3')).toBeTruthy()
    expect(screen.getAllByText('12 B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unsettled / Orphan').length).toBeGreaterThan(0)
    expect(screen.getByText('read')).toBeTruthy()
    expect(screen.getByText(/Unknown-byte values 1/)).toBeTruthy()
  })
})
