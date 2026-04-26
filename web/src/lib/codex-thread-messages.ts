import { AGENT_MESSAGE_PAYLOAD_TYPE, isObject } from '@hapi/protocol'
import type { CodexThread, CodexTurn, DecryptedMessage } from '@/types/api'

type MessageRole = 'user' | 'agent'

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toMillis(value: unknown, fallback: number): number {
    const number = asNumber(value)
    if (number === null || number <= 0) {
        return fallback
    }
    return number < 1_000_000_000_000 ? number * 1000 : number
}

function makeRoleMessage(options: {
    id: string
    seq: number
    createdAt: number
    role: MessageRole
    content: unknown
}): DecryptedMessage {
    return {
        id: options.id,
        seq: options.seq,
        localId: null,
        createdAt: options.createdAt,
        content: {
            role: options.role,
            content: options.content,
            meta: {
                sentFrom: 'codex-app-server',
                source: 'codex-app-server-thread'
            }
        }
    }
}

function makeCodexAgentMessage(options: {
    id: string
    seq: number
    createdAt: number
    data: unknown
}): DecryptedMessage {
    return makeRoleMessage({
        id: options.id,
        seq: options.seq,
        createdAt: options.createdAt,
        role: 'agent',
        content: {
            type: AGENT_MESSAGE_PAYLOAD_TYPE,
            data: options.data
        }
    })
}

function stringifyJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function textFromUserInput(input: unknown): string {
    if (!isObject(input)) {
        return stringifyJson(input)
    }
    if (input.type === 'text') {
        return asString(input.text) ?? ''
    }
    if (input.type === 'image') {
        return `[image: ${asString(input.url) ?? ''}]`
    }
    if (input.type === 'localImage') {
        return `[image: ${asString(input.path) ?? ''}]`
    }
    if (input.type === 'skill') {
        return `$${asString(input.name) ?? asString(input.path) ?? 'skill'}`
    }
    if (input.type === 'mention') {
        return `@${asString(input.name) ?? asString(input.path) ?? 'mention'}`
    }
    return stringifyJson(input)
}

function userMessageText(item: Record<string, unknown>): string {
    const content = Array.isArray(item.content) ? item.content : []
    const text = content.map(textFromUserInput).filter((part) => part.trim().length > 0).join('\n\n')
    return text || stringifyJson(item.content ?? item)
}

function commandResult(item: Record<string, unknown>): unknown {
    return {
        status: item.status,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
        output: item.aggregatedOutput
    }
}

function fileChangeSummary(item: Record<string, unknown>): unknown {
    return {
        status: item.status,
        changes: item.changes
    }
}

function toolCallName(item: Record<string, unknown>): string {
    if (item.type === 'commandExecution') return 'shell'
    if (item.type === 'fileChange') return 'apply_patch'
    if (item.type === 'mcpToolCall') return `${asString(item.server) ?? 'mcp'}.${asString(item.tool) ?? 'tool'}`
    if (item.type === 'dynamicToolCall') return asString(item.tool) ?? 'tool'
    if (item.type === 'webSearch') return 'web_search'
    return asString(item.type) ?? 'tool'
}

function addToolMessages(options: {
    messages: DecryptedMessage[]
    threadId: string
    turnId: string
    itemId: string
    seq: () => number
    createdAt: number
    item: Record<string, unknown>
    input: unknown
    output: unknown
    isError?: boolean
}): void {
    const callId = options.itemId
    options.messages.push(makeCodexAgentMessage({
        id: `codex:${options.threadId}:${options.turnId}:${options.itemId}:call`,
        seq: options.seq(),
        createdAt: options.createdAt,
        data: {
            type: 'tool-call',
            id: callId,
            callId,
            name: toolCallName(options.item),
            input: options.input
        }
    }))
    options.messages.push(makeCodexAgentMessage({
        id: `codex:${options.threadId}:${options.turnId}:${options.itemId}:result`,
        seq: options.seq(),
        createdAt: options.createdAt + 1,
        data: {
            type: 'tool-call-result',
            callId,
            output: options.output,
            is_error: Boolean(options.isError)
        }
    }))
}

function appendThreadItemMessages(options: {
    messages: DecryptedMessage[]
    threadId: string
    turnId: string
    turnCreatedAt: number
    item: unknown
    itemIndex: number
    seq: () => number
}): void {
    if (!isObject(options.item)) {
        return
    }

    const item = options.item as Record<string, unknown>
    const itemType = asString(item.type)
    const itemId = asString(item.id) ?? String(options.itemIndex)
    const idBase = `codex:${options.threadId}:${options.turnId}:${itemId}`
    const createdAt = options.turnCreatedAt + options.itemIndex

    if (itemType === 'userMessage') {
        options.messages.push(makeRoleMessage({
            id: idBase,
            seq: options.seq(),
            createdAt,
            role: 'user',
            content: {
                type: 'text',
                text: userMessageText(item)
            }
        }))
        return
    }

    if (itemType === 'agentMessage') {
        const text = asString(item.text)
        if (text) {
            options.messages.push(makeCodexAgentMessage({
                id: idBase,
                seq: options.seq(),
                createdAt,
                data: { type: 'message', message: text }
            }))
        }
        return
    }

    if (itemType === 'reasoning') {
        const summary = Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === 'string') : []
        const content = Array.isArray(item.content) ? item.content.filter((part): part is string => typeof part === 'string') : []
        const message = [...summary, ...content].join('\n\n').trim()
        if (message) {
            options.messages.push(makeCodexAgentMessage({
                id: idBase,
                seq: options.seq(),
                createdAt,
                data: { type: 'reasoning', message }
            }))
        }
        return
    }

    if (itemType === 'plan') {
        const text = asString(item.text)
        if (text) {
            options.messages.push(makeCodexAgentMessage({
                id: idBase,
                seq: options.seq(),
                createdAt,
                data: { type: 'message', message: text }
            }))
        }
        return
    }

    if (itemType === 'commandExecution') {
        addToolMessages({
            messages: options.messages,
            threadId: options.threadId,
            turnId: options.turnId,
            itemId,
            seq: options.seq,
            createdAt,
            item,
            input: {
                command: item.command,
                cwd: item.cwd,
                status: item.status,
                commandActions: item.commandActions
            },
            output: commandResult(item),
            isError: item.status === 'failed'
        })
        return
    }

    if (itemType === 'fileChange') {
        addToolMessages({
            messages: options.messages,
            threadId: options.threadId,
            turnId: options.turnId,
            itemId,
            seq: options.seq,
            createdAt,
            item,
            input: item.changes,
            output: fileChangeSummary(item),
            isError: item.status === 'failed'
        })
        return
    }

    if (itemType === 'mcpToolCall' || itemType === 'dynamicToolCall' || itemType === 'webSearch') {
        addToolMessages({
            messages: options.messages,
            threadId: options.threadId,
            turnId: options.turnId,
            itemId,
            seq: options.seq,
            createdAt,
            item,
            input: item.arguments ?? item.query ?? item,
            output: item.result ?? item.error ?? item.contentItems ?? item.action,
            isError: Boolean(item.error)
        })
        return
    }

    if (itemType === 'enteredReviewMode' || itemType === 'exitedReviewMode') {
        options.messages.push(makeRoleMessage({
            id: idBase,
            seq: options.seq(),
            createdAt,
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: itemType === 'enteredReviewMode' ? 'review_started' : 'review_completed',
                    review: asString(item.review) ?? undefined
                }
            }
        }))
        return
    }

    if (itemType === 'contextCompaction') {
        options.messages.push(makeRoleMessage({
            id: idBase,
            seq: options.seq(),
            createdAt,
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'compact',
                    trigger: 'manual',
                    preTokens: 0
                }
            }
        }))
    }
}

function getTurnItems(turn: CodexTurn): unknown[] {
    return Array.isArray(turn.items) ? turn.items : []
}

export function codexThreadToMessages(thread: CodexThread): DecryptedMessage[] {
    const threadId = asString(thread.id) ?? 'unknown-thread'
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    let seq = 1
    const nextSeq = () => seq++
    const fallbackCreatedAt = toMillis(thread.createdAt, Date.now())
    const messages: DecryptedMessage[] = []

    turns.forEach((turn, turnIndex) => {
        const turnId = asString(turn.id) ?? String(turnIndex)
        const turnCreatedAt = toMillis(turn.startedAt, fallbackCreatedAt + turnIndex * 100)
        getTurnItems(turn).forEach((item, itemIndex) => {
            appendThreadItemMessages({
                messages,
                threadId,
                turnId,
                turnCreatedAt,
                item,
                itemIndex,
                seq: nextSeq
            })
        })

        if (turn.error) {
            messages.push(makeRoleMessage({
                id: `codex:${threadId}:${turnId}:error`,
                seq: nextSeq(),
                createdAt: toMillis(turn.completedAt, turnCreatedAt + 99),
                role: 'agent',
                content: {
                    type: 'event',
                    data: {
                        type: 'api-error',
                        retryAttempt: 0,
                        maxRetries: 0,
                        error: turn.error
                    }
                }
            }))
        }
    })

    return messages
}
