import { describe, expect, it } from 'vitest'
import { AGENT_MESSAGE_PAYLOAD_TYPE } from '@hapi/protocol'
import type { CodexThread } from '@/types/api'
import { codexThreadToMessages } from './codex-thread-messages'

describe('codexThreadToMessages', () => {
    it('converts thread/read turns into stable chat messages', () => {
        const thread: CodexThread = {
            id: 'thread-1',
            createdAt: 1_777_000_000_000,
            turns: [
                {
                    id: 'turn-1',
                    startedAt: 1_777_000_000_100,
                    items: [
                        {
                            id: 'item-user',
                            type: 'userMessage',
                            content: [{ type: 'text', text: 'hello codex' }]
                        },
                        {
                            id: 'item-agent',
                            type: 'agentMessage',
                            text: 'hello human'
                        },
                        {
                            id: 'item-reasoning',
                            type: 'reasoning',
                            summary: ['checking context']
                        },
                        {
                            id: 'item-command',
                            type: 'commandExecution',
                            command: 'bun test',
                            cwd: '/tmp/project',
                            status: 'completed',
                            exitCode: 0,
                            aggregatedOutput: 'ok'
                        }
                    ]
                }
            ]
        }

        const messages = codexThreadToMessages(thread)

        expect(messages.map((message) => message.id)).toEqual([
            'codex:thread-1:turn-1:item-user',
            'codex:thread-1:turn-1:item-agent',
            'codex:thread-1:turn-1:item-reasoning',
            'codex:thread-1:turn-1:item-command:call',
            'codex:thread-1:turn-1:item-command:result'
        ])
        expect(messages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5])
        expect(messages[0]?.content).toMatchObject({
            role: 'user',
            content: {
                type: 'text',
                text: 'hello codex'
            }
        })
        expect(messages[1]?.content).toMatchObject({
            role: 'agent',
            content: {
                type: AGENT_MESSAGE_PAYLOAD_TYPE,
                data: {
                    type: 'message',
                    message: 'hello human'
                }
            }
        })
        expect(messages[2]?.content).toMatchObject({
            content: {
                data: {
                    type: 'reasoning',
                    message: 'checking context'
                }
            }
        })
        expect(messages[3]?.content).toMatchObject({
            content: {
                data: {
                    type: 'tool-call',
                    name: 'shell',
                    input: {
                        command: 'bun test',
                        cwd: '/tmp/project'
                    }
                }
            }
        })
        expect(messages[4]?.content).toMatchObject({
            content: {
                data: {
                    type: 'tool-call-result',
                    output: {
                        status: 'completed',
                        exitCode: 0,
                        output: 'ok'
                    },
                    is_error: false
                }
            }
        })
    })
})
