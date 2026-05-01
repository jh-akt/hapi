import { getClaudeModelLabel } from '@hapi/protocol'

type SessionModelSource = {
    model?: string | null
    modelReasoningEffort?: string | null
}

export type SessionModelLabel = {
    key: 'session.item.model'
    value: string
}

export type SessionModelReasoningEffortLabel = {
    key: 'misc.reasoningEffort'
    value: string
}

const MODEL_REASONING_EFFORT_LABELS: Record<string, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh'
}

export function getSessionModelLabel(session: SessionModelSource): SessionModelLabel | null {
    const explicitModel = typeof session.model === 'string' ? session.model.trim() : ''
    if (explicitModel) {
        return {
            key: 'session.item.model',
            value: getClaudeModelLabel(explicitModel) ?? explicitModel
        }
    }

    return null
}

export function getSessionModelReasoningEffortLabel(
    session: SessionModelSource
): SessionModelReasoningEffortLabel | null {
    const explicitEffort = typeof session.modelReasoningEffort === 'string'
        ? session.modelReasoningEffort.trim().toLowerCase()
        : ''
    if (!explicitEffort || explicitEffort === 'default') {
        return null
    }

    return {
        key: 'misc.reasoningEffort',
        value: MODEL_REASONING_EFFORT_LABELS[explicitEffort]
            ?? `${explicitEffort.charAt(0).toUpperCase()}${explicitEffort.slice(1)}`
    }
}
