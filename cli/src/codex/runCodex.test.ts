import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCodexSession = vi.hoisted(() => ({
    getModel: vi.fn(() => undefined),
    getModelReasoningEffort: vi.fn(() => undefined),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    setModelReasoningEffort: vi.fn(),
    setCollaborationMode: vi.fn(),
    stopKeepAlive: vi.fn()
}))

const harness = vi.hoisted(() => ({
    bootstrapArgs: [] as Array<Record<string, unknown>>,
    loopArgs: [] as Array<Record<string, unknown>>,
    session: {
        onUserMessage: vi.fn(),
        rpcHandlerManager: {
            registerHandler: vi.fn()
        }
    }
}))

vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: vi.fn(async (options: Record<string, unknown>) => {
        harness.bootstrapArgs.push(options)
        return {
            api: {},
            session: harness.session
        }
    })
}))

vi.mock('./loop', () => ({
    loop: vi.fn(async (options: Record<string, unknown>) => {
        harness.loopArgs.push(options)
        const onSessionReady = options.onSessionReady as ((session: unknown) => void) | undefined
        onSessionReady?.(mockCodexSession)
    })
}))

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: vi.fn()
}))

vi.mock('@/agent/runnerLifecycle', () => ({
    createModeChangeHandler: vi.fn(() => vi.fn()),
    createRunnerLifecycle: vi.fn(() => ({
        registerProcessHandlers: vi.fn(),
        cleanupAndExit: vi.fn(async () => {}),
        markCrash: vi.fn(),
        setExitCode: vi.fn(),
        setArchiveReason: vi.fn()
    })),
    setControlledByUser: vi.fn()
}))

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn()
    }
}))

vi.mock('@/utils/attachmentFormatter', () => ({
    formatMessageWithAttachments: vi.fn((text: string) => text)
}))

vi.mock('@/utils/invokedCwd', () => ({
    getInvokedCwd: vi.fn(() => '/tmp/project')
}))

import { runCodex } from './runCodex'

describe('runCodex', () => {
    beforeEach(() => {
        harness.bootstrapArgs.length = 0
        harness.loopArgs.length = 0
        harness.session.onUserMessage.mockReset()
        harness.session.rpcHandlerManager.registerHandler.mockReset()
        mockCodexSession.getModel.mockReturnValue(undefined)
        mockCodexSession.getModelReasoningEffort.mockReturnValue(undefined)
        mockCodexSession.setPermissionMode.mockReset()
        mockCodexSession.setModel.mockReset()
        mockCodexSession.setModelReasoningEffort.mockReset()
        mockCodexSession.setCollaborationMode.mockReset()
    })

    it('persists resume thread id in metadata before the first turn', async () => {
        await runCodex({ resumeSessionId: 'thread-from-history', startedBy: 'runner' })

        expect(harness.bootstrapArgs[0]?.metadataOverrides).toEqual({
            codexSessionId: 'thread-from-history'
        })
        expect(harness.loopArgs[0]?.resumeSessionId).toBe('thread-from-history')
    })

    it('does not add codexSessionId metadata for a new thread', async () => {
        await runCodex({})

        expect(harness.bootstrapArgs[0]?.metadataOverrides).toBeUndefined()
        expect(harness.loopArgs[0]?.resumeSessionId).toBeUndefined()
    })
})
