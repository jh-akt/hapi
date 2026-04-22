import { describe, expect, it } from 'bun:test'
import {
    buildCodexResumeCommand,
    extractCodexSessionIdFromFilePath,
    extractCodexSessionIdFromShellSnapshotName,
    inferNativeCommandFromProcessCommand,
    isShellLikeCommand,
    parseTmuxPaneLine,
    selectCodexSessionIdFromRecentShellSnapshots
} from './sessionManager'

describe('parseTmuxPaneLine', () => {
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
