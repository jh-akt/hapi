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

    it('creates a project without native tmux matching', async () => {
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
            }
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
            }
        })
    })

    it('normalizes home-relative project paths when creating projects', async () => {
        const createCalls: Array<{ namespace: string; path: string; name?: string }> = []
        const app = createApp({
            createProject: (namespace: string, input: { path: string; name?: string }) => {
                createCalls.push({ namespace, ...input })
                return {
                    id: 'project-tilde',
                    namespace,
                    path: input.path,
                    name: input.name ?? null,
                    createdAt: 10,
                    updatedAt: 20
                }
            }
        })

        const response = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                path: '～/Code/demo-project/',
                name: 'demo project'
            })
        })

        expect(response.status).toBe(200)
        expect(createCalls[0]?.namespace).toBe('default')
        expect(createCalls[0]?.path.endsWith('/Code/demo-project')).toBe(true)
        expect(createCalls[0]?.name).toBe('demo project')
        expect(await response.json()).toEqual({
            project: {
                id: 'project-tilde',
                namespace: 'default',
                path: createCalls[0]?.path,
                name: 'demo project',
                createdAt: 10,
                updatedAt: 20
            }
        })
    })
})
