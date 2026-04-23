import type { ProjectSummary, SessionSummary } from '@/types/api'

export function normalizeProjectPath(path: string): string {
    const normalized = path.trim().replace(/\\/g, '/')
    if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
        return normalized
    }
    return normalized.replace(/\/+$/, '')
}

export function getSessionProjectPath(session: Pick<SessionSummary, 'metadata'>): string | null {
    const rawPath = session.metadata?.worktree?.basePath ?? session.metadata?.path
    if (!rawPath) {
        return null
    }
    const normalized = normalizeProjectPath(rawPath)
    return normalized.length > 0 ? normalized : null
}

export function getProjectPath(project: Pick<ProjectSummary, 'path'>): string {
    return normalizeProjectPath(project.path)
}
