import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createNativeSessionRoutes } from './nativeSessions'

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createNativeSessionRoutes(() => engine as SyncEngine))
    return app
}

describe('native session routes', () => {
    it('returns discovered native sessions', async () => {
        const app = createApp({
            discoverNativeSessions: async () => ([
                {
                    tmuxSession: 'work-a',
                    tmuxPane: '%3',
                    cwd: '/tmp/project-a',
                    command: 'codex',
                    sessionId: 'session-1'
                }
            ])
        })

        const response = await app.request('/api/native-sessions/discover')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [
                {
                    tmuxSession: 'work-a',
                    tmuxPane: '%3',
                    cwd: '/tmp/project-a',
                    command: 'codex',
                    sessionId: 'session-1'
                }
            ]
        })
    })

    it('attaches a native session', async () => {
        const app = createApp({
            attachNativeSession: async () => ({
                id: 'session-1'
            } as Awaited<ReturnType<SyncEngine['attachNativeSession']>>)
        })

        const response = await app.request('/api/native-sessions/attach', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                tmuxSession: 'work-a',
                tmuxPane: '%3',
                agent: 'codex',
                title: 'project-a'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessionId: 'session-1' })
    })

    it('creates a native session', async () => {
        const app = createApp({
            createNativeSession: async () => ({
                id: 'session-2'
            } as Awaited<ReturnType<SyncEngine['createNativeSession']>>)
        })

        const response = await app.request('/api/native-sessions/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: '/tmp/project-b',
                agent: 'codex',
                title: 'project-b'
            })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ sessionId: 'session-2' })
    })

    it('rejects claude attach requests while native claude support is disabled', async () => {
        const app = createApp({})

        const response = await app.request('/api/native-sessions/attach', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                tmuxSession: 'work-a',
                tmuxPane: '%3',
                agent: 'claude'
            })
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Invalid body' })
    })
})
