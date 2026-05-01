import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createCodexSessionsRoutes } from './codexSessions'

const tempDirs: string[] = []

function makeTempCodexHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-codex-catalog-'))
    tempDirs.push(dir)
    return dir
}

function writeTranscriptFile(options: {
    codexHomeDir: string
    fileName: string
    sessionId: string
    cwd: string
    timestamp: string
    userMessages?: string[]
    source?: string
    originator?: string
}): void {
    const sessionsDir = join(options.codexHomeDir, 'sessions', '2026', '04', '24')
    mkdirSync(sessionsDir, { recursive: true })
    const filePath = join(sessionsDir, options.fileName)
    const lines = [
        JSON.stringify({
            type: 'session_meta',
            payload: {
                id: options.sessionId,
                timestamp: options.timestamp,
                cwd: options.cwd,
                source: options.source ?? 'cli',
                originator: options.originator ?? 'codex-tui'
            }
        }),
        ...(options.userMessages ?? []).map((message) => JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'user_message',
                message
            }
        }))
    ]
    writeFileSync(filePath, `${lines.join('\n')}\n`)
}

function createSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 10,
        active: true,
        activeAt: 1,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex',
            source: 'native-attached',
            codexSessionId: 'thread-1'
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: false,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        permissionMode: 'default',
        collaborationMode: 'default',
        ...overrides
    }
}

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 10,
        active: true,
        activeAt: 10,
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: '0.0.0',
            homeDir: homedir(),
            happyHomeDir: join(homedir(), '.hapi'),
            happyLibDir: join(homedir(), '.hapi')
        },
        metadataVersion: 1,
        runnerState: { status: 'running' },
        runnerStateVersion: 1,
        ...overrides
    }
}

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createCodexSessionsRoutes(() => ({
        getMachinesByNamespace: () => [],
        ...engine
    }) as SyncEngine))
    return app
}

afterEach(() => {
    delete process.env.CODEX_HOME
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('codex sessions routes', () => {
    it('uses app-server thread data to enrich the attached remote codex session', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        const listCalls: Array<{ sessionId: string; archived: boolean | null | undefined }> = []

        const currentThreadId = '55555555-5555-5555-5555-555555555555'

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    metadata: {
                        path: '/tmp/remote-project',
                        host: 'localhost',
                        flavor: 'codex',
                        source: 'managed',
                        machineId: 'machine-1',
                        codexSessionId: currentThreadId
                    }
                })
            ],
            listCodexThreads: async (sessionId: string, params?: { archived?: boolean | null }) => {
                listCalls.push({ sessionId, archived: params?.archived })
                if (params?.archived) {
                    return {
                        data: [
                            {
                                id: '66666666-6666-6666-6666-666666666666',
                                cwd: '/tmp/remote-project',
                                path: '/Users/tester/.codex/sessions/2026/04/24/rollout-archived.jsonl',
                                updatedAt: 150,
                                preview: 'older archived thread'
                            }
                        ],
                        nextCursor: null,
                        backwardsCursor: null
                    }
                }

                return {
                    data: [
                        {
                            id: currentThreadId,
                            cwd: '/tmp/remote-project',
                            path: '/Users/tester/.codex/sessions/2026/04/24/rollout-current.jsonl',
                            updatedAt: 300,
                            name: 'Remote current thread',
                            preview: 'live fix',
                            status: { type: 'active', activeFlags: ['responding'] }
                        }
                    ],
                    nextCursor: null,
                    backwardsCursor: null
                }
            }
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(listCalls).toEqual([
            { sessionId: 'session-1', archived: false },
            { sessionId: 'session-1', archived: true }
        ])
        const body = await response.json() as { sessions: unknown[] }
        expect(body.sessions).toEqual([
            expect.objectContaining({
                id: 'session-1',
                attachedSessionId: 'session-1',
                codexSessionId: currentThreadId,
                active: true,
                archived: false,
                codexOrigin: 'attached',
                openStrategy: 'navigate-attached',
                metadata: expect.objectContaining({
                    name: 'Remote current thread',
                    path: '/tmp/remote-project',
                    machineId: 'machine-1',
                    summary: { text: 'live fix' }
                })
            }),
            expect.objectContaining({
                id: 'codex:66666666-6666-6666-6666-666666666666',
                attachedSessionId: null,
                codexSessionId: '66666666-6666-6666-6666-666666666666',
                archived: true,
                codexOrigin: 'app-server-thread',
                openStrategy: 'open-app-server-thread',
                metadata: expect.objectContaining({
                    name: 'older archived thread',
                    path: '/tmp/remote-project',
                    machineId: 'machine-1',
                    summary: { text: 'older archived thread' }
                })
            })
        ])
    })

    it('returns attached codex sessions without transcript fallback entries', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T01-00-00-thread-1.jsonl',
            sessionId: '11111111-1111-1111-1111-111111111111',
            cwd: '/tmp/project',
            timestamp: '2026-04-24T01:00:00.000Z',
            userMessages: ['fix bug']
        })
        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T02-00-00-thread-2.jsonl',
            sessionId: '22222222-2222-2222-2222-222222222222',
            cwd: '/tmp/project-b',
            timestamp: '2026-04-24T02:00:00.000Z',
            userMessages: ['add tests']
        })

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    metadata: {
                        path: '/tmp/project',
                        host: 'localhost',
                        name: 'project',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: '11111111-1111-1111-1111-111111111111'
                    }
                })
            ]
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'session-1',
                    attachedSessionId: 'session-1',
                    codexSessionId: '11111111-1111-1111-1111-111111111111',
                    codexOrigin: 'attached',
                    openStrategy: 'navigate-attached',
                    metadata: expect.objectContaining({
                        name: 'project',
                        path: '/tmp/project',
                        agentSessionId: '11111111-1111-1111-1111-111111111111'
                    })
                })
            ]
        })
    })

    it('does not fall back to transcript entries when app-server thread listing fails', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T05-00-00-thread-5.jsonl',
            sessionId: '88888888-8888-8888-8888-888888888888',
            cwd: '/tmp/fallback-project',
            timestamp: '2026-04-24T05:00:00.000Z',
            userMessages: ['fallback transcript']
        })

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    metadata: {
                        path: '/tmp/remote-project',
                        host: 'localhost',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: '99999999-9999-9999-9999-999999999999'
                    }
                })
            ],
            listCodexThreads: async () => {
                throw new Error('unsupported')
            }
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'session-1',
                    attachedSessionId: 'session-1',
                    codexSessionId: '99999999-9999-9999-9999-999999999999',
                    metadata: expect.objectContaining({
                        path: '/tmp/remote-project',
                        agentSessionId: '99999999-9999-9999-9999-999999999999'
                    })
                })
            ]
        })
    })

    it('keeps explicit attached session names when they differ from the directory name', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T03-00-00-thread-3.jsonl',
            sessionId: '33333333-3333-3333-3333-333333333333',
            cwd: '/tmp/project-c',
            timestamp: '2026-04-24T03:00:00.000Z',
            userMessages: ['refactor runner']
        })

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    metadata: {
                        path: '/tmp/project-c',
                        host: 'localhost',
                        name: 'Release blocker fix',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: '33333333-3333-3333-3333-333333333333'
                    }
                })
            ]
        })

        const response = await app.request('/api/codex-sessions')
        expect(response.status).toBe(200)

        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        name: 'Release blocker fix'
                    })
                })
            ]
        })
    })

    it('marks attached active remote codex sessions archived when app-server reports the thread as archived', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-remote-archived',
                    active: true,
                    metadata: {
                        path: '/tmp/remote-archived-project',
                        host: 'localhost',
                        name: 'Archived remote thread',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: 'thread-remote-archived'
                    }
                })
            ],
            listCodexThreads: async (_sessionId: string, params?: { archived?: boolean | null }) => ({
                data: params?.archived
                    ? [
                        {
                            id: 'thread-remote-archived',
                            cwd: '/tmp/remote-archived-project',
                            preview: 'archived preview',
                            updatedAt: 1_777_000_001_000
                        }
                    ]
                    : [],
                nextCursor: null,
                backwardsCursor: null
            })
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'session-remote-archived',
                    attachedSessionId: 'session-remote-archived',
                    codexSessionId: 'thread-remote-archived',
                    archived: true,
                    metadata: expect.objectContaining({
                        name: 'Archived remote thread',
                        path: '/tmp/remote-archived-project',
                        agentSessionId: 'thread-remote-archived'
                    })
                })
            ]
        })
    })

    it('does not expose transcript-only Codex entries after native tmux retirement', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T04-00-00-thread-4.jsonl',
            sessionId: '44444444-4444-4444-4444-444444444444',
            cwd: '/tmp/project-d',
            timestamp: '2026-04-24T04:00:00.000Z',
            userMessages: ['inspect android build'],
            source: 'vscode',
            originator: 'happy-codex'
        })

        const app = createApp({
            getSessionsByNamespace: () => []
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: []
        })
    })

    it('normalizes attached session paths before returning them', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        const attachedPath = join(homedir(), 'Code', 'managed-project')

        writeTranscriptFile({
            codexHomeDir,
            fileName: 'rollout-2026-04-24T06-00-00-thread-6.jsonl',
            sessionId: '66666666-1111-1111-1111-111111111111',
            cwd: '～/Code/desktop-project/',
            timestamp: '2026-04-24T06:00:00.000Z',
            userMessages: ['resume desktop thread'],
            source: 'vscode',
            originator: 'Codex Desktop'
        })

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-managed-path',
                    metadata: {
                        path: '~/Code/managed-project/',
                        host: 'localhost',
                        name: 'Managed project',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: 'managed-thread-path'
                    }
                })
            ]
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: expect.arrayContaining([
                expect.objectContaining({
                    id: 'session-managed-path',
                    metadata: expect.objectContaining({
                        path: attachedPath
                    })
                })
            ])
        })
    })

    it('includes attached managed codex sessions without transcript history', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-remote',
                    updatedAt: 1_777_000_000_500,
                    activeAt: 1_777_000_000_450,
                    metadata: {
                        path: '/tmp/remote-project',
                        host: 'localhost',
                        name: 'Remote rollout',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: 'thread-remote-live'
                    }
                })
            ]
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'session-remote',
                    attachedSessionId: 'session-remote',
                    codexSessionId: 'thread-remote-live',
                    active: true,
                    metadata: expect.objectContaining({
                        name: 'Remote rollout',
                        path: '/tmp/remote-project',
                        source: 'managed',
                        agentSessionId: 'thread-remote-live'
                    })
                })
            ]
        })
    })

    it('includes unattached app-server threads as openable history placeholders', async () => {
        const codexHomeDir = makeTempCodexHome()
        process.env.CODEX_HOME = codexHomeDir

        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-remote',
                    updatedAt: 1_777_000_000_500,
                    activeAt: 1_777_000_000_450,
                    metadata: {
                        path: '/tmp/remote-project',
                        host: 'localhost',
                        name: 'Remote rollout',
                        flavor: 'codex',
                        source: 'managed',
                        codexSessionId: 'thread-attached'
                    }
                })
            ],
            listCodexThreads: async () => ({
                data: [
                    {
                        id: 'thread-orphan',
                        cwd: '/tmp/remote-project',
                        preview: 'orphan thread preview',
                        updatedAt: 900
                    }
                ],
                nextCursor: null,
                backwardsCursor: null
            })
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'session-remote',
                    attachedSessionId: 'session-remote',
                    codexSessionId: 'thread-attached',
                    metadata: expect.objectContaining({
                        name: 'Remote rollout',
                        path: '/tmp/remote-project',
                        agentSessionId: 'thread-attached'
                    })
                }),
                expect.objectContaining({
                    id: 'codex:thread-orphan',
                    attachedSessionId: null,
                    codexSessionId: 'thread-orphan',
                    codexOrigin: 'app-server-thread',
                    openStrategy: 'open-app-server-thread',
                    metadata: expect.objectContaining({
                        name: 'orphan thread preview',
                        path: '/tmp/remote-project',
                        agentSessionId: 'thread-orphan'
                    })
                })
            ]
        })
    })

    it('lists app-server threads through an online runner machine when no codex session exists', async () => {
        const app = createApp({
            getSessionsByNamespace: () => [],
            getMachinesByNamespace: () => [
                createMachine({
                    id: 'machine-catalog',
                    metadata: {
                        host: 'macbook',
                        platform: 'darwin',
                        happyCliVersion: '0.0.0',
                        homeDir: '/Users/tester',
                        happyHomeDir: '/Users/tester/.hapi',
                        happyLibDir: '/Users/tester/.hapi'
                    }
                })
            ],
            listCodexThreadsFromMachine: async () => ({
                data: [
                    {
                        id: 'thread-from-machine',
                        cwd: '/Users/tester/project',
                        path: '/Users/tester/.codex/sessions/2026/04/24/rollout-machine.jsonl',
                        preview: 'machine thread preview',
                        updatedAt: 1_777_000_000_000
                    }
                ],
                nextCursor: null,
                backwardsCursor: null
            })
        })

        const response = await app.request('/api/codex-sessions')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                expect.objectContaining({
                    id: 'codex:thread-from-machine',
                    attachedSessionId: null,
                    codexSessionId: 'thread-from-machine',
                    codexOrigin: 'app-server-thread',
                    openStrategy: 'open-app-server-thread',
                    metadata: expect.objectContaining({
                        name: 'machine thread preview',
                        path: '/Users/tester/project',
                        machineId: 'machine-catalog',
                        agentSessionId: 'thread-from-machine'
                    })
                })
            ]
        })
    })

    it('rejects transcript fallback native resume after tmux retirement', async () => {
        const app = createApp({
            getSessionsByNamespace: () => []
        })

        const response = await app.request('/api/codex-sessions/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: '/tmp/project',
                codexSessionId: 'thread-1'
            })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Native tmux resume has been retired. Open this Codex thread from an app-server-backed session.'
        })
    })

    it('opens app-server thread history by spawning a remote codex resume session', async () => {
        const spawnCalls: unknown[][] = []
        const setCodexSessionIdCalls: unknown[][] = []
        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-remote',
                    model: 'gpt-5.4',
                    modelReasoningEffort: 'high',
                    effort: 'high',
                    permissionMode: 'acceptEdits',
                    metadata: {
                        path: '/tmp/source-project',
                        host: 'localhost',
                        flavor: 'codex',
                        source: 'managed',
                        machineId: 'machine-1',
                        codexSessionId: 'thread-source'
                    }
                })
            ],
            listCodexThreads: async () => ({
                data: [
                    {
                        id: 'thread-target',
                        cwd: '/tmp/target-project',
                        path: '/Users/tester/.codex/sessions/2026/04/24/rollout-target.jsonl',
                        name: 'Target app-server thread',
                        updatedAt: 1_777_000_000_000
                    }
                ],
                nextCursor: null,
                backwardsCursor: null
            }),
            spawnSession: async (...args: unknown[]) => {
                spawnCalls.push(args)
                return { type: 'success', sessionId: 'session-spawned' }
            },
            setSessionCodexSessionId: (...args: unknown[]) => {
                setCodexSessionIdCalls.push(args)
            }
        })

        const response = await app.request('/api/codex-sessions/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: '/tmp/ignored',
                codexSessionId: 'thread-target',
                title: 'Target app-server thread',
                openStrategy: 'open-app-server-thread'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessionId: 'session-spawned' })
        expect(spawnCalls).toEqual([
            [
                'machine-1',
                '/tmp/target-project',
                'codex',
                'gpt-5.4',
                'high',
                undefined,
                undefined,
                undefined,
                'thread-target',
                'high',
                'acceptEdits'
            ]
        ])
        expect(setCodexSessionIdCalls).toEqual([
            ['session-spawned', 'thread-target']
        ])
    })

    it('opens machine-listed app-server thread history by spawning a remote codex resume session', async () => {
        const spawnCalls: unknown[][] = []
        const app = createApp({
            getSessionsByNamespace: () => [],
            getMachinesByNamespace: () => [
                createMachine({ id: 'machine-catalog' })
            ],
            listCodexThreadsFromMachine: async () => ({
                data: [
                    {
                        id: 'thread-target',
                        cwd: '/tmp/target-project',
                        path: '/Users/tester/.codex/sessions/2026/04/24/rollout-target.jsonl',
                        updatedAt: 1_777_000_000_000
                    }
                ],
                nextCursor: null,
                backwardsCursor: null
            }),
            spawnSession: async (...args: unknown[]) => {
                spawnCalls.push(args)
                return { type: 'success', sessionId: 'session-spawned' }
            }
        })

        const response = await app.request('/api/codex-sessions/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: '/tmp/ignored',
                codexSessionId: 'thread-target',
                openStrategy: 'open-app-server-thread'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessionId: 'session-spawned' })
        expect(spawnCalls).toEqual([
            [
                'machine-catalog',
                '/tmp/target-project',
                'codex',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'thread-target',
                undefined,
                undefined
            ]
        ])
    })

    it('does not silently fall back to native resume when requested app-server thread is unavailable', async () => {
        const app = createApp({
            getSessionsByNamespace: () => [
                createSession({
                    id: 'session-remote',
                    metadata: {
                        path: '/tmp/source-project',
                        host: 'localhost',
                        flavor: 'codex',
                        source: 'managed',
                        machineId: 'machine-1',
                        codexSessionId: 'thread-source'
                    }
                })
            ],
            listCodexThreads: async () => ({
                data: [],
                nextCursor: null,
                backwardsCursor: null
            })
        })

        const response = await app.request('/api/codex-sessions/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: '/tmp/source-project',
                codexSessionId: 'thread-missing',
                openStrategy: 'open-app-server-thread'
            })
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Codex app-server thread is not available from an online runner'
        })
    })
})
