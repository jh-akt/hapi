export type CodexComposerReasoningEffortOption = {
    value: string | null
    label: string
}

const CODEX_REASONING_EFFORT_PRESETS = ['low', 'medium', 'high', 'xhigh'] as const
const CODEX_REASONING_EFFORT_LABELS: Record<(typeof CODEX_REASONING_EFFORT_PRESETS)[number], string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh'
}

function normalizeCodexComposerReasoningEffort(effort?: string | null): string | null {
    const trimmedEffort = effort?.trim().toLowerCase()
    if (!trimmedEffort || trimmedEffort === 'default') {
        return null
    }

    return trimmedEffort
}

function formatCodexReasoningEffortLabel(effort: string): string {
    return CODEX_REASONING_EFFORT_LABELS[effort as keyof typeof CODEX_REASONING_EFFORT_LABELS]
        ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

export function getCodexComposerReasoningEffortOptions(
    currentEffort?: string | null,
    supportedEfforts?: string[] | null
): CodexComposerReasoningEffortOption[] {
    const normalizedCurrentEffort = normalizeCodexComposerReasoningEffort(currentEffort)
    const supported = supportedEfforts?.length
        ? new Set(supportedEfforts.map((effort) => effort.trim().toLowerCase()).filter(Boolean))
        : null
    const options: CodexComposerReasoningEffortOption[] = [
        { value: null, label: 'Default' }
    ]

    if (
        normalizedCurrentEffort
        && !CODEX_REASONING_EFFORT_PRESETS.includes(normalizedCurrentEffort as typeof CODEX_REASONING_EFFORT_PRESETS[number])
    ) {
        options.push({
            value: normalizedCurrentEffort,
            label: formatCodexReasoningEffortLabel(normalizedCurrentEffort)
        })
    }

    options.push(...CODEX_REASONING_EFFORT_PRESETS
        .filter((effort) => !supported || supported.has(effort))
        .map((effort) => ({
            value: effort,
            label: CODEX_REASONING_EFFORT_LABELS[effort]
        })))

    return options
}
