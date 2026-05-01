import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function createSession(overrides?: Partial<Session>): Session {
    const baseMetadata = {
        path: '/tmp/project',
        host: 'localhost',
        flavor: 'codex' as const
    }
    const base: Session = {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: baseMetadata,
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default'
    }

    return {
        ...base,
        ...overrides,
        metadata: overrides?.metadata === undefined
            ? base.metadata
            : overrides.metadata === null
                ? null
                : {
                    ...baseMetadata,
                    ...overrides.metadata
                },
        agentState: overrides?.agentState === undefined ? base.agentState : overrides.agentState
    }
}

function createApp(session: Session) {
    const applySessionConfigCalls: Array<[string, Record<string, unknown>]> = []
    const applySessionConfig = async (sessionId: string, config: Record<string, unknown>) => {
        applySessionConfigCalls.push([sessionId, config])
    }
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
        applySessionConfig
    } as Partial<SyncEngine>

    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

    return { app, applySessionConfigCalls }
}

describe('sessions routes', () => {
    it('rejects collaboration mode changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects collaboration mode changes for non-Codex sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Collaboration mode is only supported for Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies collaboration mode changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/collaboration-mode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'plan' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { collaborationMode: 'plan' }]
        ])
    })

    it('applies model changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.4-mini' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { model: 'gpt-5.4-mini' }]
        ])
    })

    it('rejects model changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-5.4-mini' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model selection can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('forks a session with an optional target directory', async () => {
        const session = createSession()
        const forkCalls: Array<{ sessionId: string; namespace: string; directory?: string }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            forkSession: async (sessionId: string, namespace: string, options?: { directory?: string }) => {
                forkCalls.push({ sessionId, namespace, directory: options?.directory })
                return { type: 'success', sessionId: 'session-2' } as const
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ directory: '/tmp/project/subdir' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessionId: 'session-2' })
        expect(forkCalls).toEqual([
            { sessionId: 'session-1', namespace: 'default', directory: '/tmp/project/subdir' }
        ])
    })

    it('maps no-machine-online fork failures to 503', async () => {
        const session = createSession()
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            forkSession: async () => ({
                type: 'error',
                code: 'no_machine_online',
                message: 'No machine online'
            } as const)
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/fork', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
            error: 'No machine online',
            code: 'no_machine_online'
        })
    })

    it('archives inactive sessions too', async () => {
        const session = createSession({ active: false })
        const archiveCalls: string[] = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            archiveSession: async (sessionId: string) => {
                archiveCalls.push(sessionId)
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/archive', {
            method: 'POST'
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(archiveCalls).toEqual(['session-1'])
    })

    it('rejects codex app-server routes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app } = createApp(session)

        const response = await app.request('/api/sessions/session-1/codex/threads/list', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Codex app-server actions are only supported for remote Codex sessions'
        })
    })

    it('lists codex threads for remote Codex sessions', async () => {
        const session = createSession()
        const listCalls: Array<{ sessionId: string; params: Record<string, unknown> }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            listCodexThreads: async (sessionId: string, params: Record<string, unknown>) => {
                listCalls.push({ sessionId, params })
                return {
                    data: [{ id: 'thr_1', name: 'Thread 1' }],
                    nextCursor: null,
                    backwardsCursor: null
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/threads/list', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ archived: true, useStateDbOnly: true })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            data: [{ id: 'thr_1', name: 'Thread 1' }],
            nextCursor: null,
            backwardsCursor: null
        })
        expect(listCalls).toEqual([{
            sessionId: 'session-1',
            params: { archived: true, useStateDbOnly: true }
        }])
    })

    it('proxies allowed codex app-server methods for remote Codex sessions', async () => {
        const session = createSession()
        const calls: Array<{ sessionId: string; method: string; params: unknown }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            codexAppServer: async (sessionId: string, method: string, params: unknown) => {
                calls.push({ sessionId, method, params })
                return { data: [], nextCursor: null, backwardsCursor: null }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/app-server', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method: 'thread/list', params: { archived: false } })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ data: [], nextCursor: null, backwardsCursor: null })
        expect(calls).toEqual([{
            sessionId: 'session-1',
            method: 'thread/list',
            params: { archived: false }
        }])
    })

    it('reads codex thread history through the online runner machine when available', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex',
                machineId: 'machine-1',
                codexSessionId: 'thread-1'
            }
        })
        const sessionRpcCalls: unknown[] = []
        const machineReadCalls: Array<{ machineId: string; params: unknown }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            getMachineByNamespace: () => ({
                id: 'machine-1',
                namespace: 'default',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: {
                    host: 'localhost',
                    platform: 'darwin',
                    happyCliVersion: '0.0.0'
                },
                metadataVersion: 1,
                runnerState: null,
                runnerStateVersion: 1
            }),
            readCodexThreadFromMachine: async (machineId: string, params: unknown) => {
                machineReadCalls.push({ machineId, params })
                return { thread: { id: 'thread-1', turns: [{ id: 'turn-1' }] } }
            },
            codexAppServer: async (...args: unknown[]) => {
                sessionRpcCalls.push(args)
                throw new Error('session RPC should not be used')
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/app-server', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'thread/read',
                params: { threadId: 'thread-1', includeTurns: true }
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            thread: { id: 'thread-1', turns: [{ id: 'turn-1' }] }
        })
        expect(machineReadCalls).toEqual([{
            machineId: 'machine-1',
            params: { threadId: 'thread-1', includeTurns: true }
        }])
        expect(sessionRpcCalls).toEqual([])
    })

    it('lists codex models through the online runner machine when available', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex',
                machineId: 'machine-1',
                codexSessionId: 'thread-1'
            }
        })
        const sessionRpcCalls: unknown[] = []
        const machineCalls: Array<{ machineId: string; method: string; params: unknown }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            getMachineByNamespace: () => ({
                id: 'machine-1',
                namespace: 'default',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: {
                    host: 'localhost',
                    platform: 'darwin',
                    happyCliVersion: '0.0.0'
                },
                metadataVersion: 1,
                runnerState: null,
                runnerStateVersion: 1
            }),
            codexAppServerFromMachine: async (machineId: string, method: string, params: unknown) => {
                machineCalls.push({ machineId, method, params })
                return {
                    data: [{ id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4' }],
                    nextCursor: null
                }
            },
            codexAppServer: async (...args: unknown[]) => {
                sessionRpcCalls.push(args)
                throw new Error('session RPC should not be used')
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/app-server', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'model/list',
                params: { limit: 200, includeHidden: false }
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            data: [{ id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4' }],
            nextCursor: null
        })
        expect(machineCalls).toEqual([{
            machineId: 'machine-1',
            method: 'model/list',
            params: { limit: 200, includeHidden: false }
        }])
        expect(sessionRpcCalls).toEqual([])
    })

    it('lists codex thread turns through the online runner machine when available', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'codex',
                machineId: 'machine-1',
                codexSessionId: 'thread-1'
            }
        })
        const sessionRpcCalls: unknown[] = []
        const machineCalls: Array<{ machineId: string; method: string; params: unknown }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            getMachineByNamespace: () => ({
                id: 'machine-1',
                namespace: 'default',
                seq: 1,
                createdAt: 1,
                updatedAt: 1,
                active: true,
                activeAt: 1,
                metadata: {
                    host: 'localhost',
                    platform: 'darwin',
                    happyCliVersion: '0.0.0'
                },
                metadataVersion: 1,
                runnerState: null,
                runnerStateVersion: 1
            }),
            codexAppServerFromMachine: async (machineId: string, method: string, params: unknown) => {
                machineCalls.push({ machineId, method, params })
                return {
                    data: [{ id: 'turn-1', items: [] }],
                    nextCursor: 'next',
                    backwardsCursor: null
                }
            },
            codexAppServer: async (...args: unknown[]) => {
                sessionRpcCalls.push(args)
                throw new Error('session RPC should not be used')
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/app-server', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'thread/turns/list',
                params: { threadId: 'thread-1', limit: 4, sortDirection: 'desc' }
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            data: [{ id: 'turn-1', items: [] }],
            nextCursor: 'next',
            backwardsCursor: null
        })
        expect(machineCalls).toEqual([{
            machineId: 'machine-1',
            method: 'thread/turns/list',
            params: { threadId: 'thread-1', limit: 4, sortDirection: 'desc' }
        }])
        expect(sessionRpcCalls).toEqual([])
    })

    it('rejects unsupported codex app-server proxy methods', async () => {
        const session = createSession()
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {}
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/app-server', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method: 'fs/readFile', params: { path: '/tmp/a' } })
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Unsupported Codex app-server method'
        })
    })

    it('starts codex review for remote Codex sessions', async () => {
        const session = createSession()
        const reviewCalls: Array<{ sessionId: string; params: Record<string, unknown> }> = []
        const engine = {
            resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
            applySessionConfig: async () => {},
            startCodexReview: async (sessionId: string, params: Record<string, unknown>) => {
                reviewCalls.push({ sessionId, params })
                return {
                    turn: { id: 'turn-review' },
                    reviewThreadId: 'thr_review'
                }
            }
        } as Partial<SyncEngine>

        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/api', createSessionsRoutes(() => engine as SyncEngine))

        const response = await app.request('/api/sessions/session-1/codex/review', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                target: { type: 'uncommittedChanges' },
                delivery: 'detached'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            turn: { id: 'turn-review' },
            reviewThreadId: 'thr_review'
        })
        expect(reviewCalls).toEqual([{
            sessionId: 'session-1',
            params: {
                target: { type: 'uncommittedChanges' },
                delivery: 'detached'
            }
        }])
    })

    it('rejects model reasoning effort changes for non-Codex sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort is only supported for Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('rejects model reasoning effort changes for local Codex sessions', async () => {
        const session = createSession({
            agentState: {
                controlledByUser: true,
                requests: {},
                completedRequests: {}
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'high' })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Model reasoning effort can only be changed for remote Codex sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies model reasoning effort changes for remote Codex sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/model-reasoning-effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ modelReasoningEffort: 'xhigh' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { modelReasoningEffort: 'xhigh' }]
        ])
    })

    it('rejects effort changes for non-Claude sessions', async () => {
        const { app, applySessionConfigCalls } = createApp(createSession())

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'high' })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Effort selection is only supported for Claude sessions'
        })
        expect(applySessionConfigCalls).toEqual([])
    })

    it('applies effort changes for Claude sessions', async () => {
        const session = createSession({
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            }
        })
        const { app, applySessionConfigCalls } = createApp(session)

        const response = await app.request('/api/sessions/session-1/effort', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ effort: 'max' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(applySessionConfigCalls).toEqual([
            ['session-1', { effort: 'max' }]
        ])
    })
})
