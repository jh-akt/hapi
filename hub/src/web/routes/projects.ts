import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import { normalizeFilesystemPath } from '../../utils/filesystemPath'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const createProjectSchema = z.object({
    path: z.string().trim().min(1),
    name: z.string().trim().min(1).max(255).optional()
})

export function createProjectsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        return c.json({ projects: engine.getProjectsByNamespace(namespace) })
    })

    app.post('/projects', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createProjectSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const path = normalizeFilesystemPath(parsed.data.path)
        if (path.length === 0) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const project = engine.createProject(namespace, {
            path,
            name: parsed.data.name
        })

        return c.json({ project })
    })

    return app
}
