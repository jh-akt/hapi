import { useId } from 'react'
import type { AgentType, NewSessionModelOption } from './types'
import { MODEL_OPTIONS } from './types'
import { useTranslation } from '@/lib/use-translation'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    modelOptions?: NewSessionModelOption[]
    isDisabled: boolean
    onModelChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const modelListId = useId()
    const options = props.modelOptions ?? MODEL_OPTIONS[props.agent]
    if (options.length === 0) {
        return null
    }

    if (props.agent === 'codex') {
        const autoLabel = options.find((option) => option.value === 'auto')?.label ?? 'Auto'
        const customOptions = options.filter((option) => option.value !== 'auto')

        return (
            <div className="flex flex-col gap-1.5 px-3 py-3">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    {t('newSession.model')}{' '}
                    <span className="font-normal">({t('newSession.model.optional')})</span>
                </label>
                <input
                    list={modelListId}
                    value={props.model === 'auto' ? '' : props.model}
                    onChange={(e) => props.onModelChange(e.target.value.trim() ? e.target.value : 'auto')}
                    onBlur={(e) => props.onModelChange(e.target.value.trim() || 'auto')}
                    disabled={props.isDisabled}
                    placeholder={autoLabel}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <datalist id={modelListId}>
                    {customOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </datalist>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.model')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <select
                value={props.model}
                onChange={(e) => props.onModelChange(e.target.value)}
                disabled={props.isDisabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    )
}
