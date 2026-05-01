import { describe, expect, it } from 'vitest'
import { getCodexModelOptionsFromModels, getModelOptionsForFlavor, getNextModelForFlavor } from './modelOptions'

describe('getModelOptionsForFlavor', () => {
    it('returns Gemini model options for gemini flavor', () => {
        const options = getModelOptionsForFlavor('gemini')
        expect(options[0]).toEqual({ value: null, label: 'Default' })
        expect(options.some((o) => o.value === 'gemini-3-flash-preview')).toBe(true)
        expect(options.some((o) => o.value === 'gemini-2.5-flash')).toBe(true)
    })

    it('returns Claude model options for claude flavor', () => {
        const options = getModelOptionsForFlavor('claude')
        expect(options[0]).toEqual({ value: null, label: 'Auto' })
        expect(options.some((o) => o.value === 'sonnet')).toBe(true)
        expect(options.some((o) => o.value === 'opus')).toBe(true)
    })

    it('returns Codex model options for codex flavor', () => {
        const options = getModelOptionsForFlavor('codex')
        expect(options[0]).toEqual({ value: null, label: 'Auto' })
        expect(options.some((o) => o.value === 'gpt-5.4')).toBe(true)
        expect(options.some((o) => o.value === 'gpt-5.3-codex')).toBe(true)
    })

    it('includes custom Gemini model from env/config in options', () => {
        const options = getModelOptionsForFlavor('gemini', 'gemini-custom-experiment')
        expect(options.some((o) => o.value === 'gemini-custom-experiment')).toBe(true)
    })

    it('does not duplicate a preset Gemini model', () => {
        const options = getModelOptionsForFlavor('gemini', 'gemini-2.5-flash')
        const flashCount = options.filter((o) => o.value === 'gemini-2.5-flash').length
        expect(flashCount).toBe(1)
    })

    it('builds Codex options from app-server model/list data', () => {
        const options = getCodexModelOptionsFromModels([
            { id: 'gpt-dynamic', model: 'gpt-dynamic', displayName: 'GPT Dynamic' },
            { id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'gpt-5.4' }
        ])
        expect(options).toEqual([
            { value: null, label: 'Auto' },
            { value: 'gpt-dynamic', label: 'GPT Dynamic' },
            { value: 'gpt-5.4', label: 'gpt-5.4' }
        ])
    })

    it('returns no model options for unsupported flavors', () => {
        expect(getModelOptionsForFlavor('cursor')).toEqual([])
        expect(getModelOptionsForFlavor(null)).toEqual([])
    })
})

describe('getNextModelForFlavor', () => {
    it('cycles Gemini models', () => {
        const next = getNextModelForFlavor('gemini', null)
        expect(next).not.toBeNull()
    })

    it('cycles Claude models', () => {
        const next = getNextModelForFlavor('claude', null)
        expect(next).not.toBeNull()
    })

    it('cycles Codex models', () => {
        expect(getNextModelForFlavor('codex', null)).toBe('gpt-5.4')
        expect(getNextModelForFlavor('codex', 'gpt-5.4')).toBe('gpt-5.4-mini')
    })
})
