import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { getCodexModelOptionsFromModels, type ModelOption } from '@/components/AssistantChat/modelOptions'
import { queryKeys } from '@/lib/query-keys'
import type { CodexModel } from '@/types/api'

export function useCodexModels(
    api: ApiClient | null,
    sessionId: string | null,
    currentModel?: string | null,
    enabled: boolean = true
): {
    models: CodexModel[]
    modelOptions: ModelOption[]
    isLoading: boolean
    error: string | null
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.codexModels(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.listCodexModels(sessionId, {
                limit: 200,
                includeHidden: false
            })
        },
        enabled: Boolean(api && sessionId && enabled),
        retry: false,
        staleTime: 5 * 60_000
    })

    const models = query.data?.data ?? []
    const modelOptions = useMemo(
        () => getCodexModelOptionsFromModels(models, currentModel),
        [models, currentModel]
    )

    return {
        models,
        modelOptions,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load Codex models' : null
    }
}
