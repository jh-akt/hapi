import { describe, expect, it, mock } from 'bun:test'
import type { Session } from '@hapi/protocol/types'
import { SyncEngine } from './syncEngine'

function createNativeSession(): Session {
    return {
        id: 'session-native',
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
            source: 'native-attached',
            native: {
                tmuxSession: 'work-a',
                tmuxPane: '%1',
                command: 'codex',
                attachedAt: 1,
                attached: true
            }
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: true,
            requests: {
                'req-1': {
                    tool: 'CodexBash',
                    arguments: {
                        command: 'touch native-shell-perm.txt'
                    },
                    createdAt: 1
                }
            },
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default'
    }
}

describe('SyncEngine native permission routing', () => {
    it('routes native approvals through the native session manager', async () => {
        const approveNative = mock(async () => {})
        const approveRpc = mock(async () => {})
        const nativeSession = createNativeSession()
        const engine = {
            getSession: () => nativeSession,
            nativeSessions: {
                approvePermission: approveNative
            },
            rpcGateway: {
                approvePermission: approveRpc
            }
        } as unknown as SyncEngine

        await SyncEngine.prototype.approvePermission.call(engine, nativeSession.id, 'req-1', undefined, undefined, 'approved_for_session')

        expect(approveNative).toHaveBeenCalledWith(nativeSession.id, 'req-1', 'approved_for_session')
        expect(approveRpc).not.toHaveBeenCalled()
    })

    it('rejects native approvals that require RPC-only extras', async () => {
        const engine = {
            getSession: () => createNativeSession(),
            nativeSessions: {
                approvePermission: mock(async () => {})
            },
            rpcGateway: {
                approvePermission: mock(async () => {})
            }
        } as unknown as SyncEngine

        await expect(
            SyncEngine.prototype.approvePermission.call(engine, 'session-native', 'req-1', 'acceptEdits')
        ).rejects.toThrow('Native Codex approvals currently support decision-only responses')
    })

    it('routes native denials through the native session manager', async () => {
        const denyNative = mock(async () => {})
        const denyRpc = mock(async () => {})
        const nativeSession = createNativeSession()
        const engine = {
            getSession: () => nativeSession,
            nativeSessions: {
                denyPermission: denyNative
            },
            rpcGateway: {
                denyPermission: denyRpc
            }
        } as unknown as SyncEngine

        await SyncEngine.prototype.denyPermission.call(engine, nativeSession.id, 'req-1', 'abort')

        expect(denyNative).toHaveBeenCalledWith(nativeSession.id, 'req-1', 'abort')
        expect(denyRpc).not.toHaveBeenCalled()
    })

    it('requests restart-capable native resumes for inactive native sessions', async () => {
        const resumeNative = mock(async () => true)
        const nativeSession = {
            ...createNativeSession(),
            active: false,
            metadata: {
                ...createNativeSession().metadata,
                codexSessionId: '019db6cc-6755-76f0-bd5d-074e3428b87f'
            }
        }
        const engine = {
            sessionCache: {
                resolveSessionAccess: () => ({ ok: true, sessionId: nativeSession.id, session: nativeSession })
            },
            nativeSessions: {
                resume: resumeNative
            }
        } as unknown as SyncEngine

        await expect(SyncEngine.prototype.resumeSession.call(engine, nativeSession.id, 'default')).resolves.toEqual({
            type: 'success',
            sessionId: nativeSession.id
        })
        expect(resumeNative).toHaveBeenCalledWith(nativeSession.id, 'default', { allowRestart: true })
    })

    it('returns a structured native resume failure when tmux resume throws', async () => {
        const nativeSession = {
            ...createNativeSession(),
            active: false,
            metadata: {
                ...createNativeSession().metadata,
                codexSessionId: '019db6cc-6755-76f0-bd5d-074e3428b87f'
            }
        }
        const engine = {
            sessionCache: {
                resolveSessionAccess: () => ({ ok: true, sessionId: nativeSession.id, session: nativeSession })
            },
            nativeSessions: {
                resume: mock(async () => {
                    throw new Error('Failed to create tmux session for native resume')
                })
            }
        } as unknown as SyncEngine

        await expect(SyncEngine.prototype.resumeSession.call(engine, nativeSession.id, 'default')).resolves.toEqual({
            type: 'error',
            message: 'Failed to create tmux session for native resume',
            code: 'resume_failed'
        })
    })
})
