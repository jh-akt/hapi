import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createProjectsRoutes } from './projects'

function createApp(engine: Partial<SyncEngine>) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createProjectsRoutes(() => engine as SyncEngine))
    return app
}

describe('projects routes', () => {
    it('lists projects in the active namespace', async () => {
        const app = createApp({
            getProjectsByNamespace: (namespace: string) => [{
                id: 'project-1',
                namespace,
                path: '/tmp/project',
                name: 'demo',
                createdAt: 1,
                updatedAt: 2
            }]
        })

        const response = await app.request('/api/projects')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            projects: [{
                id: 'project-1',
                namespace: 'default',
                path: '/tmp/project',
                name: 'demo',
                createdAt: 1,
                updatedAt: 2
            }]
        })
    })

    it('creates a project and returns the matching native codex session', async () => {
        const createCalls: Array<{ namespace: string; path: string; name?: string }> = []
        const app = createApp({
            createProject: (namespace: string, input: { path: string; name?: string }) => {
                createCalls.push({ namespace, ...input })
                return {
                    id: 'project-1',
                    namespace,
                    path: input.path,
                    name: input.name ?? null,
                    createdAt: 1,
                    updatedAt: 2
                }
            },
            discoverNativeSessions: async () => [
                {
                    tmuxSession: 'hapi-zeta',
                    tmuxPane: '%2',
                    cwd: '/tmp/project',
                    command: 'codex'
                },
                {
                    tmuxSession: 'hapi-alpha',
                    tmuxPane: '%1',
                    cwd: '/tmp/project',
                    command: 'codex',
                    sessionId: 'session-active'
                },
                {
                    tmuxSession: 'hapi-other',
                    tmuxPane: '%3',
                    cwd: '/tmp/other',
                    command: 'codex',
                    sessionId: 'session-other'
                }
            ]
        })

        const response = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                path: '/tmp/project/',
                name: 'demo'
            })
        })

        expect(response.status).toBe(200)
        expect(createCalls).toEqual([{
            namespace: 'default',
            path: '/tmp/project',
            name: 'demo'
        }])
        expect(await response.json()).toEqual({
            project: {
                id: 'project-1',
                namespace: 'default',
                path: '/tmp/project',
                name: 'demo',
                createdAt: 1,
                updatedAt: 2
            },
            nativeSession: {
                tmuxSession: 'hapi-alpha',
                tmuxPane: '%1',
                cwd: '/tmp/project',
                command: 'codex',
                sessionId: 'session-active'
            }
        })
    })
})
