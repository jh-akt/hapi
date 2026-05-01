import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function isSessionMissingErrorMessage(message: string): boolean {
    return message.includes('HTTP 404')
        || message.includes('HTTP 403')
        || message.includes('Session not found')
        || message.includes('Session access denied')
}

export function useSession(api: ApiClient | null, sessionId: string | null): {
    session: Session | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.session(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.getSession(sessionId)
        },
        enabled: Boolean(api && sessionId),
        retry: (failureCount, error) => {
            if (error instanceof Error && isSessionMissingErrorMessage(error.message)) {
                return false
            }
            return failureCount < 2
        }
    })

    return {
        session: query.data?.session ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load session' : null,
        refetch: query.refetch,
    }
}
