import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir, hostname, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { AGENT_MESSAGE_PAYLOAD_TYPE } from '@hapi/protocol'
import type { AgentState, DecryptedMessage, Metadata, Session } from '@hapi/protocol/types'
import {
    mapNativeCodexApprovalKey,
    parseNativeCodexCommandPermissionPrompt,
    parseNativeCodexCommandPermissionResult
} from './codexPermissions'
import {
    createNativeCodexTranscriptState,
    syncNativeCodexTranscript,
    type NativeCodexTranscriptState
} from './codexTranscript'
import {
    NativeLeadershipCoordinator,
    type NativeLeadershipOptions
} from './leadership'
import { diffCapturedTmuxOutput } from './outputSync'

type NativeCommand = 'codex' | 'claude'
type EnabledNativeCommand = 'codex'

// Native Claude attach is intentionally disabled for now.
// Keep the parsing/storage shape compatible so we can re-enable it later
// by widening the enabled command list plus the HTTP/Web input types.
const ENABLED_NATIVE_COMMANDS = new Set<EnabledNativeCommand>(['codex'])
const POLL_INTERVAL_MS = 700
const THINKING_IDLE_MS = 1_500
const INITIAL_CAPTURE_LINES = '-2000'
const CODEX_SESSION_ID_SYNC_INTERVAL_MS = 3_000
const INITIAL_CODEX_SESSION_ID_PERSIST_TIMEOUT_MS = 5_000
const INITIAL_CODEX_SESSION_ID_POLL_INTERVAL_MS = 200
const CODEX_SHELL_SNAPSHOT_MAX_AGE_MS = 30_000
const CODEX_STATE_SQLITE_LOOKBACK_MS = 5_000
const CODEX_STATE_SQLITE_MATCH_WINDOW_MS = 2 * 60 * 1000
const CODEX_STATE_SQLITE_AMBIGUITY_THRESHOLD_MS = 1_500
const CODEX_STATE_SQLITE_MAX_THREADS = 20
const CODEX_SHELL_SNAPSHOT_DIR = join(homedir(), '.codex', 'shell_snapshots')
const NATIVE_TRANSCRIPT_USER_ECHO_MAX_AGE_MS = 60_000
const TMUX_FIELD_SEPARATOR = '::hapi-tmux::'
const TMUX_SUBMIT_DELAY_MS = 120

export type NativeSessionDiscoverItem = {
    tmuxSession: string
    tmuxPane: string
    cwd: string
    command: EnabledNativeCommand
    sessionId?: string
}

type TmuxPane = {
    tmuxSession: string
    tmuxPane: string
    panePid: number
    cwd: string
    command: NativeCommand
}

type TmuxPaneState = {
    tmuxSession: string
    tmuxPane: string
    panePid: number
    cwd: string
    rawCommand: string
    command: NativeCommand | null
}

type ParsedTmuxPaneLine = {
    tmuxSession: string
    tmuxPane: string
    cwd: string
    command: string
}

type ParsedTmuxPaneStateLine = ParsedTmuxPaneLine & {
    panePid: number
}

type AttachableTmuxPane = {
    tmuxSession: string
    tmuxPane: string
    cwd: string
    command: EnabledNativeCommand
}

type NativeTracker = {
    sessionId: string
    tmuxSession: string
    tmuxPane: string
    command: EnabledNativeCommand
    lastSnapshot: string
    lastOutputAt: number
    lastCodexSessionIdSyncAt: number
    thinking: boolean
    pendingPermission: NativePendingPermissionRequest | null
    recentUserInputs: Array<{ text: string; createdAt: number }>
    transcript: NativeCodexTranscriptState
    timer: NodeJS.Timeout | null
}

type NativePendingPermissionRequest = {
    id: string
    fingerprint: string
    command: string
    createdAt: number
}

type CodexStateThread = {
    sessionId: string
    cwd: string
    source: string | null
    createdAtMs: number
    updatedAtMs: number
}

type NativeSessionManagerDeps = {
    getSessions: () => Session[]
    getSessionsByNamespace: (namespace: string) => Session[]
    getSession: (sessionId: string) => Session | undefined
    getSessionByNamespace: (sessionId: string, namespace: string) => Session | undefined
    reloadState: () => void
    getOrCreateSession: (
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string
    ) => Session
    updateSessionMetadata: (sessionId: string, metadata: unknown, options?: { touchUpdatedAt?: boolean }) => Session
    updateSessionAgentState: (sessionId: string, agentState: unknown) => Session
    appendMessage: (sessionId: string, content: unknown, localId?: string | null) => DecryptedMessage
    getMessageCount: (sessionId: string) => number
    handleSessionAlive: (payload: { sid: string; time: number; thinking?: boolean }) => void
    handleSessionEnd: (payload: { sid: string; time: number }) => void
}

type CommandOptions = {
    stdin?: string
}

function normalizeCommand(command: string): NativeCommand | null {
    const normalized = command.trim().toLowerCase()
    if (normalized === 'codex' || normalized === 'claude') {
        return normalized
    }
    return null
}

export function inferNativeCommandFromProcessCommand(command: string): NativeCommand | null {
    const normalized = command.trim().toLowerCase()
    if (!normalized) {
        return null
    }

    if (
        normalized.includes('@openai/codex')
        || /(^|[\/\s])codex(?:\.js)?($|[\s])/.test(normalized)
    ) {
        return 'codex'
    }

    if (/(^|[\/\s])claude(?:\.js)?($|[\s])/.test(normalized)) {
        return 'claude'
    }

    return null
}

function isEnabledNativeCommand(command: NativeCommand): command is EnabledNativeCommand {
    return ENABLED_NATIVE_COMMANDS.has(command as EnabledNativeCommand)
}

function normalizeSnapshot(snapshot: string): string {
    return snapshot.replace(/\r\n/g, '\n')
}

function normalizeComparableText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function inferNativeCommandFromSnapshot(snapshot: string): NativeCommand | null {
    const normalized = normalizeComparableText(snapshot)
    if (!normalized) {
        return null
    }

    if (
        normalized.includes('openai codex')
        || normalized.includes('>_ openai codex')
    ) {
        return 'codex'
    }

    if (normalized.includes('claude code')) {
        return 'claude'
    }

    return null
}

export function parseTmuxPaneLine(line: string): ParsedTmuxPaneLine | null {
    const [tmuxSession = '', tmuxPane = '', cwd = '', command = ''] = splitTmuxFields(line)
    if (!tmuxSession || !tmuxPane || !cwd || !command) {
        return null
    }

    return {
        tmuxSession,
        tmuxPane,
        cwd,
        command
    }
}

function parseTmuxPaneStateLine(line: string): ParsedTmuxPaneStateLine | null {
    const [tmuxSession = '', tmuxPane = '', panePidRaw = '', cwd = '', command = ''] = splitTmuxFields(line)
    const panePid = Number.parseInt(panePidRaw, 10)
    if (!tmuxSession || !tmuxPane || !cwd || !command || !Number.isFinite(panePid) || panePid <= 0) {
        return null
    }

    return {
        tmuxSession,
        tmuxPane,
        panePid,
        cwd,
        command
    }
}

function splitTmuxFields(line: string): string[] {
    const trimmed = line.trimEnd()
    if (trimmed.includes(TMUX_FIELD_SEPARATOR)) {
        return trimmed.split(TMUX_FIELD_SEPARATOR)
    }

    return trimmed.split('\t')
}

function buildTmuxPaneFormat(options?: { includePid?: boolean }): string {
    const fields = options?.includePid
        ? ['#S', '#{pane_id}', '#{pane_pid}', '#{pane_current_path}', '#{pane_current_command}']
        : ['#S', '#{pane_id}', '#{pane_current_path}', '#{pane_current_command}']

    return fields.join(TMUX_FIELD_SEPARATOR)
}

function buildNativeSessionTag(tmuxSession: string, tmuxPane: string): string {
    return `native:${tmuxSession}:${tmuxPane}`
}

function buildDefaultTitle(cwd: string, fallback: string): string {
    const name = basename(cwd)
    return name && name !== '/' && name !== '.' ? name : fallback
}

function shellEscape(value: string): string {
    if (/^[a-zA-Z0-9._/:=-]+$/.test(value)) {
        return value
    }

    return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildCodexResumeCommand(codexSessionId: string): string {
    return `codex resume ${shellEscape(codexSessionId)}`
}

export function isShellLikeCommand(command: string): boolean {
    const normalized = basename(command.trim().toLowerCase())
    return normalized === 'sh'
        || normalized === 'bash'
        || normalized === 'zsh'
        || normalized === 'fish'
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

function normalizeComparablePath(value: string): string {
    const normalized = resolve(value).replace(/\\/g, '/').replace(/\/+$/u, '')
    return normalized || '/'
}

function sanitizeTmuxSessionName(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')

    return normalized.slice(0, 24) || 'codex'
}

function buildTmuxSessionName(cwd: string, title?: string): string {
    const base = sanitizeTmuxSessionName(title || buildDefaultTitle(cwd, 'codex'))
    return `hapi-${base}-${Date.now().toString(36)}`
}

function ensureDirectoryExists(cwd: string): void {
    if (!existsSync(cwd)) {
        throw new Error('Directory does not exist')
    }

    if (!statSync(cwd).isDirectory()) {
        throw new Error('Path is not a directory')
    }
}

async function runCommand(command: string, args: string[], options?: CommandOptions): Promise<string> {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
            stdout += chunk
        })
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk
        })

        child.on('error', (error) => {
            reject(error)
        })

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout)
                return
            }

            const detail = stderr.trim() || stdout.trim() || `tmux exited with code ${code ?? 'unknown'}`
            reject(new Error(detail))
        })

        if (options?.stdin !== undefined) {
            child.stdin.end(options.stdin)
            return
        }

        child.stdin.end()
    })
}

function resolveTmuxSocketPath(): string | null {
    const configured = process.env.HAPI_TMUX_SOCKET?.trim()
    if (configured) {
        return configured
    }

    const uid = process.getuid?.()
    if (typeof uid !== 'number') {
        return null
    }

    for (const candidate of [
        `/private/tmp/tmux-${uid}/default`,
        `/tmp/tmux-${uid}/default`
    ]) {
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return null
}

async function runTmux(args: string[], options?: CommandOptions): Promise<string> {
    const socketPath = resolveTmuxSocketPath()
    const tmuxArgs = socketPath ? ['-S', socketPath, ...args] : args
    return await runCommand('tmux', tmuxArgs, options)
}

type ProcessEntry = {
    pid: number
    ppid: number
    command: string
}

function parseProcessList(stdout: string): ProcessEntry[] {
    return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/)
            if (!match) {
                return null
            }

            return {
                pid: Number.parseInt(match[1], 10),
                ppid: Number.parseInt(match[2], 10),
                command: match[3] ?? ''
            }
        })
        .filter((entry): entry is ProcessEntry => entry !== null)
}

async function listDescendantProcesses(parentPid: number): Promise<ProcessEntry[]> {
    const stdout = await runCommand('ps', ['-axo', 'pid=,ppid=,command='])
    const processes = parseProcessList(stdout)
    const childrenByParent = new Map<number, ProcessEntry[]>()

    for (const process of processes) {
        const existing = childrenByParent.get(process.ppid) ?? []
        existing.push(process)
        childrenByParent.set(process.ppid, existing)
    }

    const descendants: ProcessEntry[] = []
    const queue = [...(childrenByParent.get(parentPid) ?? [])]

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        descendants.push(current)
        queue.push(...(childrenByParent.get(current.pid) ?? []))
    }

    return descendants
}

async function listChildProcessCommands(parentPid: number): Promise<string[]> {
    const descendants = await listDescendantProcesses(parentPid)
    return descendants.map((entry) => entry.command)
}

async function listOpenFilesForPid(pid: number): Promise<string[]> {
    try {
        const stdout = await runCommand('lsof', ['-p', String(pid), '-Fn'])
        return stdout
            .split('\n')
            .filter((line) => line.startsWith('n'))
            .map((line) => line.slice(1))
            .filter((line) => line.length > 0)
    } catch {
        return []
    }
}

function listCodexStateSqlitePaths(codexHomeDir: string): string[] {
    try {
        return readdirSync(codexHomeDir)
            .filter((fileName) => /^state(?:_(\d+))?\.sqlite$/u.test(fileName))
            .sort((left, right) => {
                const leftVersion = Number.parseInt(left.match(/^state(?:_(\d+))?\.sqlite$/u)?.[1] ?? '0', 10)
                const rightVersion = Number.parseInt(right.match(/^state(?:_(\d+))?\.sqlite$/u)?.[1] ?? '0', 10)
                if (leftVersion !== rightVersion) {
                    return rightVersion - leftVersion
                }

                try {
                    return statSync(join(codexHomeDir, right)).mtimeMs - statSync(join(codexHomeDir, left)).mtimeMs
                } catch {
                    return 0
                }
            })
            .map((fileName) => join(codexHomeDir, fileName))
    } catch {
        return []
    }
}

function resolveCodexStateThreadTimeExpressions(db: Database): {
    createdAtExpr: string
    updatedAtExpr: string
    sourceExpr: string
} | null {
    try {
        const columns = new Set(
            (db.query('PRAGMA table_info(threads)').all() as Array<{ name?: unknown }>)
                .map((row) => typeof row.name === 'string' ? row.name : '')
                .filter((name) => name.length > 0)
        )

        if (!columns.has('id') || !columns.has('cwd')) {
            return null
        }

        return {
            createdAtExpr: columns.has('created_at_ms') ? 'created_at_ms' : 'created_at * 1000',
            updatedAtExpr: columns.has('updated_at_ms') ? 'updated_at_ms' : 'updated_at * 1000',
            sourceExpr: columns.has('source') ? 'source' : 'NULL'
        }
    } catch {
        return null
    }
}

export function selectCodexSessionIdFromStateThreads(
    rows: CodexStateThread[],
    options: {
        cwd: string
        attachedAtMs: number
    }
): string | null {
    const targetCwd = normalizeComparablePath(options.cwd)

    const candidates = rows
        .filter((row) => row.source === null || row.source === 'cli')
        .filter((row) => normalizeComparablePath(row.cwd) === targetCwd)
        .map((row) => {
            const createdAtMs = Number.isFinite(row.createdAtMs) && row.createdAtMs > 0 ? row.createdAtMs : row.updatedAtMs
            const updatedAtMs = Number.isFinite(row.updatedAtMs) && row.updatedAtMs > 0 ? row.updatedAtMs : createdAtMs
            const createdDelta = createdAtMs - options.attachedAtMs
            const updatedDelta = updatedAtMs - options.attachedAtMs
            const withinWindow = (
                createdDelta >= -CODEX_STATE_SQLITE_LOOKBACK_MS
                && createdDelta <= CODEX_STATE_SQLITE_MATCH_WINDOW_MS
            ) || (
                updatedDelta >= -CODEX_STATE_SQLITE_LOOKBACK_MS
                && updatedDelta <= CODEX_STATE_SQLITE_MATCH_WINDOW_MS
            )

            if (!withinWindow) {
                return null
            }

            const score = Math.min(Math.abs(createdDelta), Math.abs(updatedDelta))
                + (createdDelta < 0 ? CODEX_STATE_SQLITE_AMBIGUITY_THRESHOLD_MS : 0)

            return {
                sessionId: row.sessionId,
                createdAtMs,
                updatedAtMs,
                score
            }
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score
            }
            if (left.createdAtMs !== right.createdAtMs) {
                return left.createdAtMs - right.createdAtMs
            }
            return right.updatedAtMs - left.updatedAtMs
        })

    if (candidates.length === 0) {
        return null
    }

    const best = candidates[0]
    if (!best) {
        return null
    }

    const nextDistinct = candidates.find((candidate) => candidate.sessionId !== best.sessionId)
    if (!nextDistinct) {
        return best.sessionId
    }

    return nextDistinct.score - best.score > CODEX_STATE_SQLITE_AMBIGUITY_THRESHOLD_MS
        ? best.sessionId
        : null
}

export function resolveCodexSessionIdFromStateSqlite(options: {
    cwd: string
    attachedAtMs?: number
    codexHomeDir?: string
}): string | null {
    if (!options.attachedAtMs || !options.cwd.trim()) {
        return null
    }

    const codexHomeDir = options.codexHomeDir?.trim() || process.env.CODEX_HOME || join(homedir(), '.codex')
    const stateDbPaths = listCodexStateSqlitePaths(codexHomeDir)
    if (stateDbPaths.length === 0) {
        return null
    }

    const lowerBound = Math.max(0, options.attachedAtMs - CODEX_STATE_SQLITE_LOOKBACK_MS)
    const upperBound = options.attachedAtMs + CODEX_STATE_SQLITE_MATCH_WINDOW_MS

    for (const stateDbPath of stateDbPaths) {
        let db: Database | null = null

        try {
            db = new Database(stateDbPath, { readonly: true, strict: true })
            const expressions = resolveCodexStateThreadTimeExpressions(db)
            if (!expressions) {
                continue
            }

            const rows = db.query(`
                SELECT
                    id,
                    cwd,
                    ${expressions.sourceExpr} AS source,
                    ${expressions.createdAtExpr} AS createdAtMs,
                    ${expressions.updatedAtExpr} AS updatedAtMs
                FROM threads
                WHERE ${expressions.updatedAtExpr} >= ?
                  AND ${expressions.createdAtExpr} <= ?
                ORDER BY ${expressions.updatedAtExpr} DESC
                LIMIT ${CODEX_STATE_SQLITE_MAX_THREADS}
            `).all(lowerBound, upperBound) as Array<{
                id: string
                cwd: string
                source: string | null
                createdAtMs: number
                updatedAtMs: number
            }>

            const sessionId = selectCodexSessionIdFromStateThreads(
                rows.map((row) => ({
                    sessionId: row.id,
                    cwd: row.cwd,
                    source: row.source,
                    createdAtMs: row.createdAtMs,
                    updatedAtMs: row.updatedAtMs
                })),
                {
                    cwd: options.cwd,
                    attachedAtMs: options.attachedAtMs
                }
            )

            if (sessionId) {
                return sessionId
            }
        } catch {
        } finally {
            db?.close()
        }
    }

    return null
}

export function extractCodexSessionIdFromFilePath(filePath: string): string | null {
    const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
    return match?.[1] ?? null
}

export function extractCodexSessionIdFromShellSnapshotName(fileName: string): { sessionId: string; createdAtMs: number } | null {
    const match = fileName.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d+)\.sh$/i
    )
    if (!match) {
        return null
    }

    const createdAtMs = Number.parseInt(match[2], 10) / 1_000_000
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
        return null
    }

    return {
        sessionId: match[1],
        createdAtMs
    }
}

export function selectCodexSessionIdFromRecentShellSnapshots(
    entries: Array<{ sessionId: string; createdAtMs: number }>,
    sinceMs: number
): string | null {
    const candidates = entries
        .filter((entry) => entry.createdAtMs >= sinceMs && entry.createdAtMs - sinceMs <= CODEX_SHELL_SNAPSHOT_MAX_AGE_MS)
        .sort((a, b) => a.createdAtMs - b.createdAtMs)

    const uniqueSessionIds = Array.from(new Set(candidates.map((entry) => entry.sessionId)))
    return uniqueSessionIds.length === 1 ? uniqueSessionIds[0] : null
}

function resolveCodexSessionIdFromRecentShellSnapshots(sinceMs: number): string | null {
    try {
        const entries = readdirSync(CODEX_SHELL_SNAPSHOT_DIR)
            .map((fileName) => extractCodexSessionIdFromShellSnapshotName(fileName))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

        return selectCodexSessionIdFromRecentShellSnapshots(entries, sinceMs)
    } catch {
        return null
    }
}

async function resolveCodexSessionIdForPane(panePid: number, options?: { attachedAtMs?: number }): Promise<string | null> {
    const descendants = await listDescendantProcesses(panePid)

    for (const process of descendants) {
        const openFiles = await listOpenFilesForPid(process.pid)
        for (const openFile of openFiles) {
            if (!openFile.includes('/.codex/sessions/') || !openFile.endsWith('.jsonl')) {
                continue
            }

            const sessionId = extractCodexSessionIdFromFilePath(openFile)
            if (sessionId) {
                return sessionId
            }
        }
    }

    if (options?.attachedAtMs) {
        return resolveCodexSessionIdFromRecentShellSnapshots(options.attachedAtMs)
    }

    return null
}

async function resolveTmuxPaneCommand(command: string, panePid: number): Promise<NativeCommand | null> {
    const direct = normalizeCommand(command) ?? inferNativeCommandFromProcessCommand(command)
    if (direct) {
        return direct
    }

    const childCommands = await listChildProcessCommands(panePid)
    for (const childCommand of childCommands) {
        const inferred = inferNativeCommandFromProcessCommand(childCommand)
        if (inferred) {
            return inferred
        }
    }

    return null
}

async function listTmuxPanes(): Promise<AttachableTmuxPane[]> {
    const stdout = await runTmux([
        'list-panes',
        '-a',
        '-F',
        buildTmuxPaneFormat({ includePid: true })
    ])

    const panes = await Promise.all(stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(async (line): Promise<AttachableTmuxPane | null> => {
            const parsed = parseTmuxPaneStateLine(line)
            if (!parsed) {
                return null
            }

            const command = await resolveTmuxPaneCommand(parsed.command, parsed.panePid)
            if (!command || !isEnabledNativeCommand(command)) {
                return null
            }

            return {
                tmuxSession: parsed.tmuxSession,
                tmuxPane: parsed.tmuxPane,
                cwd: parsed.cwd,
                command
            }
        }))

    return panes.filter((pane): pane is AttachableTmuxPane => pane !== null)
}

async function getTmuxPaneState(tmuxPane: string): Promise<TmuxPaneState | null> {
    let parsed: ParsedTmuxPaneStateLine | null = null

    try {
        const stdout = await runTmux([
            'display-message',
            '-p',
            '-t',
            tmuxPane,
            buildTmuxPaneFormat({ includePid: true })
        ])

        parsed = parseTmuxPaneStateLine(stdout)
    } catch {
        return null
    }

    if (!parsed) {
        return null
    }

    let command: NativeCommand | null = null
    try {
        command = await resolveTmuxPaneCommand(parsed.command, parsed.panePid)
    } catch {
    }

    if (!command) {
        try {
            command = inferNativeCommandFromSnapshot(await captureTmuxPane(tmuxPane))
        } catch {
        }
    }

    return {
        tmuxSession: parsed.tmuxSession,
        tmuxPane: parsed.tmuxPane,
        panePid: parsed.panePid,
        cwd: parsed.cwd,
        rawCommand: parsed.command,
        command
    }
}

async function getTmuxSessionPaneState(tmuxSession: string): Promise<TmuxPaneState | null> {
    try {
        const stdout = await runTmux([
            'list-panes',
            '-t',
            tmuxSession,
            '-F',
            buildTmuxPaneFormat({ includePid: true })
        ])

        const firstLine = stdout
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0)

        if (!firstLine) {
            return null
        }

        const parsed = parseTmuxPaneStateLine(firstLine)
        if (!parsed) {
            return null
        }

        let command: NativeCommand | null = null
        try {
            command = await resolveTmuxPaneCommand(parsed.command, parsed.panePid)
        } catch {
        }

        if (!command) {
            try {
                command = inferNativeCommandFromSnapshot(await captureTmuxPane(parsed.tmuxPane))
            } catch {
            }
        }

        return {
            tmuxSession: parsed.tmuxSession,
            tmuxPane: parsed.tmuxPane,
            panePid: parsed.panePid,
            cwd: parsed.cwd,
            rawCommand: parsed.command,
            command
        }
    } catch {
        return null
    }
}

async function getTmuxPane(tmuxPane: string): Promise<TmuxPane | null> {
    const state = await getTmuxPaneState(tmuxPane)
    if (!state?.command) {
        return null
    }

    return {
        tmuxSession: state.tmuxSession,
        tmuxPane: state.tmuxPane,
        panePid: state.panePid,
        cwd: state.cwd,
        command: state.command
    }
}

function resolveKnownNativePaneCommand(state: TmuxPaneState, expectedCommand: EnabledNativeCommand): EnabledNativeCommand | null {
    if (state.command === expectedCommand) {
        return expectedCommand
    }

    // npm-installed Codex often shows up as a foreground `node` process in tmux.
    // Once a session is already bound to Codex, treat that raw command as the
    // same agent so resume/poll can survive launchd-specific process quirks.
    const rawCommand = basename(state.rawCommand.trim().toLowerCase())
    if (expectedCommand === 'codex' && rawCommand === 'node') {
        return 'codex'
    }

    return null
}

async function getKnownTmuxPane(tmuxPane: string, expectedCommand: EnabledNativeCommand): Promise<TmuxPane | null> {
    const state = await getTmuxPaneState(tmuxPane)
    if (!state) {
        return null
    }

    const command = resolveKnownNativePaneCommand(state, expectedCommand)
    if (!command) {
        return null
    }

    return {
        tmuxSession: state.tmuxSession,
        tmuxPane: state.tmuxPane,
        panePid: state.panePid,
        cwd: state.cwd,
        command
    }
}

async function getFirstTmuxPane(tmuxSession: string): Promise<ParsedTmuxPaneLine | null> {
    try {
        const stdout = await runTmux([
            'list-panes',
            '-t',
            tmuxSession,
            '-F',
            buildTmuxPaneFormat()
        ])

        const firstLine = stdout
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0)

        if (!firstLine) {
            return null
        }

        return parseTmuxPaneLine(firstLine)
    } catch {
        return null
    }
}

async function waitForFirstTmuxPane(tmuxSession: string, timeoutMs: number): Promise<ParsedTmuxPaneLine | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const pane = await getFirstTmuxPane(tmuxSession)
        if (pane) {
            return pane
        }

        await sleep(100)
    }

    return null
}

async function waitForTmuxPaneCommand(
    tmuxSession: string,
    tmuxPane: string,
    command: EnabledNativeCommand,
    timeoutMs: number
): Promise<TmuxPane | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const nextPane = await getTmuxPane(tmuxPane)
        if (nextPane && nextPane.tmuxSession === tmuxSession && nextPane.command === command) {
            return nextPane
        }

        await sleep(250)
    }

    return null
}

async function captureTmuxPane(tmuxPane: string): Promise<string> {
    const stdout = await runTmux([
        'capture-pane',
        '-p',
        '-t',
        tmuxPane,
        '-S',
        INITIAL_CAPTURE_LINES
    ])

    return normalizeSnapshot(stdout)
}

async function sendTmuxInput(tmuxPane: string, text: string): Promise<void> {
    const bufferName = `hapi-native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    try {
        await runTmux(['load-buffer', '-b', bufferName, '-'], { stdin: text })
        await runTmux(['paste-buffer', '-d', '-b', bufferName, '-t', tmuxPane])
        // Full-screen TUIs like Codex can swallow an immediate Enter that lands in
        // the same paste burst. Give the app one frame to ingest pasted input.
        await sleep(TMUX_SUBMIT_DELAY_MS)
        await runTmux(['send-keys', '-t', tmuxPane, 'Enter'])
    } finally {
        try {
            await runTmux(['delete-buffer', '-b', bufferName])
        } catch {
        }
    }
}

async function sendTmuxInterrupt(tmuxPane: string): Promise<void> {
    await runTmux(['send-keys', '-t', tmuxPane, 'C-c'])
}

async function sendTmuxKey(tmuxPane: string, key: string): Promise<void> {
    await runTmux(['send-keys', '-t', tmuxPane, key])
}

async function sendTmuxCommand(tmuxPane: string, command: string): Promise<void> {
    await runTmux(['send-keys', '-t', tmuxPane, command, 'Enter'])
}

async function killTmuxSession(tmuxSession: string): Promise<void> {
    try {
        await runTmux(['kill-session', '-t', tmuxSession])
    } catch {
    }
}

export class NativeSessionManager {
    private readonly host = hostname()
    private readonly os = platform()
    private readonly trackers: Map<string, NativeTracker> = new Map()
    private readonly deps: NativeSessionManagerDeps
    private readonly leadership: NativeLeadershipCoordinator | null

    constructor(deps: NativeSessionManagerDeps, leadershipOptions?: NativeLeadershipOptions) {
        this.deps = deps
        this.leadership = leadershipOptions
            ? new NativeLeadershipCoordinator(leadershipOptions, {
                onAcquired: async () => {
                    this.deps.reloadState()
                    await this.restoreTrackedSessions()
                },
                onLost: () => {
                    this.stopAllTracking(true)
                }
            })
            : null
        this.leadership?.start()
    }

    async restoreTrackedSessions(): Promise<void> {
        if (this.leadership && !this.leadership.isLeader()) {
            return
        }

        const sessions = this.deps.getSessions().filter((session) => {
            const native = session.metadata?.native
            return session.metadata?.source === 'native-attached'
                && native !== undefined
                && native.attached !== false
        })

        for (const session of sessions) {
            try {
                await this.resume(session.id, session.namespace, { allowRestart: false })
            } catch (error) {
                console.warn(`[NativeSession] failed to restore ${session.id}:`, error)
            }
        }
    }

    stop(): void {
        this.leadership?.stop()
        this.stopAllTracking(false)
    }

    async discover(namespace: string): Promise<NativeSessionDiscoverItem[]> {
        const panes = await listTmuxPanes()
        const sessions = this.deps.getSessionsByNamespace(namespace)

        return panes
            .map((pane) => {
                const matched = sessions.find((session) =>
                    session.metadata?.source === 'native-attached'
                    && session.metadata.native?.tmuxSession === pane.tmuxSession
                    && session.metadata.native?.tmuxPane === pane.tmuxPane
                    && session.metadata.native?.attached !== false
                )

                return {
                    tmuxSession: pane.tmuxSession,
                    tmuxPane: pane.tmuxPane,
                    cwd: pane.cwd,
                    command: pane.command,
                    sessionId: matched?.id
                } satisfies NativeSessionDiscoverItem
            })
            .sort((left, right) => {
                if (left.tmuxSession !== right.tmuxSession) {
                    return left.tmuxSession.localeCompare(right.tmuxSession)
                }
                return left.tmuxPane.localeCompare(right.tmuxPane)
            })
    }

    async attach(options: {
        namespace: string
        tmuxSession: string
        tmuxPane: string
        agent?: EnabledNativeCommand
        title?: string
    }): Promise<Session> {
        await this.ensureLeadership()

        const pane = await getTmuxPane(options.tmuxPane)
        if (!pane || pane.tmuxSession !== options.tmuxSession) {
            throw new Error('tmux pane not found')
        }

        if (!isEnabledNativeCommand(pane.command)) {
            throw new Error('Native attach currently supports codex only')
        }

        const command = options.agent ?? pane.command
        if (!isEnabledNativeCommand(command)) {
            throw new Error('Native attach currently supports codex only')
        }

        let session = this.deps.getOrCreateSession(
            buildNativeSessionTag(pane.tmuxSession, pane.tmuxPane),
            this.buildMetadata({
                cwd: pane.cwd,
                tmuxSession: pane.tmuxSession,
                tmuxPane: pane.tmuxPane,
                command,
                title: options.title
            }),
            this.buildAgentState(),
            options.namespace
        )

        const metadata = this.buildMetadata({
            cwd: pane.cwd,
            tmuxSession: pane.tmuxSession,
            tmuxPane: pane.tmuxPane,
            command,
            title: options.title,
            codexSessionId: session.metadata?.codexSessionId
        })

        session = this.deps.updateSessionMetadata(session.id, metadata, { touchUpdatedAt: false })
        session = this.deps.updateSessionAgentState(session.id, {
            ...(session.agentState ?? {}),
            ...this.buildAgentState(session.agentState ?? undefined)
        })

        await this.startTracking(session, pane)
        return await this.waitForPersistedCodexSessionId(session.id, INITIAL_CODEX_SESSION_ID_PERSIST_TIMEOUT_MS)
    }

    async create(options: {
        namespace: string
        cwd: string
        agent?: EnabledNativeCommand
        title?: string
    }): Promise<Session> {
        await this.ensureLeadership()

        const cwd = options.cwd.trim()
        if (!cwd) {
            throw new Error('Directory is required')
        }

        ensureDirectoryExists(cwd)

        const command = options.agent ?? 'codex'
        if (!isEnabledNativeCommand(command)) {
            throw new Error('Native create currently supports codex only')
        }

        const tmuxSession = buildTmuxSessionName(cwd, options.title)
        let pane: ParsedTmuxPaneLine | null = null

        try {
            await runTmux(['new-session', '-d', '-s', tmuxSession, '-c', cwd])
            pane = await waitForFirstTmuxPane(tmuxSession, 2_000)
            if (!pane) {
                throw new Error('Failed to create tmux session')
            }

            await sendTmuxCommand(pane.tmuxPane, command)

            const nextPane = await waitForTmuxPaneCommand(tmuxSession, pane.tmuxPane, command, 10_000)
            if (nextPane) {
                return await this.attach({
                    namespace: options.namespace,
                    tmuxSession,
                    tmuxPane: nextPane.tmuxPane,
                    agent: command,
                    title: options.title
                })
            }

            throw new Error('Timed out waiting for codex to start in tmux')
        } catch (error) {
            await killTmuxSession(tmuxSession)
            throw error
        }
    }

    async openCodexSession(options: {
        namespace: string
        cwd: string
        codexSessionId: string
        title?: string
    }): Promise<Session> {
        await this.ensureLeadership()

        const cwd = options.cwd.trim()
        const codexSessionId = options.codexSessionId.trim()
        if (!cwd) {
            throw new Error('Directory is required')
        }
        if (!codexSessionId) {
            throw new Error('Codex session ID is required')
        }

        const existing = this.deps.getSessionsByNamespace(options.namespace)
            .filter((session) =>
                session.metadata?.source === 'native-attached'
                && session.metadata?.codexSessionId === codexSessionId
                && normalizeComparablePath(session.metadata.path) === normalizeComparablePath(cwd)
            )
            .sort((left, right) => {
                if (left.active !== right.active) {
                    return left.active ? -1 : 1
                }
                return right.updatedAt - left.updatedAt
            })[0]

        if (existing) {
            if (existing.active) {
                return existing
            }

            const resumed = await this.resume(existing.id, options.namespace, { allowRestart: true })
            if (resumed) {
                return this.deps.getSessionByNamespace(existing.id, options.namespace) ?? existing
            }
        }

        ensureDirectoryExists(cwd)

        const tmuxSession = buildTmuxSessionName(cwd, options.title)

        try {
            await runTmux(['new-session', '-d', '-s', tmuxSession, '-c', cwd])
            const pane = await waitForFirstTmuxPane(tmuxSession, 2_000)
            if (!pane) {
                throw new Error('Failed to create tmux session')
            }

            await sendTmuxCommand(pane.tmuxPane, buildCodexResumeCommand(codexSessionId))
            const resumedPane = await waitForTmuxPaneCommand(tmuxSession, pane.tmuxPane, 'codex', 10_000)
            if (!resumedPane) {
                throw new Error('Timed out waiting for codex resume to start in tmux')
            }

            let session = await this.attach({
                namespace: options.namespace,
                tmuxSession,
                tmuxPane: resumedPane.tmuxPane,
                agent: 'codex',
                title: options.title
            })

            if (session.metadata?.codexSessionId !== codexSessionId) {
                session = this.deps.updateSessionMetadata(session.id, this.buildMetadata({
                    cwd,
                    tmuxSession: resumedPane.tmuxSession,
                    tmuxPane: resumedPane.tmuxPane,
                    command: 'codex',
                    title: options.title,
                    codexSessionId
                }), { touchUpdatedAt: false })
            }

            return session
        } catch (error) {
            await killTmuxSession(tmuxSession)
            throw error
        }
    }

    async resume(sessionId: string, namespace: string, options?: { allowRestart?: boolean }): Promise<boolean> {
        await this.ensureLeadership()

        const session = this.deps.getSessionByNamespace(sessionId, namespace)
        const native = session?.metadata?.native
        if (
            !session
            || session.metadata?.source !== 'native-attached'
            || !native
            || native.command !== 'codex'
            || native.attached === false
        ) {
            return false
        }

        let paneState = await getTmuxPaneState(native.tmuxPane)
        if (!paneState || paneState.tmuxSession !== native.tmuxSession) {
            const sessionPaneState = await getTmuxSessionPaneState(native.tmuxSession)
            if (sessionPaneState) {
                paneState = sessionPaneState
            }
        }
        const knownPaneCommand = paneState
            ? resolveKnownNativePaneCommand(paneState, native.command)
            : null

        if (paneState && knownPaneCommand && isEnabledNativeCommand(knownPaneCommand)) {
            await this.startTracking(session, {
                tmuxSession: paneState.tmuxSession,
                tmuxPane: paneState.tmuxPane,
                panePid: paneState.panePid,
                cwd: paneState.cwd,
                command: knownPaneCommand
            })
            return true
        }

        if (!options?.allowRestart || !session.metadata?.codexSessionId || !session.metadata.path) {
            return false
        }

        if (paneState && isShellLikeCommand(paneState.rawCommand)) {
            await sendTmuxCommand(paneState.tmuxPane, buildCodexResumeCommand(session.metadata.codexSessionId))
            const resumedPane = await waitForTmuxPaneCommand(paneState.tmuxSession, paneState.tmuxPane, 'codex', 10_000)
            if (resumedPane) {
                await this.reattachResumedPane(session, resumedPane)
                return true
            }
        }

        console.warn('[NativeSession] resume fell back to tmux restart', {
            sessionId,
            tmuxSession: native.tmuxSession,
            tmuxPane: native.tmuxPane,
            rawCommand: paneState?.rawCommand ?? null,
            resolvedCommand: paneState?.command ?? null,
            knownPaneCommand,
            paneStateSession: paneState?.tmuxSession ?? null
        })

        const resumedPane = await this.restartIntoNewTmuxSession(session, session.metadata.codexSessionId)
        if (!resumedPane) {
            return false
        }

        await this.reattachResumedPane(session, resumedPane)
        return true
    }

    async detach(sessionId: string, namespace: string): Promise<void> {
        await this.ensureLeadership()

        const session = this.deps.getSessionByNamespace(sessionId, namespace)
        if (!session || session.metadata?.source !== 'native-attached') {
            throw new Error('Native session not found')
        }

        if (session.metadata?.native) {
            this.deps.updateSessionMetadata(session.id, {
                ...session.metadata,
                native: {
                    ...session.metadata.native,
                    attached: false
                }
            }, { touchUpdatedAt: false })
        }

        this.stopTracking(sessionId, true)
    }

    async sendInput(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            sentFrom?: 'telegram-bot' | 'webapp'
        }
    ): Promise<void> {
        await this.ensureLeadership()

        if (!payload.text.trim()) {
            return
        }

        const session = this.requireNativeSession(sessionId)
        const tracker = await this.ensureTracker(session)

        await sendTmuxInput(tracker.tmuxPane, payload.text)

        this.deps.appendMessage(sessionId, {
            role: 'user',
            content: {
                type: 'text',
                text: payload.text
            },
            meta: {
                sentFrom: payload.sentFrom ?? 'webapp',
                source: 'native-attached'
            }
        }, payload.localId ?? undefined)
        this.rememberRecentUserInput(tracker, payload.text)

        tracker.thinking = true
        tracker.lastOutputAt = Date.now()
        this.deps.handleSessionAlive({
            sid: sessionId,
            time: tracker.lastOutputAt,
            thinking: true
        })
    }

    async interrupt(sessionId: string): Promise<void> {
        await this.ensureLeadership()

        const session = this.requireNativeSession(sessionId)
        const tracker = await this.ensureTracker(session)
        await sendTmuxInterrupt(tracker.tmuxPane)

        tracker.thinking = false
        this.deps.handleSessionAlive({
            sid: sessionId,
            time: Date.now(),
            thinking: false
        })
    }

    private async restartIntoNewTmuxSession(session: Session, codexSessionId: string): Promise<TmuxPane | null> {
        const cwd = session.metadata?.path
        if (!cwd) {
            return null
        }

        ensureDirectoryExists(cwd)

        const tmuxSession = buildTmuxSessionName(cwd, session.metadata?.name)
        let pane: ParsedTmuxPaneLine | null = null

        try {
            await runTmux(['new-session', '-d', '-s', tmuxSession, '-c', cwd])
            pane = await waitForFirstTmuxPane(tmuxSession, 2_000)
            if (!pane) {
                throw new Error('Failed to create tmux session for native resume')
            }

            await sendTmuxCommand(pane.tmuxPane, buildCodexResumeCommand(codexSessionId))
            const resumedPane = await waitForTmuxPaneCommand(tmuxSession, pane.tmuxPane, 'codex', 10_000)
            if (!resumedPane) {
                await killTmuxSession(tmuxSession)
            }
            return resumedPane
        } catch (error) {
            await killTmuxSession(tmuxSession)
            throw error
        }
    }

    private async reattachResumedPane(session: Session, pane: TmuxPane): Promise<void> {
        const metadata = this.buildMetadata({
            cwd: pane.cwd,
            tmuxSession: pane.tmuxSession,
            tmuxPane: pane.tmuxPane,
            command: 'codex',
            title: session.metadata?.name,
            codexSessionId: session.metadata?.codexSessionId
        })
        const refreshed = this.deps.updateSessionMetadata(session.id, metadata, { touchUpdatedAt: false })
        await this.startTracking(refreshed, pane)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.ensureLeadership()

        const session = this.requireNativeSession(sessionId)
        const tracker = await this.ensureTracker(session)
        const request = session.agentState?.requests?.[requestId]

        if (!request || tracker.pendingPermission?.id !== requestId) {
            throw new Error('Native permission request not found')
        }

        if (request.tool !== 'CodexBash') {
            throw new Error('Native remote approval currently supports Codex command prompts only')
        }

        const key = mapNativeCodexApprovalKey(decision)
        await sendTmuxKey(tracker.tmuxPane, key)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    ): Promise<void> {
        await this.ensureLeadership()
        await this.approvePermission(sessionId, requestId, decision === 'approved_for_session' ? 'abort' : (decision ?? 'abort'))
    }

    private buildMetadata(props: {
        cwd: string
        tmuxSession: string
        tmuxPane: string
        command: EnabledNativeCommand
        title?: string
        codexSessionId?: string
    }): Metadata {
        return {
            path: props.cwd,
            host: this.host,
            os: this.os,
            name: props.title?.trim() || buildDefaultTitle(props.cwd, `${props.tmuxSession}:${props.tmuxPane}`),
            flavor: props.command,
            codexSessionId: props.codexSessionId,
            source: 'native-attached',
            startedBy: 'terminal',
            native: {
                tmuxSession: props.tmuxSession,
                tmuxPane: props.tmuxPane,
                command: props.command,
                attachedAt: Date.now(),
                attached: true
            }
        }
    }

    private buildAgentState(previous?: AgentState): AgentState {
        return {
            controlledByUser: true,
            requests: previous?.requests ?? {},
            completedRequests: previous?.completedRequests ?? {}
        }
    }

    private requireNativeSession(sessionId: string): Session {
        const session = this.deps.getSession(sessionId)
        if (!session || session.metadata?.source !== 'native-attached' || !session.metadata?.native) {
            throw new Error('Native session not found')
        }
        return session
    }

    private async ensureLeadership(): Promise<void> {
        await this.leadership?.ensureLeader()
    }

    private async ensureTracker(session: Session): Promise<NativeTracker> {
        const existing = this.trackers.get(session.id)
        if (existing) {
            return existing
        }

        if (!session.metadata?.native) {
            throw new Error('Native session metadata missing')
        }

        const nativeCommand = session.metadata.native.command
        if (nativeCommand !== 'codex' && nativeCommand !== 'claude') {
            throw new Error('Native session command unsupported')
        }

        if (!isEnabledNativeCommand(nativeCommand)) {
            throw new Error('Native session command unsupported')
        }

        const pane = await getKnownTmuxPane(session.metadata.native.tmuxPane, nativeCommand)
        if (!pane) {
            throw new Error('tmux pane not found')
        }

        await this.startTracking(session, pane)
        return this.trackers.get(session.id) ?? (() => { throw new Error('Failed to track native session') })()
    }

    private async startTracking(session: Session, pane: TmuxPane): Promise<void> {
        if (!isEnabledNativeCommand(pane.command)) {
            this.stopTracking(session.id, true)
            return
        }

        const current = this.trackers.get(session.id)
        if (current) {
            current.tmuxSession = pane.tmuxSession
            current.tmuxPane = pane.tmuxPane
            current.command = pane.command
            current.lastCodexSessionIdSyncAt = 0
            current.transcript = createNativeCodexTranscriptState(session.metadata?.codexSessionId ?? current.transcript.codexSessionId)
            current.recentUserInputs = []
            current.lastSnapshot = await captureTmuxPane(pane.tmuxPane)
            this.syncPermissionState(session.id, current, current.lastSnapshot)
            await this.maybeSyncCodexSessionMetadata(session.id, pane, current, true)
            this.syncCodexTranscript(session.id, current, current.lastSnapshot)
            this.deps.handleSessionAlive({
                sid: session.id,
                time: Date.now(),
                thinking: current.thinking
            })
            return
        }

        const initialSnapshot = await captureTmuxPane(pane.tmuxPane)
        const tracker: NativeTracker = {
            sessionId: session.id,
            tmuxSession: pane.tmuxSession,
            tmuxPane: pane.tmuxPane,
            command: pane.command,
            lastSnapshot: initialSnapshot,
            lastOutputAt: Date.now(),
            lastCodexSessionIdSyncAt: 0,
            thinking: false,
            pendingPermission: null,
            recentUserInputs: [],
            transcript: createNativeCodexTranscriptState(session.metadata?.codexSessionId),
            timer: null
        }

        this.trackers.set(session.id, tracker)
        this.syncPermissionState(session.id, tracker, initialSnapshot)
        await this.maybeSyncCodexSessionMetadata(session.id, pane, tracker, true)
        this.syncCodexTranscript(session.id, tracker, initialSnapshot)
        this.deps.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            thinking: false
        })

        this.scheduleNextPoll(session.id)
    }

    private scheduleNextPoll(sessionId: string): void {
        const tracker = this.trackers.get(sessionId)
        if (!tracker) {
            return
        }

        tracker.timer = setTimeout(() => {
            void this.pollSession(sessionId)
        }, POLL_INTERVAL_MS)
    }

    private async pollSession(sessionId: string): Promise<void> {
        const tracker = this.trackers.get(sessionId)
        if (!tracker) {
            return
        }

        try {
            const pane = await getKnownTmuxPane(tracker.tmuxPane, tracker.command)
            if (!pane || !isEnabledNativeCommand(pane.command)) {
                this.stopTracking(sessionId, true)
                return
            }

            await this.maybeSyncCodexSessionMetadata(sessionId, pane, tracker)

            const snapshot = await captureTmuxPane(pane.tmuxPane)
            const nextChunk = diffCapturedTmuxOutput(tracker.lastSnapshot, snapshot)
            tracker.lastSnapshot = snapshot
            this.syncPermissionState(sessionId, tracker, snapshot)
            const transcriptActive = this.syncCodexTranscript(sessionId, tracker, snapshot)

            const now = Date.now()
            if (nextChunk.length > 0) {
                tracker.thinking = tracker.pendingPermission === null
                tracker.lastOutputAt = now
                this.deps.handleSessionAlive({
                    sid: sessionId,
                    time: now,
                    thinking: tracker.thinking
                })
                if (!transcriptActive && pane.command !== 'codex') {
                    this.appendAssistantOutput(sessionId, nextChunk)
                }
            } else {
                if (tracker.thinking && now - tracker.lastOutputAt >= THINKING_IDLE_MS) {
                    tracker.thinking = false
                }

                this.deps.handleSessionAlive({
                    sid: sessionId,
                    time: now,
                    thinking: tracker.thinking
                })
            }
        } catch (error) {
            console.warn(`[NativeSession] poll failed for ${sessionId}:`, error)
            this.stopTracking(sessionId, true)
            return
        }

        this.scheduleNextPoll(sessionId)
    }

    private stopTracking(sessionId: string, markInactive: boolean): void {
        const tracker = this.trackers.get(sessionId)
        if (!tracker) {
            if (markInactive) {
                this.deps.handleSessionEnd({ sid: sessionId, time: Date.now() })
            }
            return
        }

        if (tracker.timer) {
            clearTimeout(tracker.timer)
        }

        this.trackers.delete(sessionId)

        if (markInactive) {
            this.deps.handleSessionEnd({ sid: sessionId, time: Date.now() })
        }
    }

    private stopAllTracking(markInactive: boolean): void {
        const trackedSessionIds = Array.from(this.trackers.keys())
        for (const sessionId of trackedSessionIds) {
            this.stopTracking(sessionId, markInactive)
        }
    }

    private async maybeSyncCodexSessionMetadata(
        sessionId: string,
        pane: TmuxPane,
        tracker: NativeTracker,
        force: boolean = false
    ): Promise<void> {
        let session = this.deps.getSession(sessionId)
        if (!session?.metadata || session.metadata.source !== 'native-attached') {
            return
        }

        const now = Date.now()
        if (!force && now - tracker.lastCodexSessionIdSyncAt < CODEX_SESSION_ID_SYNC_INTERVAL_MS) {
            return
        }

        tracker.lastCodexSessionIdSyncAt = now

        const sqlitePersistedSession = this.persistCodexSessionIdFromStateSqlite(session)
        if (sqlitePersistedSession) {
            session = sqlitePersistedSession
        }

        const metadata = session.metadata
        if (!metadata || metadata.source !== 'native-attached') {
            return
        }

        const resolvedCodexSessionId = metadata.codexSessionId
            ?? tracker.transcript.codexSessionId
            ?? await resolveCodexSessionIdForPane(pane.panePid, {
            attachedAtMs: metadata.native?.attachedAt
        })
        const nextCodexSessionId = resolvedCodexSessionId ?? metadata.codexSessionId
        const nativeMetadata = metadata.native
        const shouldUpdateNative = nativeMetadata
            ? nativeMetadata.tmuxSession !== pane.tmuxSession
                || nativeMetadata.tmuxPane !== pane.tmuxPane
                || nativeMetadata.command !== pane.command
                || nativeMetadata.attached === false
            : true

        if (nextCodexSessionId === metadata.codexSessionId && !shouldUpdateNative) {
            return
        }

        this.deps.updateSessionMetadata(sessionId, {
            ...metadata,
            codexSessionId: nextCodexSessionId,
            native: {
                ...metadata.native,
                tmuxSession: pane.tmuxSession,
                tmuxPane: pane.tmuxPane,
                command: pane.command,
                attached: true
            }
        }, { touchUpdatedAt: false })
    }

    private persistCodexSessionIdFromStateSqlite(session: Session): Session | null {
        if (
            session.metadata?.source !== 'native-attached'
            || session.metadata.flavor !== 'codex'
            || !session.metadata.path
            || session.metadata.codexSessionId
        ) {
            return null
        }

        const codexSessionId = resolveCodexSessionIdFromStateSqlite({
            cwd: session.metadata.path,
            attachedAtMs: session.metadata.native?.attachedAt
        })
        if (!codexSessionId) {
            return null
        }

        return this.deps.updateSessionMetadata(session.id, {
            ...session.metadata,
            codexSessionId,
            native: {
                ...session.metadata.native,
                attached: true
            }
        }, { touchUpdatedAt: false })
    }

    private async waitForPersistedCodexSessionId(
        sessionId: string,
        timeoutMs: number,
        pollIntervalMs: number = INITIAL_CODEX_SESSION_ID_POLL_INTERVAL_MS
    ): Promise<Session> {
        let session = this.deps.getSession(sessionId)
        if (!session) {
            throw new Error('Native session not found')
        }

        if (
            session.metadata?.source !== 'native-attached'
            || session.metadata.flavor !== 'codex'
            || session.metadata.codexSessionId
        ) {
            return session
        }

        const sqlitePersistedSession = this.persistCodexSessionIdFromStateSqlite(session)
        if (sqlitePersistedSession) {
            return sqlitePersistedSession
        }

        const deadline = Date.now() + Math.max(0, timeoutMs)
        const safePollIntervalMs = Math.max(1, pollIntervalMs)

        while (Date.now() < deadline) {
            const persistedDuringWait = this.persistCodexSessionIdFromStateSqlite(session)
            if (persistedDuringWait) {
                return persistedDuringWait
            }

            await sleep(safePollIntervalMs)
            session = this.deps.getSession(sessionId) ?? session
            if (session.metadata?.codexSessionId) {
                return session
            }
        }

        return session
    }

    private syncCodexTranscript(sessionId: string, tracker: NativeTracker, snapshot: string): boolean {
        if (tracker.command !== 'codex') {
            return false
        }

        const session = this.deps.getSession(sessionId)
        if (!session?.metadata || session.metadata.source !== 'native-attached' || !session.metadata.path) {
            return false
        }

        const result = syncNativeCodexTranscript(tracker.transcript, {
            cwd: session.metadata.path,
            hintedSessionId: session.metadata.codexSessionId,
            attachedAtMs: session.metadata.native?.attachedAt,
            snapshotText: snapshot
        })

        if (
            result.codexSessionId
            && result.codexSessionId !== session.metadata.codexSessionId
        ) {
            this.deps.updateSessionMetadata(sessionId, {
                ...session.metadata,
                codexSessionId: result.codexSessionId,
                native: {
                    ...session.metadata.native,
                    attached: true
                }
            }, { touchUpdatedAt: false })
        }

        for (const message of result.messages) {
            if (message.role === 'user') {
                if (this.shouldSkipTranscriptUserMessage(tracker, message.text)) {
                    continue
                }
                this.appendCodexTranscriptUserMessage(sessionId, message.text, message.localId)
                continue
            }

            this.appendCodexTranscriptAgentMessage(sessionId, message.body, message.localId)
        }

        return result.active
    }

    private syncPermissionState(sessionId: string, tracker: NativeTracker, snapshot: string): void {
        const activePrompt = parseNativeCodexCommandPermissionPrompt(snapshot)

        if (activePrompt) {
            tracker.thinking = false

            if (tracker.pendingPermission?.fingerprint === activePrompt.fingerprint) {
                return
            }

            const session = this.deps.getSession(sessionId)
            const existingRequest = session
                ? Object.entries(session.agentState?.requests ?? {}).find(([, request]) =>
                    request.tool === 'CodexBash'
                    && typeof request.arguments === 'object'
                    && request.arguments !== null
                    && (request.arguments as { command?: unknown }).command === activePrompt.command
                )
                : null

            const requestId = existingRequest?.[0] ?? randomUUID()
            const createdAt = existingRequest?.[1].createdAt ?? Date.now()

            tracker.pendingPermission = {
                id: requestId,
                fingerprint: activePrompt.fingerprint,
                command: activePrompt.command,
                createdAt
            }

            this.deps.updateSessionAgentState(sessionId, {
                ...(session?.agentState ?? {}),
                ...this.buildAgentState(session?.agentState ?? undefined),
                requests: {
                    ...(session?.agentState?.requests ?? {}),
                    [requestId]: {
                        tool: 'CodexBash',
                        arguments: {
                            message: activePrompt.question,
                            command: activePrompt.command,
                            cwd: session?.metadata?.path
                        },
                        createdAt
                    }
                }
            })
            return
        }

        if (!tracker.pendingPermission) {
            return
        }

        const result = parseNativeCodexCommandPermissionResult(snapshot)
        const pending = tracker.pendingPermission

        if (!result || result.command !== pending.command) {
            return
        }

        tracker.pendingPermission = null

        const session = this.deps.getSession(sessionId)
        const currentRequests = { ...(session?.agentState?.requests ?? {}) }
        const request = currentRequests[pending.id]
        if (!request) {
            return
        }

        delete currentRequests[pending.id]

        this.deps.updateSessionAgentState(sessionId, {
            ...(session?.agentState ?? {}),
            ...this.buildAgentState(session?.agentState ?? undefined),
            requests: currentRequests,
            completedRequests: {
                ...(session?.agentState?.completedRequests ?? {}),
                [pending.id]: {
                    ...request,
                    createdAt: request.createdAt ?? pending.createdAt,
                    completedAt: Date.now(),
                    status: result.status,
                    decision: result.decision
                }
            }
        })
    }

    private rememberRecentUserInput(tracker: NativeTracker, text: string): void {
        this.pruneRecentUserInputs(tracker)
        tracker.recentUserInputs.push({
            text: normalizeComparableText(text),
            createdAt: Date.now()
        })

        if (tracker.recentUserInputs.length > 10) {
            tracker.recentUserInputs.shift()
        }
    }

    private shouldSkipTranscriptUserMessage(tracker: NativeTracker, text: string): boolean {
        this.pruneRecentUserInputs(tracker)
        const normalizedText = normalizeComparableText(text)
        const matchIndex = tracker.recentUserInputs.findIndex((entry) => entry.text === normalizedText)
        if (matchIndex < 0) {
            return false
        }

        tracker.recentUserInputs.splice(matchIndex, 1)
        return true
    }

    private pruneRecentUserInputs(tracker: NativeTracker): void {
        const cutoff = Date.now() - NATIVE_TRANSCRIPT_USER_ECHO_MAX_AGE_MS
        tracker.recentUserInputs = tracker.recentUserInputs.filter((entry) => entry.createdAt >= cutoff)
    }

    private appendCodexTranscriptUserMessage(sessionId: string, text: string, localId: string): void {
        this.deps.appendMessage(sessionId, {
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom: 'cli',
                source: 'native-attached'
            }
        }, localId)
    }

    private appendCodexTranscriptAgentMessage(sessionId: string, body: unknown, localId: string): void {
        this.deps.appendMessage(sessionId, {
            role: 'agent',
            content: {
                type: AGENT_MESSAGE_PAYLOAD_TYPE,
                data: body
            },
            meta: {
                sentFrom: 'cli',
                source: 'native-attached'
            }
        }, localId)
    }

    private appendAssistantOutput(sessionId: string, text: string): void {
        this.deps.appendMessage(sessionId, {
            role: 'agent',
            content: text,
            meta: {
                source: 'native-attached'
            }
        })
    }
}
