import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { EnhancedMode } from './loop';

const harness = vi.hoisted(() => ({
    notifications: [] as Array<{ method: string; params: unknown }>,
    registerRequestCalls: [] as string[],
    initializeCalls: [] as unknown[],
    rpcCalls: [] as Array<{ method: string; params: unknown }>,
    turnBehavior: 'anonymous-complete' as 'anonymous-complete' | 'steerable-pending',
    startTurnCalls: [] as unknown[]
}));

vi.mock('./codexAppServerClient', () => {
    class MockCodexAppServerClient {
        private notificationHandler: ((method: string, params: unknown) => void) | null = null;

        async connect(): Promise<void> {}

        async initialize(params: unknown): Promise<{ protocolVersion: number }> {
            harness.initializeCalls.push(params);
            return { protocolVersion: 1 };
        }

        setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
            this.notificationHandler = handler;
        }

        registerRequestHandler(method: string): void {
            harness.registerRequestCalls.push(method);
        }

        async startThread(): Promise<{ thread: { id: string }; model: string }> {
            return { thread: { id: 'thread-anonymous' }, model: 'gpt-5.4' };
        }

        async resumeThread(): Promise<{ thread: { id: string }; model: string }> {
            return { thread: { id: 'thread-anonymous' }, model: 'gpt-5.4' };
        }

        async startTurn(): Promise<{ turn: { id?: string } }> {
            harness.startTurnCalls.push({});

            if (harness.turnBehavior === 'steerable-pending') {
                const started = { turn: { id: 'turn-live' } };
                harness.notifications.push({ method: 'turn/started', params: started });
                this.notificationHandler?.('turn/started', started);
                return { turn: { id: 'turn-live' } };
            }

            const started = { turn: {} };
            harness.notifications.push({ method: 'turn/started', params: started });
            this.notificationHandler?.('turn/started', started);

            const completed = { status: 'Completed', turn: {} };
            harness.notifications.push({ method: 'turn/completed', params: completed });
            this.notificationHandler?.('turn/completed', completed);

            return { turn: {} };
        }

        async interruptTurn(): Promise<Record<string, never>> {
            return {};
        }

        async listThreads(params: unknown): Promise<{ data: Array<{ id: string }>; nextCursor: null; backwardsCursor: null }> {
            harness.rpcCalls.push({ method: 'thread/list', params });
            return {
                data: [{ id: 'thread-anonymous' }],
                nextCursor: null,
                backwardsCursor: null
            };
        }

        async readThread(params: unknown): Promise<{ thread: { id: string } }> {
            harness.rpcCalls.push({ method: 'thread/read', params });
            return { thread: { id: 'thread-anonymous' } };
        }

        async forkThread(params: unknown): Promise<{ thread: { id: string }; model: string; modelProvider: string; cwd: string }> {
            harness.rpcCalls.push({ method: 'thread/fork', params });
            return {
                thread: { id: 'thread-forked' },
                model: 'gpt-5.4',
                modelProvider: 'openai',
                cwd: '/tmp/hapi-update'
            };
        }

        async archiveThread(params: unknown): Promise<Record<string, never>> {
            harness.rpcCalls.push({ method: 'thread/archive', params });
            return {};
        }

        async unarchiveThread(params: unknown): Promise<{ thread: { id: string } }> {
            harness.rpcCalls.push({ method: 'thread/unarchive', params });
            return { thread: { id: 'thread-anonymous' } };
        }

        async rollbackThread(params: unknown): Promise<{ thread: { id: string } }> {
            harness.rpcCalls.push({ method: 'thread/rollback', params });
            return { thread: { id: 'thread-anonymous' } };
        }

        async steerTurn(params: unknown): Promise<{ turnId: string }> {
            harness.rpcCalls.push({ method: 'turn/steer', params });
            if (harness.turnBehavior === 'steerable-pending') {
                const completed = { status: 'Completed', turn: { id: 'turn-live' } };
                harness.notifications.push({ method: 'turn/completed', params: completed });
                this.notificationHandler?.('turn/completed', completed);
            }
            return { turnId: 'turn-live' };
        }

        async startReview(params: unknown): Promise<{ turn: { id: string }; reviewThreadId: string }> {
            harness.rpcCalls.push({ method: 'review/start', params });
            return {
                turn: { id: 'turn-review' },
                reviewThreadId: 'thread-anonymous'
            };
        }

        async disconnect(): Promise<void> {}
    }

    return { CodexAppServerClient: MockCodexAppServerClient };
});

vi.mock('./utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({
        server: {
            stop: () => {}
        },
        mcpServers: {}
    })
}));

import { codexRemoteLauncher } from './codexRemoteLauncher';

type FakeAgentState = {
    requests: Record<string, unknown>;
    completedRequests: Record<string, unknown>;
};

function createMode(): EnhancedMode {
    return {
        permissionMode: 'default',
        collaborationMode: 'default'
    };
}

function createSessionStub(entries: Array<string | { message: string; mode?: EnhancedMode }> = ['hello from launcher test']) {
    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
    for (const entry of entries) {
        if (typeof entry === 'string') {
            queue.push(entry, createMode());
            continue;
        }
        queue.push(entry.message, entry.mode ?? createMode());
    }
    queue.close();

    const sessionEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const codexMessages: unknown[] = [];
    const thinkingChanges: boolean[] = [];
    const foundSessionIds: string[] = [];
    let currentModel: string | null | undefined;
    let agentState: FakeAgentState = {
        requests: {},
        completedRequests: {}
    };

    const rpcHandlers = new Map<string, (params: unknown) => unknown>();
    const client = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: (params: unknown) => unknown) {
                rpcHandlers.set(method, handler);
            }
        },
        updateAgentState(handler: (state: FakeAgentState) => FakeAgentState) {
            agentState = handler(agentState);
        },
        sendAgentMessage(message: unknown) {
            codexMessages.push(message);
        },
        sendUserMessage(_text: string) {},
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            sessionEvents.push(event);
        }
    };

    const session = {
        path: '/tmp/hapi-update',
        logPath: '/tmp/hapi-update/test.log',
        client,
        queue,
        codexArgs: undefined,
        codexCliOverrides: undefined,
        sessionId: null as string | null,
        thinking: false,
        getPermissionMode() {
            return 'default' as const;
        },
        setModel(nextModel: string | null) {
            currentModel = nextModel;
        },
        getModel() {
            return currentModel;
        },
        onThinkingChange(nextThinking: boolean) {
            session.thinking = nextThinking;
            thinkingChanges.push(nextThinking);
        },
        onSessionFound(id: string) {
            session.sessionId = id;
            foundSessionIds.push(id);
        },
        sendAgentMessage(message: unknown) {
            client.sendAgentMessage(message);
        },
        sendSessionEvent(event: { type: string; [key: string]: unknown }) {
            client.sendSessionEvent(event);
        },
        sendUserMessage(text: string) {
            client.sendUserMessage(text);
        }
    };

    return {
        session,
        sessionEvents,
        codexMessages,
        thinkingChanges,
        foundSessionIds,
        rpcHandlers,
        getModel: () => currentModel,
        getAgentState: () => agentState
    };
}

describe('codexRemoteLauncher', () => {
    afterEach(() => {
        harness.notifications = [];
        harness.registerRequestCalls = [];
        harness.initializeCalls = [];
        harness.rpcCalls = [];
        harness.turnBehavior = 'anonymous-complete';
        harness.startTurnCalls = [];
    });

    it('finishes a turn and emits ready when task lifecycle events omit turn_id', async () => {
        const {
            session,
            sessionEvents,
            thinkingChanges,
            foundSessionIds,
            getModel
        } = createSessionStub();

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(foundSessionIds).toContain('thread-anonymous');
        expect(getModel()).toBe('gpt-5.4');
        expect(harness.initializeCalls).toEqual([{
            clientInfo: {
                name: 'hapi-codex-client',
                title: 'HAPI Codex Client',
                version: '1.0.0'
            },
            capabilities: {
                experimentalApi: true
            }
        }]);
        expect(harness.notifications.map((entry) => entry.method)).toEqual(['turn/started', 'turn/completed']);
        expect(sessionEvents.filter((event) => event.type === 'ready').length).toBeGreaterThanOrEqual(1);
        expect(thinkingChanges).toContain(true);
        expect(session.thinking).toBe(false);
    });

    it('registers session-scoped codex app-server RPC and defaults to the active thread id', async () => {
        const {
            session,
            rpcHandlers
        } = createSessionStub();

        await codexRemoteLauncher(session as never);

        const handler = rpcHandlers.get('codex-app-server');
        expect(handler).toBeTypeOf('function');
        if (!handler) {
            throw new Error('codex-app-server handler not registered');
        }

        await expect(handler({
            method: 'thread/read',
            params: { includeTurns: true }
        })).resolves.toEqual({
            thread: { id: 'thread-anonymous' }
        });

        await expect(handler({
            method: 'turn/steer',
            params: {
                expectedTurnId: 'turn-live',
                input: [{ type: 'text', text: 'follow up' }]
            }
        })).resolves.toEqual({
            turnId: 'turn-live'
        });

        await expect(handler({
            method: 'review/start',
            params: {
                target: { type: 'uncommittedChanges' }
            }
        })).resolves.toEqual({
            turn: { id: 'turn-review' },
            reviewThreadId: 'thread-anonymous'
        });

        expect(harness.rpcCalls).toEqual([
            {
                method: 'thread/read',
                params: {
                    threadId: 'thread-anonymous',
                    includeTurns: true
                }
            },
            {
                method: 'turn/steer',
                params: {
                    threadId: 'thread-anonymous',
                    expectedTurnId: 'turn-live',
                    input: [{ type: 'text', text: 'follow up', text_elements: [] }]
                }
            },
            {
                method: 'review/start',
                params: {
                    threadId: 'thread-anonymous',
                    target: { type: 'uncommittedChanges' }
                }
            }
        ]);
    });

    it('steers follow-up user messages into the active turn', async () => {
        harness.turnBehavior = 'steerable-pending';

        const {
            session
        } = createSessionStub([
            { message: 'first message', mode: createMode() },
            { message: 'follow up message', mode: { ...createMode(), model: 'gpt-5.4' } }
        ]);

        const exitReason = await codexRemoteLauncher(session as never);

        expect(exitReason).toBe('exit');
        expect(harness.startTurnCalls.length).toBe(1);
        expect(harness.rpcCalls).toContainEqual({
            method: 'turn/steer',
            params: {
                threadId: 'thread-anonymous',
                expectedTurnId: 'turn-live',
                input: [{ type: 'text', text: 'follow up message', text_elements: [] }]
            }
        });
    });
});
