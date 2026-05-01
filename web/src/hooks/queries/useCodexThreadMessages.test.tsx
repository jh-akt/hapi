import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Session } from '@/types/api'
import { useCodexThreadMessages } from './useCodexThreadMessages'

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false
            }
        }
    })

    function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    return { queryClient, Wrapper }
}

function createSession(codexSessionId: string): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex',
            source: 'managed',
            codexSessionId
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null
    }
}

function createMockApi() {
    const listCodexThreadTurns = vi.fn(async (
        _sessionId: string,
        params: { threadId?: string | null; limit?: number | null; sortDirection?: string | null }
    ) => ({
        data: [
            {
                id: `${params.threadId ?? 'thread'}-${params.limit ?? 0}`,
                startedAt: 1000,
                items: []
            }
        ],
        nextCursor: params.limit === 2 ? 'older' : null,
        backwardsCursor: null
    }))

    return {
        api: { listCodexThreadTurns } as unknown as ApiClient,
        listCodexThreadTurns
    }
}

describe('useCodexThreadMessages', () => {
    it('loads the first page from thread/turns/list using an isolated query key', async () => {
        const { api, listCodexThreadTurns } = createMockApi()
        const { queryClient, Wrapper } = createWrapper()

        const { result } = renderHook(
            () => useCodexThreadMessages(api, createSession('thread-1')),
            { wrapper: Wrapper }
        )

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-1',
                limit: 2,
                sortDirection: 'desc'
            })
        })

        await waitFor(() => {
            expect(result.current.hasMore).toBe(true)
        })
        expect(queryClient.getQueryData([...queryKeys.codexThreadMessages('session-1', 'thread-1'), 2])).toBeDefined()
        expect(queryClient.getQueryData(queryKeys.codexThread('session-1', 'thread-1'))).toBeUndefined()
    })

    it('increases the turn limit when loading older messages', async () => {
        const { api, listCodexThreadTurns } = createMockApi()
        const { Wrapper } = createWrapper()

        const { result } = renderHook(
            () => useCodexThreadMessages(api, createSession('thread-1')),
            { wrapper: Wrapper }
        )

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-1',
                limit: 2,
                sortDirection: 'desc'
            })
        })

        await act(async () => {
            await result.current.loadMore()
        })

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-1',
                limit: 6,
                sortDirection: 'desc'
            })
        })
    })

    it('resets the visible turn limit when the thread changes', async () => {
        const { api, listCodexThreadTurns } = createMockApi()
        const { Wrapper } = createWrapper()

        const { result, rerender } = renderHook(
            ({ threadId }) => useCodexThreadMessages(api, createSession(threadId)),
            {
                initialProps: { threadId: 'thread-1' },
                wrapper: Wrapper
            }
        )

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-1',
                limit: 2,
                sortDirection: 'desc'
            })
        })

        await act(async () => {
            await result.current.loadMore()
        })

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-1',
                limit: 6,
                sortDirection: 'desc'
            })
        })

        rerender({ threadId: 'thread-2' })

        await waitFor(() => {
            expect(listCodexThreadTurns).toHaveBeenCalledWith('session-1', {
                threadId: 'thread-2',
                limit: 2,
                sortDirection: 'desc'
            })
        })

        const threadTwoCalls = listCodexThreadTurns.mock.calls.filter((call) => call[1]?.threadId === 'thread-2')
        expect(threadTwoCalls.map((call) => call[1]?.limit)).toEqual([2])
    })
})
