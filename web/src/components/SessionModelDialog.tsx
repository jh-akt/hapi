import { useEffect, useMemo, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { getModelOptionsForFlavor, type ModelOption } from '@/components/AssistantChat/modelOptions'
import { getCodexComposerReasoningEffortOptions } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { useTranslation } from '@/lib/use-translation'
import type { CodexModel } from '@/types/api'

type SessionModelDialogProps = {
    isOpen: boolean
    onClose: () => void
    agentFlavor?: string | null
    currentModel?: string | null
    currentModelReasoningEffort?: string | null
    modelOptions?: ModelOption[]
    codexModels?: CodexModel[]
    onModelChange: (model: string | null) => Promise<void>
    onModelReasoningEffortChange?: (modelReasoningEffort: string | null) => Promise<void>
    isPending: boolean
}

function getCodexModelForSelection(models: CodexModel[] | undefined, selectedModel: string | null): CodexModel | null {
    if (!models?.length) {
        return null
    }
    if (!selectedModel) {
        return models.find((model) => model.isDefault) ?? null
    }
    return models.find((model) => model.model === selectedModel || model.id === selectedModel) ?? null
}

export function SessionModelDialog(props: SessionModelDialogProps) {
    const { t } = useTranslation()
    const currentModel = props.currentModel ?? null
    const currentModelReasoningEffort = props.currentModelReasoningEffort ?? null
    const [selectedModel, setSelectedModel] = useState<string | null>(currentModel)
    const [selectedModelReasoningEffort, setSelectedModelReasoningEffort] = useState<string | null>(currentModelReasoningEffort)
    const [error, setError] = useState<string | null>(null)

    const modelOptions = useMemo(
        () => props.modelOptions ?? getModelOptionsForFlavor(props.agentFlavor, currentModel),
        [props.modelOptions, props.agentFlavor, currentModel]
    )
    const selectedCodexModel = useMemo(
        () => props.agentFlavor === 'codex'
            ? getCodexModelForSelection(props.codexModels, selectedModel)
            : null,
        [props.agentFlavor, props.codexModels, selectedModel]
    )
    const supportedReasoningEfforts = useMemo(
        () => selectedCodexModel
            ? selectedCodexModel.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)
            : null,
        [selectedCodexModel]
    )
    const reasoningEffortOptions = useMemo(
        () => props.agentFlavor === 'codex' && props.onModelReasoningEffortChange
            ? getCodexComposerReasoningEffortOptions(selectedModelReasoningEffort, supportedReasoningEfforts)
            : [],
        [
            props.agentFlavor,
            selectedModelReasoningEffort,
            supportedReasoningEfforts,
            props.onModelReasoningEffortChange
        ]
    )

    useEffect(() => {
        if (!props.isOpen) {
            return
        }
        setSelectedModel(currentModel)
        setSelectedModelReasoningEffort(currentModelReasoningEffort)
        setError(null)
    }, [props.isOpen, currentModel, currentModelReasoningEffort])

    const handleSave = async () => {
        const modelChanged = selectedModel !== currentModel
        const reasoningEffortChanged = selectedModelReasoningEffort !== currentModelReasoningEffort
        if (!modelChanged && !reasoningEffortChanged) {
            props.onClose()
            return
        }
        setError(null)
        try {
            if (modelChanged) {
                await props.onModelChange(selectedModel)
            }
            if (reasoningEffortChanged) {
                await props.onModelReasoningEffortChange?.(selectedModelReasoningEffort)
            }
            props.onClose()
        } catch (err) {
            const message = err instanceof Error && err.message
                ? err.message
                : t('dialog.model.error')
            setError(message)
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.model.title')}</DialogTitle>
                    <DialogDescription className="mt-2">
                        {t('dialog.model.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-3 max-h-[50vh] overflow-y-auto">
                    <div className="flex flex-col gap-1">
                        {modelOptions.map((option) => (
                            <button
                                key={option.value ?? 'auto'}
                                type="button"
                                disabled={props.isPending}
                                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                                    props.isPending
                                        ? 'cursor-not-allowed opacity-50'
                                        : 'hover:bg-[var(--app-subtle-bg)]'
                                }`}
                                onClick={() => setSelectedModel(option.value)}
                            >
                                <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                                        selectedModel === option.value
                                            ? 'border-[var(--app-link)]'
                                            : 'border-[var(--app-hint)]'
                                    }`}
                                >
                                    {selectedModel === option.value ? (
                                        <span className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                    ) : null}
                                </span>
                                <span className={selectedModel === option.value ? 'text-[var(--app-link)]' : 'text-[var(--app-fg)]'}>
                                    {option.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    {reasoningEffortOptions.length > 0 ? (
                        <>
                            <div className="my-2 h-px bg-[var(--app-divider)]" />
                            <div className="px-3 pb-1 pt-1 text-xs font-semibold text-[var(--app-hint)]">
                                {t('misc.reasoningEffort')}
                            </div>
                            <div className="flex flex-col gap-1">
                                {reasoningEffortOptions.map((option) => (
                                    <button
                                        key={option.value ?? 'default'}
                                        type="button"
                                        disabled={props.isPending}
                                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                                            props.isPending
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'hover:bg-[var(--app-subtle-bg)]'
                                        }`}
                                        onClick={() => setSelectedModelReasoningEffort(option.value)}
                                    >
                                        <span
                                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                                                selectedModelReasoningEffort === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {selectedModelReasoningEffort === option.value ? (
                                                <span className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            ) : null}
                                        </span>
                                        <span className={selectedModelReasoningEffort === option.value ? 'text-[var(--app-link)]' : 'text-[var(--app-fg)]'}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>

                {error ? (
                    <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={props.onClose}
                        disabled={props.isPending}
                    >
                        {t('button.cancel')}
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={props.isPending || modelOptions.length === 0}
                    >
                        {props.isPending ? t('dialog.model.saving') : t('button.save')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
