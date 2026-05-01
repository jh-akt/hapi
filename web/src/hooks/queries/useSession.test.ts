import { describe, expect, it } from 'vitest'
import { isSessionMissingErrorMessage } from './useSession'

describe('isSessionMissingErrorMessage', () => {
    it('treats missing and denied session errors as closed links', () => {
        expect(isSessionMissingErrorMessage('HTTP 404: Session not found')).toBe(true)
        expect(isSessionMissingErrorMessage('HTTP 403: Session access denied')).toBe(true)
        expect(isSessionMissingErrorMessage('Network failed')).toBe(false)
    })
})
