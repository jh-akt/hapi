import { describe, expect, it } from 'vitest'
import type { CodexSessionSummary, SessionSummary } from '@/types/api'
import { resolveSessionSelectionAction } from './sessionSelection'

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        model: null,
        effort: null,
        archived: false,
        ...overrides
    }
}

function makeCodexSession(
    overrides: Partial<CodexSessionSummary> & { id: string; codexSessionId: string }
): CodexSessionSummary {
    return {
        ...makeSession(overrides),
        attachedSessionId: null,
        listSource: 'codex-history',
        codexSessionId: overrides.codexSessionId,
        codexOrigin: overrides.codexOrigin ?? 'app-server-thread',
        openStrategy: overrides.openStrategy ?? 'open-app-server-thread'
    }
}

describe('resolveSessionSelectionAction', () => {
    it('navigates directly to active sessions', () => {
        expect(resolveSessionSelectionAction(makeSession({
            id: 'session-active',
            active: true
        }))).toEqual({
            type: 'navigate',
            sessionId: 'session-active'
        })
    })

    it('resumes inactive unarchived sessions', () => {
        expect(resolveSessionSelectionAction(makeSession({
            id: 'session-inactive',
            active: false,
            archived: false
        }))).toEqual({
            type: 'resume',
            sessionId: 'session-inactive'
        })
    })

    it('keeps archived sessions as navigation-only', () => {
        expect(resolveSessionSelectionAction(makeSession({
            id: 'session-archived',
            active: false,
            archived: true
        }))).toEqual({
            type: 'navigate',
            sessionId: 'session-archived'
        })
    })

    it('opens unattached codex history entries by codex session id', () => {
        expect(resolveSessionSelectionAction(makeCodexSession({
            id: 'codex:thread-1',
            codexSessionId: 'thread-1',
            codexOrigin: 'app-server-thread',
            openStrategy: 'open-app-server-thread',
            metadata: {
                path: '/tmp/project',
                name: 'History thread',
                flavor: 'codex'
            }
        }))).toEqual({
            type: 'open-codex-history',
            cwd: '/tmp/project',
            codexSessionId: 'thread-1',
            title: 'History thread',
            openStrategy: 'open-app-server-thread'
        })
    })

    it('resumes attached inactive codex history entries via their attached session id', () => {
        expect(resolveSessionSelectionAction(makeCodexSession({
            id: 'session-attached',
            attachedSessionId: 'session-attached',
            codexSessionId: 'thread-2',
            active: false,
            archived: false
        }))).toEqual({
            type: 'resume',
            sessionId: 'session-attached'
        })
    })
})
