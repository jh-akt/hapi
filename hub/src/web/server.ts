import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import type { SyncEngine } from '../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from './middleware/auth'
import { createAuthRoutes } from './routes/auth'
import { createBindRoutes } from './routes/bind'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createMessagesRoutes } from './routes/messages'
import { createPermissionsRoutes } from './routes/permissions'
import { createNativeSessionRoutes } from './routes/nativeSessions'
import { createCodexSessionsRoutes } from './routes/codexSessions'
import { createMachinesRoutes } from './routes/machines'
import { createGitRoutes } from './routes/git'
import { createProjectsRoutes } from './routes/projects'
import { createCliRoutes } from './routes/cli'
import { createPushRoutes } from './routes/push'
import { createVoiceRoutes } from './routes/voice'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import type { Store } from '../store'

export function getStaticAssetCacheControl(path: string): string {
    if (path.startsWith('/assets/')) {
        return 'public, max-age=31536000, immutable'
    }

    return 'no-cache, max-age=0, must-revalidate'
}

function applyStaticAssetCacheControl(path: string, response: Response): Response {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', getStaticAssetCacheControl(path))

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    })
}

function findWebappDistDir(): { distDir: string; indexHtmlPath: string } {
    const candidates = [
        join(process.cwd(), '..', 'web', 'dist'),
        join(import.meta.dir, '..', '..', '..', 'web', 'dist'),
        join(process.cwd(), 'web', 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { distDir, indexHtmlPath: join(distDir, 'index.html') }
}

function serveEmbeddedAsset(path: string, asset: EmbeddedWebAsset): Response {
    return new Response(Bun.file(asset.sourcePath), {
        headers: {
            'Content-Type': asset.mimeType,
            'Cache-Control': getStaticAssetCacheControl(path)
        }
    })
}

function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    relayMode?: boolean
    officialWebUrl?: string
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.use('*', logger())

    // Health check endpoint (no auth required)
    app.get('/health', (c) => c.json({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    const corsOriginOption = corsOrigins.includes('*') ? '*' : corsOrigins
    const corsMiddleware = cors({
        origin: corsOriginOption,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['authorization', 'content-type']
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.route('/cli', createCliRoutes(options.getSyncEngine))

    app.route('/api', createAuthRoutes(options.jwtSecret, options.store))
    app.route('/api', createBindRoutes(options.jwtSecret, options.store))

    app.use('/api/*', createAuthMiddleware(options.jwtSecret))
    app.route('/api', createEventsRoutes(options.getSseManager, options.getSyncEngine, options.getVisibilityTracker))
    app.route('/api', createSessionsRoutes(options.getSyncEngine))
    app.route('/api', createCodexSessionsRoutes(options.getSyncEngine))
    app.route('/api', createProjectsRoutes(options.getSyncEngine))
    app.route('/api', createMessagesRoutes(options.getSyncEngine))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine))
    app.route('/api', createNativeSessionRoutes(options.getSyncEngine))
    app.route('/api', createMachinesRoutes(options.getSyncEngine))
    app.route('/api', createGitRoutes(options.getSyncEngine))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))
    app.route('/api', createVoiceRoutes())

    // Skip static serving in relay mode, show helpful message on root
    if (options.relayMode) {
        const officialUrl = options.officialWebUrl || 'https://app.hapi.run'
        app.get('/', (c) => {
            return c.html(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HAPI Hub</title></head>
<body style="font-family: system-ui; padding: 2rem; max-width: 600px;">
<h1>HAPI Hub</h1>
<p>This hub is running in relay mode. Please use the official web app:</p>
<p><a href="${officialUrl}">${officialUrl}</a></p>
<details>
<summary>Why am I seeing this?</summary>
<p style="margin-top: 0.5rem; color: #666;">
When relay mode is enabled, all traffic flows through our relay infrastructure with end-to-end encryption.
To reduce bandwidth and improve performance, the frontend is served separately
from GitHub Pages instead of through the relay tunnel.
</p>
</details>
</body>
</html>`)
        })
        return app
    }

    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const indexHtmlAsset = embeddedAssetMap.get('/index.html')

        if (!indexHtmlAsset) {
            app.get('*', (c) => {
                return c.text(
                    'Embedded Mini App is missing index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            })
            return app
        }

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(c.req.path, asset)
            }

            return await next()
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            return serveEmbeddedAsset(c.req.path, indexHtmlAsset)
        })

        return app
    }

    const { distDir, indexHtmlPath } = findWebappDistDir()

    if (!existsSync(indexHtmlPath)) {
        app.get('/', (c) => {
            return c.text(
                'Mini App is not built.\n\nRun:\n  cd web\n  bun install\n  bun run build\n',
                503
            )
        })
        return app
    }

    const serveDistAsset = serveStatic({ root: distDir })
    const serveIndexHtml = serveStatic({ root: distDir, path: 'index.html' })

    app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        const response = await serveDistAsset(c, next)
        if (!response) {
            return response
        }

        return applyStaticAssetCacheControl(c.req.path, response)
    })

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        const response = await serveIndexHtml(c, next)
        if (!response) {
            return response
        }

        return applyStaticAssetCacheControl(c.req.path, response)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
    relayMode?: boolean
    officialWebUrl?: string
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        jwtSecret: options.jwtSecret,
        store: options.store,
        vapidPublicKey: options.vapidPublicKey,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap,
        relayMode: options.relayMode,
        officialWebUrl: options.officialWebUrl
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        maxRequestBodySize: Math.max(socketHandler.maxRequestBodySize, 68 * 1024 * 1024),
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    console.log(`[Web] hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    console.log(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
