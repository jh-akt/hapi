import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CodexThread, CodexTurn, DecryptedMessage, Session } from '@/types/api'
import { codexThreadToMessages } from '@/lib/codex-thread-messages'
import { queryKeys } from '@/lib/query-keys'

const INITIAL_VISIBLE_TURNS = 2
const LOAD_MORE_TURNS = 4

type VisibleTurnState = {
    threadId: string | null
    limit: number
}

export function canReadCodexThreadFromAppServer(session: Session | null | undefined): session is Session & {
    metadata: NonNullable<Session['metadata']> & { codexSessionId: string }
} {
    return Boolean(
        session
        && session.active
        && session.metadata?.flavor === 'codex'
        && session.metadata.source !== 'native-attached'
        && typeof session.metadata.codexSessionId === 'string'
        && session.metadata.codexSessionId.trim().length > 0
        && session.agentState?.controlledByUser !== true
    )
}

export function useCodexThreadMessages(
    api: ApiClient | null,
    session: Session | null | undefined,
    options?: { enabled?: boolean }
): {
    enabled: boolean
    shouldFallback: boolean
    messages: DecryptedMessage[]
    warning: string | null
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    messagesVersion: number
    loadedAt: number | null
    loadMore: () => Promise<unknown>
    refetch: () => Promise<unknown>
} {
    const threadId = canReadCodexThreadFromAppServer(session)
        ? session.metadata.codexSessionId.trim()
        : null
    const enabled = Boolean(options?.enabled ?? true) && Boolean(api && session && threadId)
    const [visibleTurnState, setVisibleTurnState] = useState<VisibleTurnState>({
        threadId: null,
        limit: INITIAL_VISIBLE_TURNS
    })
    const visibleTurnLimit = visibleTurnState.threadId === threadId
        ? visibleTurnState.limit
        : INITIAL_VISIBLE_TURNS

    useEffect(() => {
        setVisibleTurnState((current) => current.threadId === threadId
            ? current
            : { threadId, limit: INITIAL_VISIBLE_TURNS }
        )
    }, [threadId])

    const query = useQuery({
        queryKey: threadId && session
            ? [...queryKeys.codexThreadMessages(session.id, threadId), visibleTurnLimit] as const
            : ['codex-thread-messages', 'disabled'] as const,
        queryFn: async () => {
            if (!api || !session || !threadId) {
                throw new Error('Codex thread unavailable')
            }
            const response = await api.listCodexThreadTurns(session.id, {
                threadId,
                limit: visibleTurnLimit,
                sortDirection: 'desc'
            })
            return {
                response,
                loadedAt: Date.now()
            }
        },
        enabled,
        staleTime: 3_000
    })

    const messages = useMemo(() => {
        if (!threadId || !query.data?.response.data) {
            return []
        }
        const turns = [...query.data.response.data].reverse() as CodexTurn[]
        const thread: CodexThread = {
            id: threadId,
            turns,
            createdAt: turns[0]?.startedAt ?? undefined,
            updatedAt: turns[turns.length - 1]?.completedAt ?? turns[turns.length - 1]?.startedAt ?? undefined
        }
        return codexThreadToMessages(thread)
    }, [query.data?.response.data, threadId])

    const loadMore = useCallback(async () => {
        setVisibleTurnState((current) => ({
            threadId,
            limit: (current.threadId === threadId ? current.limit : INITIAL_VISIBLE_TURNS) + LOAD_MORE_TURNS
        }))
    }, [threadId])

    const warning = query.error
        ? query.error instanceof Error
            ? query.error.message
            : 'Failed to read Codex thread'
        : null

    return {
        enabled,
        shouldFallback: enabled && Boolean(query.error),
        messages,
        warning,
        isLoading: enabled && query.isLoading,
        isLoadingMore: enabled && query.isFetching && !query.isLoading,
        hasMore: Boolean(query.data?.response.nextCursor),
        messagesVersion: messages.length + visibleTurnLimit + (query.data?.loadedAt ?? 0),
        loadedAt: query.data?.loadedAt ?? null,
        loadMore,
        refetch: query.refetch
    }
}
