import { describe, expect, it } from 'vitest'
import type { CodexTurn } from '@/types/api'
import { buildReviewRows } from './CodexWorkspacePanel'

describe('CodexWorkspacePanel row builders', () => {
    it('keeps message items out of review rows', () => {
        const turns: CodexTurn[] = [{
            id: 'turn-1',
            items: [
                {
                    type: 'userMessage',
                    id: 'user-1',
                    content: [{ type: 'text', text: 'please review this' }]
                },
                {
                    type: 'agentMessage',
                    id: 'agent-1',
                    text: 'This is message data, not a review event.'
                },
                {
                    type: 'commandExecution',
                    id: 'command-1',
                    command: 'npm test',
                    status: 'completed'
                },
                {
                    type: 'dynamicToolCall',
                    id: 'tool-1',
                    tool: 'shell',
                    status: 'completed'
                },
                {
                    type: 'fileChange',
                    id: 'file-1',
                    changes: [{ path: 'src/app.ts' }],
                    status: 'completed'
                }
            ]
        }]

        expect(buildReviewRows(turns).map((row) => row.id)).toEqual(['file-1'])
    })
})
