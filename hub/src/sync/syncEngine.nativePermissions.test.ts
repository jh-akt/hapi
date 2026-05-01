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

describe('SyncEngine native retirement routing', () => {
    it('rejects native approvals after tmux retirement', async () => {
        const approveRpc = mock(async () => {})
        const nativeSession = createNativeSession()
        const engine = {
            getSession: () => nativeSession,
            rpcGateway: {
                approvePermission: approveRpc
            }
        } as unknown as SyncEngine

        await expect(
            SyncEngine.prototype.approvePermission.call(engine, nativeSession.id, 'req-1', undefined, undefined, 'approved_for_session')
        ).rejects.toThrow('Native tmux sessions have been retired')

        expect(approveRpc).not.toHaveBeenCalled()
    })

    it('rejects native approvals with RPC-only extras after tmux retirement', async () => {
        const engine = {
            getSession: () => createNativeSession(),
            rpcGateway: {
                approvePermission: mock(async () => {})
            }
        } as unknown as SyncEngine

        await expect(
            SyncEngine.prototype.approvePermission.call(engine, 'session-native', 'req-1', 'acceptEdits')
        ).rejects.toThrow('Native tmux sessions have been retired')
    })

    it('rejects native denials after tmux retirement', async () => {
        const denyRpc = mock(async () => {})
        const nativeSession = createNativeSession()
        const engine = {
            getSession: () => nativeSession,
            rpcGateway: {
                denyPermission: denyRpc
            }
        } as unknown as SyncEngine

        await expect(
            SyncEngine.prototype.denyPermission.call(engine, nativeSession.id, 'req-1', 'abort')
        ).rejects.toThrow('Native tmux sessions have been retired')

        expect(denyRpc).not.toHaveBeenCalled()
    })

    it('rejects native resumes after tmux retirement', async () => {
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
            }
        } as unknown as SyncEngine

        await expect(SyncEngine.prototype.resumeSession.call(engine, nativeSession.id, 'default')).resolves.toEqual({
            type: 'error',
            message: 'Native tmux sessions have been retired',
            code: 'resume_unavailable'
        })
    })
})
