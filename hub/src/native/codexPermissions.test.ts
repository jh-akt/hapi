import { describe, expect, it } from 'bun:test'
import {
    mapNativeCodexApprovalKey,
    parseNativeCodexCommandPermissionPrompt,
    parseNativeCodexCommandPermissionResult
} from './codexPermissions'

const COMMAND_PROMPT_SNAPSHOT = `
• Running touch native-shell-perm.txt


  Would you like to run the following command?

  $ touch native-shell-perm.txt

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with \`touch native-
     shell-perm.txt\` (p)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`

describe('parseNativeCodexCommandPermissionPrompt', () => {
    it('extracts command approval prompts from a captured tmux snapshot', () => {
        expect(parseNativeCodexCommandPermissionPrompt(COMMAND_PROMPT_SNAPSHOT)).toEqual({
            kind: 'command-approval',
            question: 'Would you like to run the following command?',
            command: 'touch native-shell-perm.txt',
            fingerprint: 'command-approval:touch native-shell-perm.txt',
            options: [
                { index: 1, label: 'Yes, proceed', hotkey: 'y' },
                { index: 2, label: "Yes, and don't ask again for commands that start with `touch native- shell-perm.txt`", hotkey: 'p' },
                { index: 3, label: 'No, and tell Codex what to do differently', hotkey: 'esc' }
            ]
        })
    })

    it('returns null when no command approval prompt is visible', () => {
        expect(parseNativeCodexCommandPermissionPrompt('• Created native-shell-perm.txt')).toBeNull()
    })
})

describe('parseNativeCodexCommandPermissionResult', () => {
    it('recognizes one-time approvals', () => {
        expect(parseNativeCodexCommandPermissionResult('✔ You approved codex to run touch native-shell-perm.txt this time')).toEqual({
            command: 'touch native-shell-perm.txt',
            status: 'approved',
            decision: 'approved'
        })
    })

    it('recognizes session-wide approvals', () => {
        expect(parseNativeCodexCommandPermissionResult('✔ You approved codex to always run commands that start with touch native-shell-perm.txt')).toEqual({
            command: 'touch native-shell-perm.txt',
            status: 'approved',
            decision: 'approved_for_session'
        })
    })

    it('recognizes canceled prompts', () => {
        expect(parseNativeCodexCommandPermissionResult('✗ You canceled the request to run touch native-shell-perm.txt')).toEqual({
            command: 'touch native-shell-perm.txt',
            status: 'denied',
            decision: 'abort'
        })
    })
})

describe('mapNativeCodexApprovalKey', () => {
    it('maps HAPI decisions to Codex TUI hotkeys', () => {
        expect(mapNativeCodexApprovalKey()).toBe('y')
        expect(mapNativeCodexApprovalKey('approved')).toBe('y')
        expect(mapNativeCodexApprovalKey('approved_for_session')).toBe('p')
        expect(mapNativeCodexApprovalKey('denied')).toBe('Escape')
        expect(mapNativeCodexApprovalKey('abort')).toBe('Escape')
    })
})
