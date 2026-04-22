import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000
const DEFAULT_STALE_AFTER_MS = 5_000
const DEFAULT_STANDBY_POLL_INTERVAL_MS = 2_000

type NativeLeadershipLockRecord = {
    version: 1
    instanceId: string
    pid: number
    priority: number
    serviceLabel: string
    publicUrl: string
    acquiredAt: number
    heartbeatAt: number
}

type NativeLeadershipCallbacks = {
    onAcquired?: () => Promise<void> | void
    onLost?: () => Promise<void> | void
}

export type NativeLeadershipOptions = {
    lockPath: string
    serviceLabel: string
    publicUrl: string
    priority: number
    heartbeatIntervalMs?: number
    staleAfterMs?: number
    standbyPollIntervalMs?: number
}

export class NativeLeadershipUnavailableError extends Error {
    constructor(message: string = 'Native operations are currently handled by another hub instance') {
        super(message)
        this.name = 'NativeLeadershipUnavailableError'
    }
}

export function buildNativeLeadershipLockPath(dbPath: string): string {
    return `${dbPath}.native-leader.json`
}

function parseNativeLeadershipLockRecord(raw: string): NativeLeadershipLockRecord | null {
    try {
        const parsed = JSON.parse(raw) as Partial<NativeLeadershipLockRecord>
        if (
            parsed.version !== 1
            || typeof parsed.instanceId !== 'string'
            || typeof parsed.pid !== 'number'
            || typeof parsed.priority !== 'number'
            || typeof parsed.serviceLabel !== 'string'
            || typeof parsed.publicUrl !== 'string'
            || typeof parsed.acquiredAt !== 'number'
            || typeof parsed.heartbeatAt !== 'number'
        ) {
            return null
        }

        return parsed as NativeLeadershipLockRecord
    } catch {
        return null
    }
}

function isPidAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) {
        return false
    }

    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'EPERM'
    }
}

export class NativeLeadershipCoordinator {
    private readonly instanceId = randomUUID()
    private readonly heartbeatIntervalMs: number
    private readonly staleAfterMs: number
    private readonly standbyPollIntervalMs: number
    private leader = false
    private heartbeatTimer: NodeJS.Timeout | null = null
    private standbyTimer: NodeJS.Timeout | null = null
    private transitionPromise: Promise<boolean> | null = null
    private stopped = false

    constructor(
        private readonly options: NativeLeadershipOptions,
        private readonly callbacks: NativeLeadershipCallbacks = {}
    ) {
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
        this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
        this.standbyPollIntervalMs = options.standbyPollIntervalMs ?? DEFAULT_STANDBY_POLL_INTERVAL_MS
    }

    start(): void {
        this.stopped = false
        void this.runTransition(async () => await this.reconcileLeadership())
    }

    stop(): void {
        this.stopped = true
        this.clearTimers()

        const wasLeader = this.leader
        this.leader = false

        if (wasLeader) {
            this.releaseLock()
            void this.callbacks.onLost?.()
        }
    }

    isLeader(): boolean {
        return this.leader
    }

    async ensureLeader(): Promise<void> {
        if (this.leader) {
            return
        }

        const acquired = await this.runTransition(async () => await this.reconcileLeadership())
        if (!acquired) {
            throw new NativeLeadershipUnavailableError()
        }
    }

    private async runTransition(task: () => Promise<boolean>): Promise<boolean> {
        if (this.transitionPromise) {
            return await this.transitionPromise
        }

        const promise = task()
            .catch((error) => {
                console.warn('[NativeLeader] coordination error:', error)
                return this.leader
            })
            .finally(() => {
                if (this.transitionPromise === promise) {
                    this.transitionPromise = null
                }
            })

        this.transitionPromise = promise
        return await promise
    }

    private async reconcileLeadership(): Promise<boolean> {
        if (this.stopped) {
            return false
        }

        const current = this.readLock()
        if (!current) {
            return await this.acquireLeadership('lock-missing')
        }

        if (current.instanceId === this.instanceId) {
            return await this.refreshLeadership(current)
        }

        const stale = !this.isRecordFresh(current)
        const shouldPreempt = this.options.priority > current.priority

        if (!stale && !shouldPreempt) {
            await this.enterStandby(current)
            return false
        }

        return await this.replaceLeadership(current, stale ? 'stale-lock' : 'higher-priority')
    }

    private async acquireLeadership(reason: string): Promise<boolean> {
        const record = this.buildLockRecord()
        const created = this.tryCreateLock(record)
        if (!created) {
            await this.enterStandby()
            return false
        }

        await this.enterLeader(reason)
        return true
    }

    private async replaceLeadership(current: NativeLeadershipLockRecord, reason: string): Promise<boolean> {
        const latest = this.readLock()
        if (latest && latest.instanceId !== current.instanceId) {
            return await this.reconcileLeadership()
        }

        this.writeLock(this.buildLockRecord())
        await this.enterLeader(reason)
        return true
    }

    private async refreshLeadership(current: NativeLeadershipLockRecord): Promise<boolean> {
        if (current.instanceId !== this.instanceId) {
            await this.enterStandby(current)
            return false
        }

        this.writeLock({
            ...current,
            heartbeatAt: Date.now()
        })
        await this.enterLeader('heartbeat')
        return true
    }

    private async enterLeader(reason: string): Promise<void> {
        const firstAcquire = !this.leader
        this.leader = true
        this.clearStandbyTimer()
        this.scheduleHeartbeat()

        if (!firstAcquire) {
            return
        }

        console.log(`[NativeLeader] ${this.options.serviceLabel} became leader (${reason})`)
        await this.callbacks.onAcquired?.()
    }

    private async enterStandby(current?: NativeLeadershipLockRecord): Promise<void> {
        const wasLeader = this.leader
        this.leader = false
        this.clearHeartbeatTimer()
        this.scheduleStandbyPoll()

        if (!wasLeader) {
            return
        }

        console.log(`[NativeLeader] ${this.options.serviceLabel} entered standby (${current?.serviceLabel ?? 'foreign-lock'})`)
        await this.callbacks.onLost?.()
    }

    private scheduleHeartbeat(): void {
        this.clearHeartbeatTimer()
        if (this.stopped) {
            return
        }

        this.heartbeatTimer = setTimeout(() => {
            void this.runTransition(async () => await this.reconcileLeadership())
        }, this.heartbeatIntervalMs)
    }

    private scheduleStandbyPoll(): void {
        if (this.stopped || this.standbyTimer) {
            return
        }

        this.standbyTimer = setTimeout(() => {
            this.standbyTimer = null
            void this.runTransition(async () => await this.reconcileLeadership())
        }, this.standbyPollIntervalMs)
    }

    private clearTimers(): void {
        this.clearHeartbeatTimer()
        this.clearStandbyTimer()
    }

    private clearHeartbeatTimer(): void {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private clearStandbyTimer(): void {
        if (this.standbyTimer) {
            clearTimeout(this.standbyTimer)
            this.standbyTimer = null
        }
    }

    private buildLockRecord(): NativeLeadershipLockRecord {
        const now = Date.now()
        return {
            version: 1,
            instanceId: this.instanceId,
            pid: process.pid,
            priority: this.options.priority,
            serviceLabel: this.options.serviceLabel,
            publicUrl: this.options.publicUrl,
            acquiredAt: now,
            heartbeatAt: now
        }
    }

    private isRecordFresh(record: NativeLeadershipLockRecord): boolean {
        return (Date.now() - record.heartbeatAt) <= this.staleAfterMs && isPidAlive(record.pid)
    }

    private readLock(): NativeLeadershipLockRecord | null {
        try {
            return parseNativeLeadershipLockRecord(readFileSync(this.options.lockPath, 'utf8'))
        } catch {
            return null
        }
    }

    private tryCreateLock(record: NativeLeadershipLockRecord): boolean {
        try {
            mkdirSync(dirname(this.options.lockPath), { recursive: true })
            writeFileSync(this.options.lockPath, JSON.stringify(record, null, 2), {
                encoding: 'utf8',
                mode: 0o600,
                flag: 'wx'
            })
            return true
        } catch {
            return false
        }
    }

    private writeLock(record: NativeLeadershipLockRecord): void {
        mkdirSync(dirname(this.options.lockPath), { recursive: true })
        const tmpPath = `${this.options.lockPath}.${process.pid}.${randomUUID()}.tmp`
        writeFileSync(tmpPath, JSON.stringify(record, null, 2), {
            encoding: 'utf8',
            mode: 0o600
        })
        renameSync(tmpPath, this.options.lockPath)
    }

    private releaseLock(): void {
        const current = this.readLock()
        if (!current || current.instanceId !== this.instanceId) {
            return
        }

        rmSync(this.options.lockPath, { force: true })
    }
}
