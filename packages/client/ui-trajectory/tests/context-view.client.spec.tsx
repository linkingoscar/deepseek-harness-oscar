// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import {
  bindSnapshotSelector,
} from '@deepseek-ai/dsh-client-web-react'
import {
  createSnapshotStore,
  EMPTY_CHAT_SNAPSHOT,
  type ConversationSnapshot,
  type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ContextView } from '../src/client/ContextView.tsx'
import { en, type TrajectoryKey } from '../src/client/locales.ts'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'

afterEach(cleanup)

const SID = 'context-test' as SessionId

function useSession() {
  const trajectory: TrajectorySnapshot = {
    eventNodes: [],
    eventLocations: new Map(),
    requests: [{
      purpose: 'assistant',
      startSeq: 5,
      turn: 2,
      step: 1,
      status: 'complete',
      startedAt: 10,
      completedAt: 20,
      prompt: {
        config: { provider: 'test', model: 'model' },
        system: 'You are the test agent.',
        tools: [{
          name: 'read',
          description: 'Read one file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        }],
      },
      promptChange: { seq: 4, time: 9, kind: 'initial' },
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 25 },
    }],
    callSchemas: new Map(),
    partial: null,
    runningCalls: [],
  }
  const snapshot = {
    sessionId: SID,
    views: { get: (target: string) => target === 'trajectory' ? trajectory : undefined },
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [],
  } as unknown as ConversationSnapshot
  return bindSnapshotSelector(createSnapshotStore(snapshot))
}

describe('ContextView', () => {
  it('shows request footprint and expands the reconstructed prompt envelope', () => {
    const props = {
      useSession: useSession(),
      t: (key: TrajectoryKey) => en[key],
    } as unknown as ComponentProps<typeof ContextView>
    render(<ContextView {...props} />)

    expect(screen.getByText('Request #1')).toBeTruthy()
    expect(screen.getByText('Initial prompt')).toBeTruthy()
    expect(screen.getByText('125 tok')).toBeTruthy()
    expect(screen.getAllByText(/read · .* chars/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Request #1'))
    expect(screen.getByText('You are the test agent.')).toBeTruthy()
    expect(screen.getByText('Read one file')).toBeTruthy()
  })
})
