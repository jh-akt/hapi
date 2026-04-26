import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, Session } from '@/types/api'
import { codexThreadToMessages } from '@/lib/codex-thread-messages'
import { queryKeys } from '@/lib/query-keys'

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
    loadedAt: number | null
    refetch: () => Promise<unknown>
} {
    const threadId = canReadCodexThreadFromAppServer(session)
        ? session.metadata.codexSessionId.trim()
        : null
    const enabled = Boolean(options?.enabled ?? true) && Boolean(api && session && threadId)

    const query = useQuery({
        queryKey: threadId && session ? queryKeys.codexThread(session.id, threadId) : ['codex-thread', 'disabled'],
        queryFn: async () => {
            if (!api || !session || !threadId) {
                throw new Error('Codex thread unavailable')
            }
            const response = await api.readCodexThread(session.id, {
                threadId,
                includeTurns: true
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
        const thread = query.data?.response.thread
        return thread ? codexThreadToMessages(thread) : []
    }, [query.data?.response.thread])

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
        loadedAt: query.data?.loadedAt ?? null,
        refetch: query.refetch
    }
}
