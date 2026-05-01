import { describe, expect, it } from 'vitest'
import { getSessionModelLabel, getSessionModelReasoningEffortLabel } from './sessionModelLabel'

describe('getSessionModelLabel', () => {
    it('prefers the explicit session model', () => {
        expect(getSessionModelLabel({ model: 'gpt-5.4' })).toEqual({
            key: 'session.item.model',
            value: 'gpt-5.4'
        })
    })

    it('renders friendly labels for known Claude aliases', () => {
        expect(getSessionModelLabel({ model: 'opus' })).toEqual({
            key: 'session.item.model',
            value: 'Opus'
        })
    })

    it('returns null when no model is available', () => {
        expect(getSessionModelLabel({})).toBeNull()
    })
})

describe('getSessionModelReasoningEffortLabel', () => {
    it('renders friendly labels for Codex reasoning effort', () => {
        expect(getSessionModelReasoningEffortLabel({ modelReasoningEffort: 'xhigh' })).toEqual({
            key: 'misc.reasoningEffort',
            value: 'XHigh'
        })
    })

    it('returns null when reasoning effort is not explicitly set', () => {
        expect(getSessionModelReasoningEffortLabel({ modelReasoningEffort: null })).toBeNull()
        expect(getSessionModelReasoningEffortLabel({ modelReasoningEffort: 'default' })).toBeNull()
    })
})
