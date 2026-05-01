import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createNativeSessionRoutes } from './nativeSessions'

function createApp() {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createNativeSessionRoutes())
    return app
}

describe('native session routes', () => {
    it('returns gone for native tmux endpoints', async () => {
        const app = createApp()

        const requests = [
            app.request('/api/native-sessions/discover'),
            app.request('/api/native-sessions/attach', { method: 'POST' }),
            app.request('/api/native-sessions/create', { method: 'POST' }),
            app.request('/api/native-sessions/session-1/detach', { method: 'POST' })
        ]
        const responses = await Promise.all(requests)

        for (const response of responses) {
            expect(response.status).toBe(410)
            expect(await response.json()).toEqual({
                error: 'Native tmux sessions have been retired'
            })
        }
    })
})
