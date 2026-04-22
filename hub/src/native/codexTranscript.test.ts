import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    createNativeCodexTranscriptState,
    syncNativeCodexTranscript
} from './codexTranscript'

const tempDirs: string[] = []

function makeTempCodexHome(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-native-codex-'))
    tempDirs.push(dir)
    return dir
}

function writeTranscriptFile(options: {
    codexHomeDir: string
    fileName: string
    sessionId: string
    cwd: string
    timestamp: string
    userMessages?: string[]
    agentMessages?: string[]
    includeToolCall?: boolean
    mtimeMs?: number
}): void {
    const sessionsDir = join(options.codexHomeDir, 'sessions', '2026', '04', '23')
    mkdirSync(sessionsDir, { recursive: true })

    const filePath = join(sessionsDir, options.fileName)
    const lines = [
        JSON.stringify({
            type: 'session_meta',
            payload: {
                id: options.sessionId,
                timestamp: options.timestamp,
                cwd: options.cwd,
                source: 'cli',
                originator: 'codex-tui'
            }
        }),
        ...(options.userMessages ?? []).map((message) => JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'user_message',
                message
            }
        })),
        ...(options.agentMessages ?? []).map((message) => JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'agent_message',
                message
            }
        })),
        ...(options.includeToolCall ? [
            JSON.stringify({
                type: 'response_item',
                payload: {
                    type: 'function_call',
                    name: 'exec_command',
                    call_id: 'call-1',
                    arguments: '{"cmd":"pwd"}'
                }
            }),
            JSON.stringify({
                type: 'response_item',
                payload: {
                    type: 'function_call_output',
                    call_id: 'call-1',
                    output: '/Users/demo/project'
                }
            })
        ] : [])
    ]

    writeFileSync(filePath, `${lines.join('\n')}\n`)

    if (options.mtimeMs) {
        const time = new Date(options.mtimeMs)
        utimesSync(filePath, time, time)
    }
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('syncNativeCodexTranscript', () => {
    it('imports structured user, assistant, and tool messages from a Codex transcript', () => {
        const codexHomeDir = makeTempCodexHome()
        const sessionId = '019db6cc-6755-76f0-bd5d-074e3428b87f'

        writeTranscriptFile({
            codexHomeDir,
            fileName: `rollout-2026-04-23T04-05-42-${sessionId}.jsonl`,
            sessionId,
            cwd: '/Users/demo/project',
            timestamp: '2026-04-22T20:05:42.380Z',
            userMessages: ['run pwd'],
            agentMessages: ['Checking current working directory with `pwd`.'],
            includeToolCall: true,
            mtimeMs: Date.now()
        })

        const state = createNativeCodexTranscriptState()
        const result = syncNativeCodexTranscript(state, {
            cwd: '/Users/demo/project',
            snapshotText: '› run pwd',
            codexHomeDir
        })

        expect(result.active).toBe(true)
        expect(result.codexSessionId).toBe(sessionId)
        expect(result.messages).toHaveLength(4)
        expect(result.messages[0]).toMatchObject({
            role: 'user',
            text: 'run pwd'
        })
        expect(result.messages[1]).toMatchObject({
            role: 'agent',
            body: {
                type: 'message',
                message: 'Checking current working directory with `pwd`.'
            }
        })
        expect(result.messages[2]).toMatchObject({
            role: 'agent',
            body: {
                type: 'tool-call',
                name: 'exec_command',
                callId: 'call-1',
                input: {
                    cmd: 'pwd'
                }
            }
        })
        expect(result.messages[3]).toMatchObject({
            role: 'agent',
            body: {
                type: 'tool-call-result',
                callId: 'call-1',
                output: '/Users/demo/project'
            }
        })

        const next = syncNativeCodexTranscript(state, {
            cwd: '/Users/demo/project',
            snapshotText: '› run pwd',
            codexHomeDir
        })

        expect(next.messages).toHaveLength(0)
    })

    it('prefers a transcript whose recent prompt matches the current tmux snapshot over a stale hinted session id', () => {
        const codexHomeDir = makeTempCodexHome()
        const staleSessionId = '019db6d8-42a5-7980-8e77-9dc3571afcb2'
        const liveSessionId = '019db70a-11cf-7e60-9200-dd6eddc8573f'
        const now = Date.now()

        writeTranscriptFile({
            codexHomeDir,
            fileName: `rollout-2026-04-23T04-11-00-${staleSessionId}.jsonl`,
            sessionId: staleSessionId,
            cwd: '/Users/demo/project',
            timestamp: '2026-04-22T20:11:00.000Z',
            userMessages: ['run pwd'],
            agentMessages: ['`/Users/demo/project`'],
            mtimeMs: now - (2 * 60 * 60 * 1000)
        })

        writeTranscriptFile({
            codexHomeDir,
            fileName: `rollout-2026-04-23T05-16-40-${liveSessionId}.jsonl`,
            sessionId: liveSessionId,
            cwd: '/Users/demo/project',
            timestamp: '2026-04-22T21:16:40.000Z',
            userMessages: ['mac deamon configured?'],
            agentMessages: ['Checking the daemon status now.'],
            mtimeMs: now
        })

        const state = createNativeCodexTranscriptState(staleSessionId)
        const result = syncNativeCodexTranscript(state, {
            cwd: '/Users/demo/project',
            hintedSessionId: staleSessionId,
            snapshotText: '› mac deamon configured?',
            codexHomeDir
        })

        expect(result.codexSessionId).toBe(liveSessionId)
        expect(result.messages[0]).toMatchObject({
            role: 'user',
            text: 'mac deamon configured?'
        })
    })
})
