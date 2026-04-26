import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function trimTrailingSeparators(value: string): string {
    if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
        return value
    }
    return value.replace(/\/+$/u, '')
}

function expandHomePrefix(value: string): string {
    if (!/^[~～](?:[\\/]|$)/u.test(value)) {
        return value
    }

    return join(homedir(), value.slice(1))
}

export function normalizeFilesystemPath(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return ''
    }

    const expanded = expandHomePrefix(trimmed.replace(/\\/g, '/'))
    const resolved = resolve(expanded)

    let normalized = resolved
    try {
        normalized = realpathSync.native(resolved)
    } catch {
        // Keep the resolved path for directories that do not exist yet.
    }

    const withForwardSlashes = normalized.replace(/\\/g, '/')
    const withoutTrailingSeparators = trimTrailingSeparators(withForwardSlashes)
    if (!withoutTrailingSeparators) {
        return '/'
    }

    return process.platform === 'win32'
        ? withoutTrailingSeparators.replace(/^[A-Z]:/, (match) => match.toLowerCase())
        : withoutTrailingSeparators
}
