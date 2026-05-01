import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'

const nativeTmuxRetiredMessage = 'Native tmux sessions have been retired'

function retiredResponse() {
    return { error: nativeTmuxRetiredMessage }
}

export function createNativeSessionRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/native-sessions/discover', (c) => {
        return c.json(retiredResponse(), 410)
    })

    app.post('/native-sessions/attach', (c) => {
        return c.json(retiredResponse(), 410)
    })

    app.post('/native-sessions/create', (c) => {
        return c.json(retiredResponse(), 410)
    })

    app.post('/native-sessions/:id/detach', (c) => {
        return c.json(retiredResponse(), 410)
    })

    return app
}
