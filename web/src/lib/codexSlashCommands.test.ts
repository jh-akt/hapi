import { describe, expect, it } from 'vitest'
import {
    findUnsupportedCodexBuiltinSlashCommand,
    getBuiltinSlashCommands,
    parseCodexReviewSlashCommand
} from './codexSlashCommands'

describe('getBuiltinSlashCommands', () => {
    it('exposes supported codex built-ins in remote web mode', () => {
        expect(getBuiltinSlashCommands('codex')).toEqual([
            { name: 'review', description: 'Run Codex automated review on current changes', source: 'builtin' }
        ])
    })
})

describe('findUnsupportedCodexBuiltinSlashCommand', () => {
    it('detects unsupported codex built-ins', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('/status', [])).toBe('status')
        expect(findUnsupportedCodexBuiltinSlashCommand('  /diff ', [])).toBe('diff')
    })

    it('ignores regular messages and unknown commands', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('show me status', [])).toBeNull()
        expect(findUnsupportedCodexBuiltinSlashCommand('/custom-status', [])).toBeNull()
    })

    it('does not block custom commands that override the same name', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('/status', [
            { name: 'status', source: 'project', content: 'project status prompt' }
        ])).toBeNull()
    })

    it('does not treat /review as unsupported', () => {
        expect(findUnsupportedCodexBuiltinSlashCommand('/review', [])).toBeNull()
    })
})

describe('parseCodexReviewSlashCommand', () => {
    it('parses bare /review into uncommittedChanges target', () => {
        expect(parseCodexReviewSlashCommand('/review')).toEqual({
            target: { type: 'uncommittedChanges' }
        })
    })

    it('parses /review with instructions into a custom target', () => {
        expect(parseCodexReviewSlashCommand('/review focus on test regressions')).toEqual({
            target: {
                type: 'custom',
                instructions: 'focus on test regressions'
            }
        })
    })
})
