import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { Workbox } from 'workbox-window'
import './index.css'
import { initializeFontScale } from '@/hooks/useFontScale'
import { getTelegramWebApp, isTelegramEnvironment, loadTelegramSdk } from './hooks/useTelegram'
import { queryClient } from './lib/query-client'
import { createAppRouter } from './router'
import { I18nProvider } from './lib/i18n-context'
import { restoreSpaRedirect } from './lib/spaRedirect'

const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000

function getStartParam(): string | null {
    const query = new URLSearchParams(window.location.search)
    const fromQuery = query.get('startapp') || query.get('tgWebAppStartParam')
    if (fromQuery) return fromQuery

    return getTelegramWebApp()?.initDataUnsafe?.start_param ?? null
}

function getDeepLinkedSessionId(): string | null {
    const startParam = getStartParam()
    if (startParam?.startsWith('session_')) {
        return startParam.slice('session_'.length)
    }
    return null
}

function getInitialPath(): string {
    const sessionId = getDeepLinkedSessionId()
    return sessionId ? `/sessions/${sessionId}` : '/sessions'
}

function getServiceWorkerUrl(): string {
    const swUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.origin)
    swUrl.searchParams.set('build', __APP_BUILD_ID__)
    return swUrl.toString()
}

async function registerServiceWorker() {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) {
        return
    }

    try {
        const workbox = new Workbox(getServiceWorkerUrl(), {
            scope: import.meta.env.BASE_URL
        })

        workbox.addEventListener('installed', (event) => {
            if (!event.isUpdate) {
                console.log('App ready for offline use')
            }
        })

        workbox.addEventListener('waiting', () => {
            if (confirm('New version available! Reload to update?')) {
                workbox.messageSkipWaiting()
            }
        })

        workbox.addEventListener('controlling', (event) => {
            if (event.isUpdate) {
                window.location.reload()
            }
        })

        const registration = await workbox.register({ immediate: true })
        if (!registration) {
            return
        }

        window.setInterval(() => {
            void registration.update()
        }, SERVICE_WORKER_UPDATE_INTERVAL_MS)
    } catch (error) {
        console.error('SW registration error:', error)
    }
}

async function bootstrap() {
    initializeFontScale()

    // Only load Telegram SDK in Telegram environment (with 3s timeout)
    const isTelegram = isTelegramEnvironment()
    document.documentElement.dataset.telegramApp = isTelegram ? 'true' : 'false'
    if (isTelegram) {
        await loadTelegramSdk()
    }

    // Handle GitHub Pages 404 redirect for SPA routing
    // When GitHub Pages can't find a path (e.g. /sessions/xxx), it serves 404.html
    // which stores the path in sessionStorage and redirects to /
    if (!isTelegram) {
        restoreSpaRedirect()
    }

    await registerServiceWorker()

    const history = isTelegram
        ? createMemoryHistory({ initialEntries: [getInitialPath()] })
        : undefined
    const router = createAppRouter(history)

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <I18nProvider>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                    {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
                </QueryClientProvider>
            </I18nProvider>
        </React.StrictMode>
    )
}

bootstrap()
