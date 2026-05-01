import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionModelDialog } from './SessionModelDialog'
import type { CodexModel } from '@/types/api'

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('SessionModelDialog', () => {
    afterEach(() => {
        cleanup()
    })

    it('lets Codex sessions save model and reasoning effort together', async () => {
        const onModelChange = vi.fn(async () => {})
        const onModelReasoningEffortChange = vi.fn(async () => {})
        const onClose = vi.fn()

        renderWithProviders(
            <SessionModelDialog
                isOpen
                onClose={onClose}
                agentFlavor="codex"
                currentModel={null}
                currentModelReasoningEffort={null}
                onModelChange={onModelChange}
                onModelReasoningEffortChange={onModelReasoningEffortChange}
                isPending={false}
            />
        )

        fireEvent.click(screen.getByText('GPT-5.4'))
        fireEvent.click(screen.getByText('XHigh'))
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => {
            expect(onModelChange).toHaveBeenCalledWith('gpt-5.4')
            expect(onModelReasoningEffortChange).toHaveBeenCalledWith('xhigh')
            expect(onClose).toHaveBeenCalled()
        })
    })

    it('does not show reasoning effort for non-Codex sessions', () => {
        renderWithProviders(
            <SessionModelDialog
                isOpen
                onClose={vi.fn()}
                agentFlavor="claude"
                currentModel={null}
                onModelChange={vi.fn(async () => {})}
                isPending={false}
            />
        )

        expect(screen.queryByText('Reasoning Effort')).not.toBeInTheDocument()
    })

    it('uses dynamic Codex models and filters reasoning efforts by selected model', async () => {
        const onModelChange = vi.fn(async () => {})
        const onModelReasoningEffortChange = vi.fn(async () => {})

        renderWithProviders(
            <SessionModelDialog
                isOpen
                onClose={vi.fn()}
                agentFlavor="codex"
                currentModel={null}
                currentModelReasoningEffort={null}
                modelOptions={[
                    { value: null, label: 'Auto' },
                    { value: 'gpt-dynamic', label: 'GPT Dynamic' }
                ]}
                codexModels={[{
                    id: 'gpt-dynamic',
                    model: 'gpt-dynamic',
                    upgrade: null,
                    upgradeInfo: null,
                    availabilityNux: null,
                    displayName: 'GPT Dynamic',
                    description: 'Dynamic test model',
                    hidden: false,
                    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
                    defaultReasoningEffort: 'low',
                    inputModalities: ['text'],
                    supportsPersonality: true,
                    additionalSpeedTiers: [],
                    isDefault: false
                } satisfies CodexModel]}
                onModelChange={onModelChange}
                onModelReasoningEffortChange={onModelReasoningEffortChange}
                isPending={false}
            />
        )

        fireEvent.click(screen.getByText('GPT Dynamic'))

        expect(screen.getByText('Low')).toBeInTheDocument()
        expect(screen.queryByText('XHigh')).not.toBeInTheDocument()

        fireEvent.click(screen.getByText('Low'))
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => {
            expect(onModelChange).toHaveBeenCalledWith('gpt-dynamic')
            expect(onModelReasoningEffortChange).toHaveBeenCalledWith('low')
        })
    })
})
