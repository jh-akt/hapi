import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const MAX_RECENT_USER_MESSAGES = 5
const SUPPORTED_CATALOG_SOURCES = new Set(['cli', 'vscode'])
const SUPPORTED_CATALOG_ORIGINATORS = new Set(['codex-tui', 'happy-codex', 'codex desktop'])

export type NativeCodexSessionCatalogEntry = {
    codexSessionId: string
    cwd: string
    timestamp: number | null
    updatedAt: number
    recentUserMessages: string[]
}

type TranscriptMeta = NativeCodexSessionCatalogEntry & {
    source: string | null
    originator: string | null
}

export function listNativeCodexSessionCatalog(options?: {
    codexHomeDir?: string
}): NativeCodexSessionCatalogEntry[] {
    const sessionsRoot = join(options?.codexHomeDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
    const files = listSessionFiles(sessionsRoot)
    const deduped = new Map<string, NativeCodexSessionCatalogEntry>()

    for (const filePath of files) {
        const meta = readTranscriptMetadata(filePath)
        if (!meta || !isSupportedNativeCodexTranscript(meta)) {
            continue
        }

        const current = deduped.get(meta.codexSessionId)
        if (!current || meta.updatedAt >= current.updatedAt) {
            deduped.set(meta.codexSessionId, {
                codexSessionId: meta.codexSessionId,
                cwd: meta.cwd,
                timestamp: meta.timestamp,
                updatedAt: meta.updatedAt,
                recentUserMessages: [...meta.recentUserMessages]
            })
        }
    }

    return Array.from(deduped.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
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

function readTranscriptMetadata(filePath: string): TranscriptMeta | null {
    try {
        const content = readFileSync(filePath, 'utf8')
        const lines = content.split('\n')
        const recentUserMessages: string[] = []
        let codexSessionId = extractCodexSessionIdFromTranscriptPath(filePath)
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

                codexSessionId = asString(payload.id) ?? codexSessionId
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

        if (!codexSessionId || !cwd) {
            return null
        }

        return {
            codexSessionId,
            cwd,
            timestamp,
            source,
            originator,
            updatedAt: statSync(filePath).mtimeMs,
            recentUserMessages
        }
    } catch {
        return null
    }
}

function isSupportedNativeCodexTranscript(meta: TranscriptMeta): boolean {
    const source = normalizeTranscriptField(meta.source)
    if (source && SUPPORTED_CATALOG_SOURCES.has(source)) {
        return true
    }

    const originator = normalizeTranscriptField(meta.originator)
    return Boolean(originator && SUPPORTED_CATALOG_ORIGINATORS.has(originator))
}

function extractCodexSessionIdFromTranscriptPath(filePath: string): string | null {
    const match = filePath.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
    return match?.[1] ?? null
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

function normalizeTranscriptField(value: string | null): string | null {
    const normalized = value?.trim().toLowerCase() ?? ''
    return normalized.length > 0 ? normalized : null
}

function safeParseJson(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value) as unknown
        return asRecord(parsed)
    } catch {
        return null
    }
}

export function normalizeCatalogPath(value: string): string {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
