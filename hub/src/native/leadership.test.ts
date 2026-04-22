import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NativeLeadershipCoordinator, NativeLeadershipUnavailableError } from './leadership'

const createdDirs: string[] = []

function createLockPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-native-leader-'))
    createdDirs.push(dir)
    return join(dir, 'native-leader.json')
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<void> {
    const startedAt = Date.now()
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for condition')
        }
        await Bun.sleep(25)
    }
}

afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('NativeLeadershipCoordinator', () => {
    it('lets the higher-priority service preempt the lower-priority leader', async () => {
        const lockPath = createLockPath()
        const debug = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.debug',
            publicUrl: 'https://hapi-debug.example.com',
            priority: 100,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })
        const primary = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.public',
            publicUrl: 'https://hapi.example.com',
            priority: 200,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })

        debug.start()
        await waitFor(() => debug.isLeader())

        primary.start()
        await waitFor(() => primary.isLeader() && !debug.isLeader())

        debug.stop()
        primary.stop()
    })

    it('promotes the standby service after the leader stops', async () => {
        const lockPath = createLockPath()
        const primary = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.public',
            publicUrl: 'https://hapi.example.com',
            priority: 200,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })
        const debug = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.debug',
            publicUrl: 'https://hapi-debug.example.com',
            priority: 100,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })

        primary.start()
        debug.start()

        await waitFor(() => primary.isLeader() && !debug.isLeader())
        primary.stop()

        await waitFor(() => debug.isLeader())
        debug.stop()
    })

    it('rejects native leadership takeover while a healthier leader is active', async () => {
        const lockPath = createLockPath()
        const primary = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.public',
            publicUrl: 'https://hapi.example.com',
            priority: 200,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })
        const debug = new NativeLeadershipCoordinator({
            lockPath,
            serviceLabel: 'com.hapi.hub.debug',
            publicUrl: 'https://hapi-debug.example.com',
            priority: 100,
            heartbeatIntervalMs: 40,
            staleAfterMs: 250,
            standbyPollIntervalMs: 40
        })

        primary.start()
        debug.start()

        await waitFor(() => primary.isLeader() && !debug.isLeader())

        await expect(debug.ensureLeader()).rejects.toBeInstanceOf(NativeLeadershipUnavailableError)

        debug.stop()
        primary.stop()
    })
})
