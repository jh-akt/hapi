import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nContext } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import en from '@/lib/locales/en'
import { SessionHeader } from './SessionHeader'
import type { Session } from '@/types/api'

vi.mock('@/hooks/useTelegram', () => ({
    isTelegramApp: () => false,
    getTelegramWebApp: () => null
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        isTelegram: false,
        isTouch: false,
        haptic: {
            impact: () => {},
            notification: () => {},
            selection: () => {}
        }
    })
}))

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/Users/tester/project',
            host: 'tester',
            flavor: 'codex'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        model: 'gpt-5.4',
        modelReasoningEffort: 'xhigh',
        effort: null,
        ...overrides
    }
}

function renderHeader(session: Session): string {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
    const translations: Record<string, string> = en
    const t = (key: string) => translations[key] ?? key

    return renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
            <I18nContext.Provider value={{ t, locale: 'en', setLocale: () => {} }}>
                <ToastProvider>
                    <SessionHeader
                        session={session}
                        onBack={() => {}}
                        api={null}
                    />
                </ToastProvider>
            </I18nContext.Provider>
        </QueryClientProvider>
    )
}

describe('SessionHeader', () => {
    it('shows Codex model reasoning effort next to the model', () => {
        const html = renderHeader(createSession())

        expect(html).toContain('model: gpt-5.4')
        expect(html).toContain('Reasoning Effort: XHigh')
    })
})
