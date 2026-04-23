import type { CodexReviewStartParams, SlashCommand } from '@/types/api'

const BUILTIN_COMMANDS: Record<string, SlashCommand[]> = {
    claude: [
        { name: 'clear', description: 'Clear conversation history and free up context', source: 'builtin' },
        { name: 'compact', description: 'Clear conversation history but keep a summary in context', source: 'builtin' },
        { name: 'context', description: 'Visualize current context usage as a colored grid', source: 'builtin' },
        { name: 'cost', description: 'Show the total cost and duration of the current session', source: 'builtin' },
        { name: 'doctor', description: 'Diagnose and verify your Claude Code installation and settings', source: 'builtin' },
        { name: 'plan', description: 'View or open the current session plan', source: 'builtin' },
        { name: 'stats', description: 'Show your Claude Code usage statistics and activity', source: 'builtin' },
        { name: 'status', description: 'Show Claude Code status including version, model, account, and API connectivity', source: 'builtin' },
    ],
    codex: [
        { name: 'review', description: 'Run Codex automated review on current changes', source: 'builtin' },
    ],
    gemini: [
        { name: 'about', description: 'Show version info', source: 'builtin' },
        { name: 'clear', description: 'Clear the screen and conversation history', source: 'builtin' },
        { name: 'compress', description: 'Compress the context by replacing it with a summary', source: 'builtin' },
        { name: 'stats', description: 'Check session stats', source: 'builtin' },
    ],
    opencode: [],
}

const UNSUPPORTED_CODEX_BUILTIN_COMMANDS = new Set([
    'new',
    'compat',
    'undo',
    'diff',
    'status',
])

export function getBuiltinSlashCommands(agentType: string): SlashCommand[] {
    return BUILTIN_COMMANDS[agentType] ?? BUILTIN_COMMANDS.claude ?? []
}

export function findUnsupportedCodexBuiltinSlashCommand(
    text: string,
    availableCommands: readonly SlashCommand[]
): string | null {
    const match = /^\s*\/([a-z0-9:_-]+)(?:\s|$)/i.exec(text)
    if (!match) {
        return null
    }

    const commandName = match[1]?.toLowerCase()
    if (!commandName || !UNSUPPORTED_CODEX_BUILTIN_COMMANDS.has(commandName)) {
        return null
    }

    const hasCustomCommand = availableCommands.some(
        command => command.source !== 'builtin' && command.name.toLowerCase() === commandName
    )

    return hasCustomCommand ? null : commandName
}

export function parseCodexReviewSlashCommand(text: string): CodexReviewStartParams | null {
    const match = /^\s*\/review(?:\s+([\s\S]*))?$/i.exec(text)
    if (!match) {
        return null
    }

    const rawInstructions = match[1]?.trim() ?? ''
    if (rawInstructions.length === 0) {
        return {
            target: { type: 'uncommittedChanges' }
        }
    }

    return {
        target: {
            type: 'custom',
            instructions: rawInstructions
        }
    }
}
