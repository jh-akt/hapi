import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type {
    CodexCollaborationMode,
    CodexReviewStartParams,
    CodexReviewStartResponse,
    PermissionMode,
    SessionSource
} from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow } from '@/lib/message-window-store'
import { isKnownFlavor } from '@/lib/agentFlavorUtils'

type SessionActionOptions = {
    codexThreadId?: string | null
    sessionSource?: SessionSource | null
    sessionActive?: boolean
    sessionPath?: string | null
}

export function useSessionActions(
    api: ApiClient | null,
    sessionId: string | null,
    agentFlavor?: string | null,
    codexCollaborationModeSupported?: boolean,
    actionOptions?: SessionActionOptions
): {
    abortSession: () => Promise<void>
    archiveSession: () => Promise<void>
    unarchiveSession: () => Promise<void>
    forkSession: (options?: { directory?: string }) => Promise<string>
    rollbackCodexThread: (numTurns: number) => Promise<void>
    compactCodexThread: () => Promise<void>
    switchSession: () => Promise<void>
    startCodexReview: (params: CodexReviewStartParams) => Promise<CodexReviewStartResponse>
    setPermissionMode: (mode: PermissionMode) => Promise<void>
    setCollaborationMode: (mode: CodexCollaborationMode) => Promise<void>
    setModel: (model: string | null) => Promise<void>
    setModelReasoningEffort: (modelReasoningEffort: string | null) => Promise<void>
    setEffort: (effort: string | null) => Promise<void>
    renameSession: (name: string) => Promise<void>
    deleteSession: () => Promise<void>
    isPending: boolean
} {
    const queryClient = useQueryClient()
    const codexThreadId = actionOptions?.codexThreadId?.trim() || null
    const codexThreadActionSupported = agentFlavor === 'codex'
        && actionOptions?.sessionSource !== 'native-attached'
        && typeof codexThreadId === 'string'
        && codexThreadId.length > 0

    const invalidateSession = async (extraSessionIds: string[] = []) => {
        if (!sessionId) return
        const sessionIds = [sessionId, ...extraSessionIds.filter((id) => id && id !== sessionId)]
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        for (const extraSessionId of extraSessionIds) {
            if (extraSessionId && extraSessionId !== sessionId) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.session(extraSessionId) })
            }
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        await queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions })
        await queryClient.invalidateQueries({ queryKey: queryKeys.nativeSessions })
        if (codexThreadActionSupported && codexThreadId) {
            for (const id of sessionIds) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.codexThread(id, codexThreadId) })
                await queryClient.invalidateQueries({ queryKey: queryKeys.codexThreadTurns(id, codexThreadId) })
            }
        }
    }

    const resolveCodexThreadActionSessionId = async (): Promise<string> => {
        if (!api || !sessionId) {
            throw new Error('Session unavailable')
        }
        if (!codexThreadActionSupported) {
            throw new Error('Codex thread actions are unavailable for this session')
        }
        if (actionOptions?.sessionActive) {
            return sessionId
        }
        return await api.resumeSession(sessionId)
    }

    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.abortSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const archiveMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (codexThreadActionSupported) {
                const resolvedSessionId = await resolveCodexThreadActionSessionId()
                await api.archiveCodexThread(resolvedSessionId, {
                    threadId: actionOptions?.codexThreadId ?? undefined
                })
                return resolvedSessionId
            }
            await api.archiveSession(sessionId)
            return sessionId
        },
        onSuccess: (resolvedSessionId) => void invalidateSession(
            resolvedSessionId ? [resolvedSessionId] : []
        ),
    })

    const unarchiveMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (!codexThreadActionSupported) {
                throw new Error('Unarchive is only supported for remote Codex threads')
            }
            const resolvedSessionId = await resolveCodexThreadActionSessionId()
            await api.unarchiveCodexThread(resolvedSessionId, {
                threadId: actionOptions?.codexThreadId ?? undefined
            })
            return resolvedSessionId
        },
        onSuccess: (resolvedSessionId) => void invalidateSession(
            resolvedSessionId ? [resolvedSessionId] : []
        ),
    })

    const forkMutation = useMutation({
        mutationFn: async (forkOptions?: { directory?: string }) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (codexThreadActionSupported && codexThreadId) {
                const resolvedSessionId = await resolveCodexThreadActionSessionId()
                const forked = await api.forkCodexThread(resolvedSessionId, {
                    threadId: codexThreadId,
                    cwd: forkOptions?.directory
                })
                const nextThreadId = forked.thread.id
                const cwd = forked.thread.cwd
                    ?? forked.thread.path
                    ?? forked.cwd
                    ?? forkOptions?.directory
                    ?? actionOptions?.sessionPath
                    ?? ''
                if (!nextThreadId || !cwd) {
                    throw new Error('Forked Codex thread did not return an openable thread')
                }
                const opened = await api.openCodexSession({
                    cwd,
                    codexSessionId: nextThreadId,
                    title: forked.thread.name ?? forked.thread.preview ?? undefined,
                    openStrategy: 'open-app-server-thread'
                })
                return opened.sessionId
            }
            return await api.forkSession(sessionId, forkOptions)
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions })
            await queryClient.invalidateQueries({ queryKey: queryKeys.nativeSessions })
        },
    })

    const rollbackMutation = useMutation({
        mutationFn: async (numTurns: number) => {
            if (!api || !sessionId || !codexThreadId) {
                throw new Error('Session unavailable')
            }
            if (!codexThreadActionSupported) {
                throw new Error('Rollback is only supported for remote Codex threads')
            }
            const resolvedSessionId = await resolveCodexThreadActionSessionId()
            await api.rollbackCodexThread(resolvedSessionId, {
                threadId: codexThreadId,
                numTurns
            })
            return resolvedSessionId
        },
        onSuccess: (resolvedSessionId) => void invalidateSession(
            resolvedSessionId ? [resolvedSessionId] : []
        ),
    })

    const compactMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId || !codexThreadId) {
                throw new Error('Session unavailable')
            }
            if (!codexThreadActionSupported) {
                throw new Error('Compact is only supported for remote Codex threads')
            }
            const resolvedSessionId = await resolveCodexThreadActionSessionId()
            await api.compactCodexThread(resolvedSessionId, {
                threadId: codexThreadId
            })
            return resolvedSessionId
        },
        onSuccess: (resolvedSessionId) => void invalidateSession(
            resolvedSessionId ? [resolvedSessionId] : []
        ),
    })

    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.switchSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const codexReviewMutation = useMutation({
        mutationFn: async (params: CodexReviewStartParams) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Review is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Review is only supported for remote Codex sessions')
            }
            return await api.startCodexReview(sessionId, params)
        },
        onSuccess: () => void invalidateSession(),
    })

    const permissionMutation = useMutation({
        mutationFn: async (mode: PermissionMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (isKnownFlavor(agentFlavor) && !isPermissionModeAllowedForFlavor(mode, agentFlavor)) {
                throw new Error('Invalid permission mode for session flavor')
            }
            await api.setPermissionMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const collaborationMutation = useMutation({
        mutationFn: async (mode: CodexCollaborationMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Collaboration mode is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Collaboration mode is only supported for remote Codex sessions')
            }
            await api.setCollaborationMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelMutation = useMutation({
        mutationFn: async (model: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setModel(sessionId, model)
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelReasoningEffortMutation = useMutation({
        mutationFn: async (modelReasoningEffort: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (agentFlavor !== 'codex') {
                throw new Error('Model reasoning effort is only supported for Codex sessions')
            }
            if (!codexCollaborationModeSupported) {
                throw new Error('Model reasoning effort is only supported for remote Codex sessions')
            }
            await api.setModelReasoningEffort(sessionId, modelReasoningEffort)
        },
        onSuccess: () => void invalidateSession(),
    })

    const effortMutation = useMutation({
        mutationFn: async (effort: string | null) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setEffort(sessionId, effort)
        },
        onSuccess: () => void invalidateSession(),
    })

    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (codexThreadActionSupported && codexThreadId) {
                const resolvedSessionId = await resolveCodexThreadActionSessionId()
                await api.renameCodexThread(resolvedSessionId, {
                    threadId: codexThreadId,
                    name
                })
                await api.renameSession(resolvedSessionId, name)
                return
            }
            await api.renameSession(sessionId, name)
        },
        onSuccess: () => void invalidateSession(),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.deleteSession(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            clearMessageWindow(sessionId)
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await queryClient.invalidateQueries({ queryKey: queryKeys.codexSessions })
        },
    })

    return {
        abortSession: abortMutation.mutateAsync,
        archiveSession: async () => {
            await archiveMutation.mutateAsync()
        },
        unarchiveSession: async () => {
            await unarchiveMutation.mutateAsync()
        },
        forkSession: forkMutation.mutateAsync,
        rollbackCodexThread: async (numTurns: number) => {
            await rollbackMutation.mutateAsync(numTurns)
        },
        compactCodexThread: async () => {
            await compactMutation.mutateAsync()
        },
        switchSession: switchMutation.mutateAsync,
        startCodexReview: codexReviewMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setCollaborationMode: collaborationMutation.mutateAsync,
        setModel: modelMutation.mutateAsync,
        setModelReasoningEffort: modelReasoningEffortMutation.mutateAsync,
        setEffort: effortMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        isPending: abortMutation.isPending
            || archiveMutation.isPending
            || unarchiveMutation.isPending
            || forkMutation.isPending
            || rollbackMutation.isPending
            || compactMutation.isPending
            || switchMutation.isPending
            || codexReviewMutation.isPending
            || permissionMutation.isPending
            || collaborationMutation.isPending
            || modelMutation.isPending
            || modelReasoningEffortMutation.isPending
            || effortMutation.isPending
            || renameMutation.isPending
            || deleteMutation.isPending,
    }
}
