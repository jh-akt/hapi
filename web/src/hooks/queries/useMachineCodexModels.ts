import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCodexModelOptionsFromModels } from '@/components/AssistantChat/modelOptions'
import type { NewSessionModelOption } from '@/components/NewSession/types'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { CodexModel } from '@/types/api'

function toNewSessionModelOptions(models: CodexModel[]): NewSessionModelOption[] {
    return getCodexModelOptionsFromModels(models).map((option) => ({
        value: option.value ?? 'auto',
        label: option.label
    }))
}

export function useMachineCodexModels(
    api: ApiClient | null,
    machineId: string | null,
    enabled: boolean
): {
    models: CodexModel[]
    modelOptions: NewSessionModelOption[]
    isLoading: boolean
    error: string | null
} {
    const resolvedMachineId = machineId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.machineCodexModels(resolvedMachineId),
        queryFn: async () => {
            if (!api || !machineId) {
                throw new Error('Machine unavailable')
            }
            return await api.listMachineCodexModels(machineId, {
                limit: 200,
                includeHidden: false
            })
        },
        enabled: Boolean(api && machineId && enabled),
        retry: false,
        staleTime: 5 * 60_000
    })

    const models = query.data?.data ?? []
    const modelOptions = useMemo(
        () => toNewSessionModelOptions(models),
        [models]
    )

    return {
        models,
        modelOptions,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load Codex models' : null
    }
}
