import { MODEL_OPTIONS, type AgentType } from '@/components/NewSession/types'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel } from './claudeModelOptions'
import type { ClaudeComposerModelOption } from './claudeModelOptions'

export type ModelOption = ClaudeComposerModelOption

export type CodexModelOptionSource = {
    id?: string
    model?: string
    displayName?: string
}

function getGeminiModelOptions(currentModel?: string | null): ModelOption[] {
    return getPresetModelOptions('gemini', currentModel, 'Default')
}

function getPresetModelOptions(agent: AgentType, currentModel?: string | null, autoLabel = 'Auto'): ModelOption[] {
    const options = MODEL_OPTIONS[agent].map((m) => ({
        value: m.value === 'auto' ? null : m.value,
        label: m.value === 'auto' ? autoLabel : m.label
    }))
    const normalized = currentModel?.trim() || null
    if (normalized && !options.some((o) => o.value === normalized)) {
        options.splice(1, 0, { value: normalized, label: normalized })
    }
    return options
}

function getNextGeminiModel(currentModel?: string | null): string | null {
    return getNextPresetModel('gemini', currentModel, 'Default')
}

function getNextPresetModel(agent: AgentType, currentModel?: string | null, autoLabel = 'Auto'): string | null {
    const options = getPresetModelOptions(agent, currentModel, autoLabel)
    return getNextModelFromOptions(options, currentModel)
}

export function getNextModelFromOptions(options: ModelOption[], currentModel?: string | null): string | null {
    const currentIndex = options.findIndex((o) => o.value === (currentModel ?? null))
    if (currentIndex === -1) {
        return options[0]?.value ?? null
    }
    return options[(currentIndex + 1) % options.length]?.value ?? null
}

export function getModelOptionsForFlavor(flavor: string | undefined | null, currentModel?: string | null): ModelOption[] {
    if (flavor === 'codex') {
        return getPresetModelOptions('codex', currentModel)
    }
    if (flavor === 'gemini') {
        return getGeminiModelOptions(currentModel)
    }
    if (flavor === 'claude') {
        return getClaudeComposerModelOptions(currentModel)
    }
    return []
}

export function getCodexModelOptionsFromModels(
    models: CodexModelOptionSource[],
    currentModel?: string | null
): ModelOption[] {
    const options: ModelOption[] = [{ value: null, label: 'Auto' }]
    const seen = new Set<string>()

    for (const model of models) {
        const value = (model.model || model.id || '').trim()
        if (!value || seen.has(value)) {
            continue
        }
        seen.add(value)
        options.push({
            value,
            label: (model.displayName || value).trim() || value
        })
    }

    const normalized = currentModel?.trim() || null
    if (normalized && !seen.has(normalized)) {
        options.splice(1, 0, { value: normalized, label: normalized })
    }

    return options
}

export function getNextModelForFlavor(flavor: string | undefined | null, currentModel?: string | null): string | null {
    if (flavor === 'codex') {
        return getNextPresetModel('codex', currentModel)
    }
    if (flavor === 'gemini') {
        return getNextGeminiModel(currentModel)
    }
    if (flavor === 'claude') {
        return getNextClaudeComposerModel(currentModel)
    }
    return null
}
