import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const attachBodySchema = z.object({
    tmuxSession: z.string().min(1),
    tmuxPane: z.string().min(1),
    // Claude is intentionally disabled in the native attach path for now.
    // Re-enable by widening this enum plus the native session manager allowlist.
    agent: z.enum(['codex']).optional(),
    title: z.string().trim().min(1).max(255).optional()
})

const createBodySchema = z.object({
    cwd: z.string().trim().min(1),
    agent: z.enum(['codex']).optional(),
    title: z.string().trim().min(1).max(255).optional()
})

export function createNativeSessionRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/native-sessions/discover', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')

        try {
            const sessions = await engine.discoverNativeSessions(namespace)
            return c.json({ sessions })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to discover native sessions'
            }, 500)
        }
    })

    app.post('/native-sessions/attach', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = attachBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const session = await engine.attachNativeSession(c.get('namespace'), parsed.data)
            return c.json({ sessionId: session.id })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to attach native session'
            }, 500)
        }
    })

    app.post('/native-sessions/create', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const session = await engine.createNativeSession(c.get('namespace'), parsed.data)
            return c.json({ sessionId: session.id })
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to create native session'
            }, 500)
        }
    })

    app.post('/native-sessions/:id/detach', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        try {
            await engine.detachNativeSession(c.req.param('id'), c.get('namespace'))
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to detach native session'
            const status = message === 'Native session not found' ? 404 : 500
            return c.json({ error: message }, status)
        }
    })

    return app
}
