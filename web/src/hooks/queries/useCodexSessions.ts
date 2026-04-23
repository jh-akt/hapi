import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CodexSessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useCodexSessions(api: ApiClient | null): {
    sessions: CodexSessionSummary[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.codexSessions,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getCodexSessions()
        },
        enabled: Boolean(api),
        refetchInterval: api ? 5_000 : false
    })

    return {
        sessions: query.data?.sessions ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load Codex sessions' : null,
        refetch: query.refetch
    }
}
