import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const TRANSCRIPT_DISCOVERY_INTERVAL_MS = 3_000
const RECENT_TRANSCRIPT_ACTIVITY_WINDOW_MS = 30 * 60 * 1000
const SNAPSHOT_MATCH_BONUS = 3_000
const RECENT_HINT_MATCH_BONUS = 1_000
const MAX_RECENT_USER_MESSAGES = 5
const MAX_SNAPSHOT_HINTS = 6

type CodexTranscriptEvent = {
    type?: unknown
    payload?: unknown
}

type CodexTranscriptMeta = {
    filePath: string
    sessionId: string
    cwd: string
    timestamp: number | null
    source: string | null
    originator: string | null
    mtimeMs: number
    recentUserMessages: string[]
}

export type NativeCodexTranscriptState = {
    filePath: string | null
    lineCursor: number
    codexSessionId: string | null
    lastDiscoveryAt: number
}

export type NativeCodexTranscriptMessage = {
    localId: string
    role: 'user'
    text: string
} | {
    localId: string
    role: 'agent'
    body: unknown
}

export type SyncNativeCodexTranscriptResult = {
    active: boolean
    codexSessionId: string | null
    messages: NativeCodexTranscriptMessage[]
}

export function createNativeCodexTranscriptState(initialSessionId?: string | null): NativeCodexTranscriptState {
    return {
        filePath: null,
        lineCursor: 0,
        codexSessionId: initialSessionId?.trim() || null,
        lastDiscoveryAt: 0
    }
}

export function syncNativeCodexTranscript(
    state: NativeCodexTranscriptState,
    options: {
        cwd: string
        hintedSessionId?: string | null
        attachedAtMs?: number
        snapshotText?: string
        codexHomeDir?: string
    }
): SyncNativeCodexTranscriptResult {
    const now = Date.now()
    const hintedSessionId = options.hintedSessionId?.trim() || null

    if (
        !state.filePath
        || !existsSync(state.filePath)
        || (hintedSessionId && state.codexSessionId && hintedSessionId !== state.codexSessionId)
    ) {
        if (now - state.lastDiscoveryAt < TRANSCRIPT_DISCOVERY_INTERVAL_MS) {
            return {
                active: false,
                codexSessionId: state.codexSessionId,
                messages: []
            }
        }

        state.lastDiscoveryAt = now

        const discovered = discoverNativeCodexTranscript({
            cwd: options.cwd,
            hintedSessionId,
            attachedAtMs: options.attachedAtMs,
            snapshotText: options.snapshotText,
            codexHomeDir: options.codexHomeDir
        })

        if (!discovered) {
            return {
                active: false,
                codexSessionId: state.codexSessionId,
                messages: []
            }
        }

        if (state.filePath !== discovered.filePath) {
            state.filePath = discovered.filePath
            state.lineCursor = 0
        }
        state.codexSessionId = discovered.sessionId
    }

    if (!state.filePath) {
        return {
            active: false,
            codexSessionId: state.codexSessionId,
            messages: []
        }
    }

    const delta = readTranscriptDelta(state.filePath, state.lineCursor)
    if (!delta) {
        state.filePath = null
        state.lineCursor = 0
        return {
            active: false,
            codexSessionId: state.codexSessionId,
            messages: []
        }
    }

    state.lineCursor = delta.nextCursor
    if (delta.codexSessionId) {
        state.codexSessionId = delta.codexSessionId
    }

    return {
        active: true,
        codexSessionId: state.codexSessionId,
        messages: delta.messages
    }
}

function discoverNativeCodexTranscript(options: {
    cwd: string
    hintedSessionId: string | null
    attachedAtMs?: number
    snapshotText?: string
    codexHomeDir?: string
}): { filePath: string; sessionId: string } | null {
    const sessionsRoot = join(options.codexHomeDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
    const snapshotHints = extractSnapshotPromptHints(options.snapshotText)
    const targetCwd = normalizePath(options.cwd)
    const files = listSessionFiles(sessionsRoot)

    const candidates = files
        .map((filePath) => readTranscriptMetadata(filePath))
        .filter((meta): meta is CodexTranscriptMeta => meta !== null)
        .filter((meta) => isSupportedNativeCodexTranscript(meta))
        .filter((meta) => normalizePath(meta.cwd) === targetCwd)

    if (candidates.length === 0) {
        return null
    }

    const scored = candidates
        .map((candidate) => {
            const snapshotMatch = candidateMatchesSnapshotHints(candidate, snapshotHints)
            const recentHintMatch = Boolean(
                options.hintedSessionId
                && candidate.sessionId === options.hintedSessionId
                && Date.now() - candidate.mtimeMs <= RECENT_TRANSCRIPT_ACTIVITY_WINDOW_MS
            )

            return {
                candidate,
                snapshotMatch,
                recentHintMatch,
                score: scoreTranscriptCandidate(candidate, {
                    hintedSessionId: options.hintedSessionId,
                    attachedAtMs: options.attachedAtMs,
                    snapshotHints
                })
            }
        })
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score
            }
            return right.candidate.mtimeMs - left.candidate.mtimeMs
        })

    const best = scored[0]
    const second = scored[1]
    const bestHasStrongSignal = Boolean(best?.snapshotMatch || best?.recentHintMatch)
    if (
        best
        && best.score > 0
        && (!second || second.score < best.score)
        && bestHasStrongSignal
    ) {
        return {
            filePath: best.candidate.filePath,
            sessionId: best.candidate.sessionId
        }
    }

    if (candidates.length === 1) {
        return {
            filePath: candidates[0].filePath,
            sessionId: candidates[0].sessionId
        }
    }

    return null
}

function candidateMatchesSnapshotHints(candidate: CodexTranscriptMeta, snapshotHints: string[]): boolean {
    return snapshotHints.some((hint) => candidate.recentUserMessages.some((message) => comparableTextMatches(message, hint)))
}

function scoreTranscriptCandidate(
    candidate: CodexTranscriptMeta,
    options: {
        hintedSessionId: string | null
        attachedAtMs?: number
        snapshotHints: string[]
    }
): number {
    let score = 0
    const now = Date.now()
    const ageMs = Math.max(0, now - candidate.mtimeMs)

    if (candidateMatchesSnapshotHints(candidate, options.snapshotHints)) {
        score += SNAPSHOT_MATCH_BONUS
    }

    if (
        options.hintedSessionId
        && candidate.sessionId === options.hintedSessionId
        && ageMs <= RECENT_TRANSCRIPT_ACTIVITY_WINDOW_MS
    ) {
        score += RECENT_HINT_MATCH_BONUS
    }

    if (ageMs <= RECENT_TRANSCRIPT_ACTIVITY_WINDOW_MS) {
        score += Math.max(1, 300 - Math.floor(ageMs / 1000))
    }

    if (options.attachedAtMs && candidate.timestamp !== null) {
        const distanceMs = Math.abs(candidate.timestamp - options.attachedAtMs)
        if (distanceMs <= RECENT_TRANSCRIPT_ACTIVITY_WINDOW_MS) {
            score += Math.max(1, 120 - Math.floor(distanceMs / 5_000))
        }
    }

    return score
}

function listSessionFiles(dir: string): string[] {
    try {
        const entries = readdirSync(dir, { withFileTypes: true })
        const files: string[] = []

        for (const entry of entries) {
            const fullPath = join(dir, entry.name)
            if (entry.isDirectory()) {
                files.push(...listSessionFiles(fullPath))
                continue
            }
            if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                files.push(fullPath)
            }
        }

        return files
    } catch {
        return []
    }
}

function readTranscriptMetadata(filePath: string): CodexTranscriptMeta | null {
    try {
        const content = readFileSync(filePath, 'utf8')
        const lines = content.split('\n')
        const recentUserMessages: string[] = []
        let sessionId = extractCodexSessionIdFromTranscriptPath(filePath)
        let cwd: string | null = null
        let timestamp: number | null = null
        let source: string | null = null
        let originator: string | null = null

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) {
                continue
            }

            const parsed = safeParseJson(trimmed)
            if (!parsed) {
                continue
            }

            if (parsed.type === 'session_meta') {
                const payload = asRecord(parsed.payload)
                if (!payload) {
                    continue
                }

                sessionId = asString(payload.id) ?? sessionId
                cwd = asString(payload.cwd) ?? cwd
                timestamp = parseTimestamp(payload.timestamp)
                source = asString(payload.source)
                originator = asString(payload.originator)
                continue
            }

            if (parsed.type === 'event_msg') {
                const payload = asRecord(parsed.payload)
                if (!payload || asString(payload.type) !== 'user_message') {
                    continue
                }

                const message = asString(payload.message) ?? asString(payload.text) ?? asString(payload.content)
                if (!message) {
                    continue
                }

                recentUserMessages.push(message)
                if (recentUserMessages.length > MAX_RECENT_USER_MESSAGES) {
                    recentUserMessages.shift()
                }
            }
        }

        if (!sessionId || !cwd) {
            return null
        }

        return {
            filePath,
            sessionId,
            cwd,
            timestamp,
            source,
            originator,
            mtimeMs: statSync(filePath).mtimeMs,
            recentUserMessages
        }
    } catch {
        return null
    }
}

function isSupportedNativeCodexTranscript(meta: CodexTranscriptMeta): boolean {
    return meta.source === 'cli'
        || meta.source === 'vscode'
        || meta.originator === 'codex-tui'
        || meta.originator === 'Codex Desktop'
}

function readTranscriptDelta(
    filePath: string,
    cursor: number
): {
    codexSessionId: string | null
    nextCursor: number
    messages: NativeCodexTranscriptMessage[]
} | null {
    try {
        const content = readFileSync(filePath, 'utf8')
        const lines = content.split('\n')
        const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === ''
        const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length
        const effectiveCursor = cursor > totalLines ? 0 : cursor
        const messages: NativeCodexTranscriptMessage[] = []
        let codexSessionId = extractCodexSessionIdFromTranscriptPath(filePath)

        for (let index = 0; index < totalLines; index += 1) {
            const trimmed = lines[index]?.trim()
            if (!trimmed) {
                continue
            }

            const parsed = safeParseJson(trimmed)
            if (!parsed) {
                continue
            }

            if (parsed.type === 'session_meta') {
                const payload = asRecord(parsed.payload)
                codexSessionId = payload ? asString(payload.id) ?? codexSessionId : codexSessionId
                continue
            }

            if (index < effectiveCursor) {
                continue
            }

            const localIdBase = `native-codex:${codexSessionId ?? 'unknown'}:${index}`
            const converted = convertTranscriptEvent(parsed, localIdBase)
            if (converted) {
                messages.push(converted)
            }
        }

        return {
            codexSessionId,
            nextCursor: totalLines,
            messages
        }
    } catch {
        return null
    }
}

function convertTranscriptEvent(
    event: CodexTranscriptEvent,
    localIdBase: string
): NativeCodexTranscriptMessage | null {
    const payload = asRecord(event.payload)
    if (!payload) {
        return null
    }

    if (event.type === 'event_msg') {
        const eventType = asString(payload.type)
        if (!eventType) {
            return null
        }

        if (eventType === 'user_message') {
            const message = asString(payload.message) ?? asString(payload.text) ?? asString(payload.content)
            if (!message) {
                return null
            }

            return {
                localId: `${localIdBase}:user`,
                role: 'user',
                text: message
            }
        }

        if (eventType === 'agent_message') {
            const message = asString(payload.message)
            if (!message) {
                return null
            }

            return {
                localId: `${localIdBase}:agent-message`,
                role: 'agent',
                body: {
                    type: 'message',
                    message,
                    id: `${localIdBase}:agent`
                }
            }
        }

        if (eventType === 'agent_reasoning') {
            const message = asString(payload.text) ?? asString(payload.message)
            if (!message) {
                return null
            }

            return {
                localId: `${localIdBase}:agent-reasoning`,
                role: 'agent',
                body: {
                    type: 'reasoning',
                    message,
                    id: `${localIdBase}:reasoning`
                }
            }
        }

        return null
    }

    if (event.type === 'response_item') {
        const itemType = asString(payload.type)
        if (!itemType) {
            return null
        }

        if (itemType === 'function_call') {
            const name = asString(payload.name)
            const callId = extractCallId(payload)
            if (!name || !callId) {
                return null
            }

            return {
                localId: `${localIdBase}:tool-call`,
                role: 'agent',
                body: {
                    type: 'tool-call',
                    name,
                    callId,
                    input: parseArguments(payload.arguments),
                    id: `${localIdBase}:tool-call`
                }
            }
        }

        if (itemType === 'function_call_output') {
            const callId = extractCallId(payload)
            if (!callId) {
                return null
            }

            return {
                localId: `${localIdBase}:tool-result`,
                role: 'agent',
                body: {
                    type: 'tool-call-result',
                    callId,
                    output: payload.output,
                    id: `${localIdBase}:tool-result`
                }
            }
        }
    }

    return null
}

function extractSnapshotPromptHints(snapshotText?: string): string[] {
    if (!snapshotText) {
        return []
    }

    const hints: string[] = []
    for (const line of snapshotText.split('\n')) {
        const match = line.match(/^\s*›\s+(.+?)\s*$/)
        const prompt = match?.[1]?.trim()
        if (!prompt || hints.includes(prompt)) {
            continue
        }

        hints.push(prompt)
        if (hints.length > MAX_SNAPSHOT_HINTS) {
            hints.shift()
        }
    }

    return hints
}

function comparableTextMatches(left: string, right: string): boolean {
    const leftComparable = normalizeComparableText(left)
    const rightComparable = normalizeComparableText(right)
    if (leftComparable.length < 4 || rightComparable.length < 4) {
        return leftComparable === rightComparable
    }

    return leftComparable.includes(rightComparable) || rightComparable.includes(leftComparable)
}

function normalizeComparableText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function extractCodexSessionIdFromTranscriptPath(filePath: string): string | null {
    const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
    return match?.[1] ?? null
}

function extractCallId(payload: Record<string, unknown>): string | null {
    const candidates = [
        'call_id',
        'callId',
        'tool_call_id',
        'toolCallId',
        'id'
    ]

    for (const key of candidates) {
        const value = payload[key]
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    }

    return null
}

function parseArguments(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value
    }

    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return value
    }

    return safeParseJson(trimmed) ?? value
}

function parseTimestamp(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }

    if (typeof value === 'string' && value.length > 0) {
        const parsed = Date.parse(value)
        return Number.isNaN(parsed) ? null : parsed
    }

    return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function safeParseJson(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown
        return asRecord(parsed)
    } catch {
        return null
    }
}

function normalizePath(value: string): string {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
