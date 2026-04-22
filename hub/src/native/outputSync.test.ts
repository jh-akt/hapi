import { describe, expect, it } from 'bun:test'
import { diffCapturedTmuxOutput } from './outputSync'

describe('diffCapturedTmuxOutput', () => {
    it('returns the full snapshot on first capture', () => {
        expect(diffCapturedTmuxOutput('', 'hello\nworld\n')).toBe('hello\nworld\n')
    })

    it('returns only appended output when the next snapshot extends the previous one', () => {
        expect(diffCapturedTmuxOutput('hello\n', 'hello\nworld\n')).toBe('world\n')
    })

    it('handles pane scroll by matching the previous suffix to the next prefix', () => {
        const previous = 'line-1\nline-2\nline-3\n'
        const next = 'line-2\nline-3\nline-4\n'
        expect(diffCapturedTmuxOutput(previous, next)).toBe('line-4\n')
    })

    it('falls back to the latest snapshot when there is no overlap', () => {
        expect(diffCapturedTmuxOutput('before\n', 'after\n')).toBe('after\n')
    })
})
