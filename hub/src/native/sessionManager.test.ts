import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@hapi/protocol/types'
import {
    NativeSessionManager,
    buildCodexResumeCommand,
    extractCodexSessionIdFromFilePath,
    extractCodexSessionIdFromShellSnapshotName,
    inferNativeCommandFromSnapshot,
    inferNativeCommandFromProcessCommand,
    isShellLikeCommand,
    parseTmuxPaneLine,
    resolveCodexSessionIdFromStateSqlite,
    selectCodexSessionIdFromStateThreads,
    selectCodexSessionIdFromRecentShellSnapshots
} from './sessionManager'

describe('parseTmuxPaneLine', () => {
    it('parses the explicit tmux separator used by the launchd hub', () => {
        expect(parseTmuxPaneLine('hapi-demo::hapi-tmux::%1::hapi-tmux::/Users/demo/project::hapi-tmux::zsh')).toEqual({
            tmuxSession: 'hapi-demo',
            tmuxPane: '%1',
            cwd: '/Users/demo/project',
            command: 'zsh'
        })
    })

    it('parses shell-backed tmux panes used by native create', () => {
        expect(parseTmuxPaneLine('hapi-demo\t%1\t/Users/demo/project\tzsh')).toEqual({
            tmuxSession: 'hapi-demo',
            tmuxPane: '%1',
            cwd: '/Users/demo/project',
            command: 'zsh'
        })
    })

    it('returns null for malformed tmux lines', () => {
        expect(parseTmuxPaneLine('hapi-demo\t%1\t/Users/demo/project')).toBeNull()
    })
})

describe('inferNativeCommandFromProcessCommand', () => {
    it('detects npm codex wrappers launched through node', () => {
        expect(inferNativeCommandFromProcessCommand('node /opt/homebrew/bin/codex')).toBe('codex')
        expect(inferNativeCommandFromProcessCommand('node /Users/demo/.npm-global/bin/codex')).toBe('codex')
        expect(inferNativeCommandFromProcessCommand('node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js')).toBe('codex')
    })

    it('ignores unrelated node processes', () => {
        expect(inferNativeCommandFromProcessCommand('node /Users/demo/project/server.js')).toBeNull()
    })
})

describe('inferNativeCommandFromSnapshot', () => {
    it('detects the Codex TUI banner from captured tmux output', () => {
        expect(
            inferNativeCommandFromSnapshot(`
╭───────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.122.0)                    │
│ model:       gpt-5.4 xhigh   /model to change │
╰───────────────────────────────────────────────╯
`)
        ).toBe('codex')
    })

    it('returns null for unrelated terminal output', () => {
        expect(inferNativeCommandFromSnapshot('haojiang@Mac hapi % ls')).toBeNull()
    })
})

function createNativeCodexSession(codexSessionId?: string): Session {
    const now = Date.now()

    return {
        id: 'session-1',
        namespace: 'default',
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: '/tmp/project',
            host: 'localhost',
            flavor: 'codex',
            source: 'native-attached',
            codexSessionId,
            native: {
                tmuxSession: 'work-a',
                tmuxPane: '%1',
                command: 'codex',
                attachedAt: now,
                attached: true
            }
        },
        metadataVersion: 1,
        agentState: {
            controlledByUser: true,
            requests: {},
            completedRequests: {}
        },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: now,
        model: null,
        modelReasoningEffort: null,
        effort: null
    }
}

function createManagerWithSessionReader(getSession: (sessionId: string) => Session | undefined): NativeSessionManager {
    return new NativeSessionManager({
        getSessions: () => [],
        getSessionsByNamespace: () => [],
        getSession,
        getSessionByNamespace: () => undefined,
        reloadState: () => {},
        getOrCreateSession: () => {
            throw new Error('not used in test')
        },
        updateSessionMetadata: () => {
            throw new Error('not used in test')
        },
        updateSessionAgentState: () => {
            throw new Error('not used in test')
        },
        appendMessage: () => {
            throw new Error('not used in test')
        },
        getMessageCount: () => 0,
        handleSessionAlive: () => {},
        handleSessionEnd: () => {}
    })
}

describe('native resume helpers', () => {
    it('extracts Codex session IDs from session file paths', () => {
        expect(
            extractCodexSessionIdFromFilePath('/Users/demo/.codex/sessions/2026/04/23/rollout-2026-04-23T04-05-42-019db6cc-6755-76f0-bd5d-074e3428b87f.jsonl')
        ).toBe('019db6cc-6755-76f0-bd5d-074e3428b87f')
    })

    it('extracts Codex session IDs from shell snapshot names', () => {
        const result = extractCodexSessionIdFromShellSnapshotName(
            '019db6e5-13fd-78b2-a605-918b09a26c91.1776889959438981000.sh'
        )

        expect(result?.sessionId).toBe('019db6e5-13fd-78b2-a605-918b09a26c91')
        expect(result?.createdAtMs).toBeCloseTo(1776889959438.981, 3)
    })

    it('keeps a shell snapshot match when the recent window only contains one session', () => {
        expect(selectCodexSessionIdFromRecentShellSnapshots([
            {
                sessionId: '019db6e5-13fd-78b2-a605-918b09a26c91',
                createdAtMs: 1776889959438.981
            },
            {
                sessionId: '019db6e5-13fd-78b2-a605-918b09a26c91',
                createdAtMs: 1776889960438.981
            }
        ], 1776889959000)).toBe('019db6e5-13fd-78b2-a605-918b09a26c91')
    })

    it('refuses ambiguous shell snapshot matches across multiple sessions', () => {
        expect(selectCodexSessionIdFromRecentShellSnapshots([
            {
                sessionId: '019db6e5-13fd-78b2-a605-918b09a26c91',
                createdAtMs: 1776889959438.981
            },
            {
                sessionId: '019db6e6-13fd-78b2-a605-918b09a26c92',
                createdAtMs: 1776889960438.981
            }
        ], 1776889959000)).toBeNull()
    })

    it('builds a resumable codex command from the stored session ID', () => {
        expect(buildCodexResumeCommand('019db6cc-6755-76f0-bd5d-074e3428b87f')).toBe(
            'codex resume 019db6cc-6755-76f0-bd5d-074e3428b87f'
        )
    })

    it('recognizes shell panes that are safe to reuse after codex exits', () => {
        expect(isShellLikeCommand('zsh')).toBe(true)
        expect(isShellLikeCommand('/bin/bash')).toBe(true)
        expect(isShellLikeCommand('node')).toBe(false)
    })
})

describe('codex state sqlite discovery', () => {
    it('prefers the closest CLI thread in the same cwd', () => {
        const attachedAtMs = 1_000_000

        expect(selectCodexSessionIdFromStateThreads([
            {
                sessionId: 'old-cli-thread',
                cwd: '/tmp/project',
                source: 'cli',
                createdAtMs: attachedAtMs - 20_000,
                updatedAtMs: attachedAtMs - 10_000
            },
            {
                sessionId: 'native-thread',
                cwd: '/tmp/project',
                source: 'cli',
                createdAtMs: attachedAtMs + 200,
                updatedAtMs: attachedAtMs + 300
            },
            {
                sessionId: 'vscode-thread',
                cwd: '/tmp/project',
                source: 'vscode',
                createdAtMs: attachedAtMs + 100,
                updatedAtMs: attachedAtMs + 200
            }
        ], {
            cwd: '/tmp/project',
            attachedAtMs
        })).toBe('native-thread')
    })

    it('refuses ambiguous near-simultaneous CLI thread matches', () => {
        const attachedAtMs = 1_000_000

        expect(selectCodexSessionIdFromStateThreads([
            {
                sessionId: 'thread-a',
                cwd: '/tmp/project',
                source: 'cli',
                createdAtMs: attachedAtMs + 100,
                updatedAtMs: attachedAtMs + 200
            },
            {
                sessionId: 'thread-b',
                cwd: '/tmp/project',
                source: 'cli',
                createdAtMs: attachedAtMs + 500,
                updatedAtMs: attachedAtMs + 600
            }
        ], {
            cwd: '/tmp/project',
            attachedAtMs
        })).toBeNull()
    })

    it('reads the native codex session id from Codex state sqlite', () => {
        const codexHomeDir = mkdtempSync(join(tmpdir(), 'hapi-native-codex-state-'))
        const attachedAtMs = Date.now()
        const stateDbPath = join(codexHomeDir, 'state_5.sqlite')

        mkdirSync(codexHomeDir, { recursive: true })

        const db = new Database(stateDbPath, { create: true, readwrite: true, strict: true })
        try {
            db.exec(`
                CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    rollout_path TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    model_provider TEXT NOT NULL,
                    cwd TEXT NOT NULL,
                    title TEXT NOT NULL,
                    sandbox_policy TEXT NOT NULL,
                    approval_mode TEXT NOT NULL,
                    tokens_used INTEGER NOT NULL DEFAULT 0,
                    has_user_event INTEGER NOT NULL DEFAULT 0,
                    archived INTEGER NOT NULL DEFAULT 0,
                    archived_at INTEGER,
                    git_sha TEXT,
                    git_branch TEXT,
                    git_origin_url TEXT,
                    cli_version TEXT NOT NULL DEFAULT '',
                    first_user_message TEXT NOT NULL DEFAULT '',
                    agent_nickname TEXT,
                    agent_role TEXT,
                    memory_mode TEXT NOT NULL DEFAULT 'enabled',
                    model TEXT,
                    reasoning_effort TEXT,
                    agent_path TEXT,
                    created_at_ms INTEGER,
                    updated_at_ms INTEGER
                );
            `)

            db.prepare(`
                INSERT INTO threads (
                    id, rollout_path, created_at, updated_at, source, model_provider, cwd,
                    title, sandbox_policy, approval_mode, created_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                'old-thread',
                '/tmp/old',
                Math.floor((attachedAtMs - 20_000) / 1000),
                Math.floor((attachedAtMs - 10_000) / 1000),
                'cli',
                'openai',
                '/tmp/project',
                'old',
                'workspace-write',
                'default',
                attachedAtMs - 20_000,
                attachedAtMs - 10_000
            )

            db.prepare(`
                INSERT INTO threads (
                    id, rollout_path, created_at, updated_at, source, model_provider, cwd,
                    title, sandbox_policy, approval_mode, created_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                'native-thread',
                '/tmp/native',
                Math.floor((attachedAtMs + 200) / 1000),
                Math.floor((attachedAtMs + 400) / 1000),
                'cli',
                'openai',
                '/tmp/project',
                'native',
                'workspace-write',
                'default',
                attachedAtMs + 200,
                attachedAtMs + 400
            )
        } finally {
            db.close()
        }

        try {
            expect(resolveCodexSessionIdFromStateSqlite({
                cwd: '/tmp/project',
                attachedAtMs,
                codexHomeDir
            })).toBe('native-thread')
        } finally {
            rmSync(codexHomeDir, { recursive: true, force: true })
        }
    })
})

describe('waitForPersistedCodexSessionId', () => {
    it('returns once the native codex session ID appears in persisted metadata', async () => {
        const withoutSessionId = createNativeCodexSession()
        const withSessionId = createNativeCodexSession('thread-123')
        let readCount = 0
        const manager = createManagerWithSessionReader(() => {
            readCount += 1
            return readCount >= 3 ? withSessionId : withoutSessionId
        })

        try {
            const result = await (manager as unknown as {
                waitForPersistedCodexSessionId: (sessionId: string, timeoutMs: number, pollIntervalMs?: number) => Promise<Session>
            }).waitForPersistedCodexSessionId('session-1', 50, 1)

            expect(result.metadata?.codexSessionId).toBe('thread-123')
        } finally {
            manager.stop()
        }
    })

    it('returns the latest session snapshot when the persist wait times out', async () => {
        const session = createNativeCodexSession()
        const manager = createManagerWithSessionReader(() => session)

        try {
            const result = await (manager as unknown as {
                waitForPersistedCodexSessionId: (sessionId: string, timeoutMs: number, pollIntervalMs?: number) => Promise<Session>
            }).waitForPersistedCodexSessionId('session-1', 5, 1)

            expect(result.metadata?.codexSessionId).toBeUndefined()
        } finally {
            manager.stop()
        }
    })
})
