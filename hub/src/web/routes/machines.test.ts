import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { CodexAppServerParams } from '@hapi/protocol/codex-app-server'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createMachinesRoutes } from './machines'

function createMachine(overrides?: Partial<Machine>): Machine {
    return {
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
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
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
    app.route('/api', createMachinesRoutes(() => engine as SyncEngine))
    return app
}

describe('machines routes', () => {
    it('lists Codex models through the selected machine app-server RPC', async () => {
        const calls: Array<[string, CodexAppServerParams<'model/list'>]> = []
        const machine = createMachine()
        const app = createApp({
            getMachine: (machineId: string) => machineId === machine.id ? machine : undefined,
            listMachineCodexModels: async (machineId, params) => {
                calls.push([machineId, params])
                return {
                    data: [
                        {
                            id: 'gpt-dynamic',
                            model: 'gpt-dynamic',
                            displayName: 'GPT Dynamic'
                        }
                    ],
                    nextCursor: null
                } as Awaited<ReturnType<SyncEngine['listMachineCodexModels']>>
            }
        })

        const response = await app.request('/api/machines/machine-1/codex-models?includeHidden=false&limit=50')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            data: [
                {
                    id: 'gpt-dynamic',
                    model: 'gpt-dynamic',
                    displayName: 'GPT Dynamic'
                }
            ],
            nextCursor: null
        })
        expect(calls).toEqual([
            ['machine-1', { limit: 50, includeHidden: false }]
        ])
    })

    it('falls back to an empty Codex model list when the runner cannot serve model/list', async () => {
        const machine = createMachine()
        const app = createApp({
            getMachine: (machineId: string) => machineId === machine.id ? machine : undefined,
            listMachineCodexModels: async () => {
                throw new Error('RPC handler not registered: machine-1:codex-app-server')
            }
        })

        const response = await app.request('/api/machines/machine-1/codex-models')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            data: [],
            nextCursor: null
        })
    })
})
