import type { CodexSessionSummary, SessionSummary } from '@/types/api'

export type DisplaySessionSummary = SessionSummary | CodexSessionSummary

export type SessionSelectionAction =
    | {
        type: 'navigate'
        sessionId: string
    }
    | {
        type: 'resume'
        sessionId: string
    }
    | {
        type: 'open-codex-history'
        cwd: string
        codexSessionId: string
        title?: string
    }

function isCodexHistoryPlaceholderSession(session: DisplaySessionSummary): session is CodexSessionSummary {
    return 'listSource' in session
        && session.listSource === 'codex-history'
        && session.id.startsWith('codex:')
}

function getActivationTargetSessionId(session: DisplaySessionSummary): string {
    if ('attachedSessionId' in session && session.attachedSessionId) {
        return session.attachedSessionId
    }
    return session.id
}

export function resolveSessionSelectionAction(session: DisplaySessionSummary): SessionSelectionAction {
    if (isCodexHistoryPlaceholderSession(session)) {
        return {
            type: 'open-codex-history',
            cwd: session.metadata?.path ?? '',
            codexSessionId: session.codexSessionId,
            title: session.metadata?.name ?? undefined
        }
    }

    const sessionId = getActivationTargetSessionId(session)
    if (!session.active && !session.archived) {
        return {
            type: 'resume',
            sessionId
        }
    }

    return {
        type: 'navigate',
        sessionId
    }
}
