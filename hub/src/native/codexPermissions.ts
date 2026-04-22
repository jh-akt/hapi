export type NativeCodexPermissionOption = {
    index: number
    label: string
    hotkey: string | null
}

export type NativeCodexCommandPermissionPrompt = {
    kind: 'command-approval'
    question: string
    command: string
    options: NativeCodexPermissionOption[]
    fingerprint: string
}

export type NativeCodexCommandPermissionResult = {
    command: string
    status: 'approved' | 'denied'
    decision: 'approved' | 'approved_for_session' | 'abort'
}

type ParsedOptionSeed = {
    index: number
    rawLabel: string
}

function findLastLineIndex(lines: string[], predicate: (line: string) => boolean): number {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (predicate(lines[index] ?? '')) {
            return index
        }
    }

    return -1
}

function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function normalizeCommand(value: string): string {
    return collapseWhitespace(value)
}

function parseOptionLabel(rawLabel: string): Omit<NativeCodexPermissionOption, 'index'> {
    const label = collapseWhitespace(rawLabel)
    const hotkeyMatch = label.match(/\(([^)]+)\)\s*$/)
    if (!hotkeyMatch) {
        return {
            label,
            hotkey: null
        }
    }

    const hotkey = hotkeyMatch[1]?.trim().toLowerCase() || null
    return {
        label: collapseWhitespace(label.slice(0, hotkeyMatch.index ?? label.length)),
        hotkey
    }
}

function parsePromptOptions(lines: string[]): NativeCodexPermissionOption[] {
    const options: ParsedOptionSeed[] = []
    let current: ParsedOptionSeed | null = null

    for (const rawLine of lines) {
        const line = rawLine.trimEnd()
        const optionMatch = line.match(/^\s*[›> ]?\s*(\d+)\.\s+(.+?)\s*$/)
        if (optionMatch) {
            current = {
                index: Number.parseInt(optionMatch[1] ?? '', 10),
                rawLabel: optionMatch[2] ?? ''
            }
            options.push(current)
            continue
        }

        if (!current) {
            continue
        }

        if (line.trim().length === 0) {
            continue
        }

        if (/^\s+\S/.test(line)) {
            current.rawLabel += ` ${line.trim()}`
        }
    }

    return options
        .filter((option) => Number.isFinite(option.index))
        .map((option) => {
            const parsed = parseOptionLabel(option.rawLabel)
            return {
                index: option.index,
                label: parsed.label,
                hotkey: parsed.hotkey
            }
        })
}

export function parseNativeCodexCommandPermissionPrompt(snapshot: string): NativeCodexCommandPermissionPrompt | null {
    const lines = snapshot.replace(/\r\n/g, '\n').split('\n')
    const confirmIndex = findLastLineIndex(lines, (line) =>
        line.includes('Press enter to confirm or esc to cancel')
    )

    if (confirmIndex < 0) {
        return null
    }

    const searchStart = Math.max(0, confirmIndex - 24)
    const window = lines.slice(searchStart, confirmIndex + 1)
    const questionOffset = findLastLineIndex(window, (line) =>
        line.trim() === 'Would you like to run the following command?'
    )

    if (questionOffset < 0) {
        return null
    }

    const questionIndex = searchStart + questionOffset
    const commandLine = lines
        .slice(questionIndex + 1, confirmIndex)
        .find((line) => /^\s*\$\s+/.test(line))

    if (!commandLine) {
        return null
    }

    const command = normalizeCommand(commandLine.replace(/^\s*\$\s+/, ''))
    if (!command) {
        return null
    }

    const options = parsePromptOptions(lines.slice(questionIndex + 1, confirmIndex))
    if (options.length === 0) {
        return null
    }

    return {
        kind: 'command-approval',
        question: 'Would you like to run the following command?',
        command,
        options,
        fingerprint: `command-approval:${command}`
    }
}

export function parseNativeCodexCommandPermissionResult(snapshot: string): NativeCodexCommandPermissionResult | null {
    const lines = snapshot.replace(/\r\n/g, '\n').split('\n')

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim()
        if (!line) {
            continue
        }

        const approvedMatch = line.match(/^✔\s+You approved codex to run (.+) this time$/)
        if (approvedMatch) {
            return {
                command: normalizeCommand(approvedMatch[1] ?? ''),
                status: 'approved',
                decision: 'approved'
            }
        }

        const approvedForSessionMatch = line.match(/^✔\s+You approved codex to always run commands that start with (.+)$/)
        if (approvedForSessionMatch) {
            return {
                command: normalizeCommand(approvedForSessionMatch[1] ?? ''),
                status: 'approved',
                decision: 'approved_for_session'
            }
        }

        const canceledMatch = line.match(/^✗\s+You canceled the request to run (.+)$/)
        if (canceledMatch) {
            return {
                command: normalizeCommand(canceledMatch[1] ?? ''),
                status: 'denied',
                decision: 'abort'
            }
        }
    }

    return null
}

export function mapNativeCodexApprovalKey(decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'): string {
    if (decision === 'approved_for_session') {
        return 'p'
    }

    if (decision === 'approved' || decision === undefined) {
        return 'y'
    }

    return 'Escape'
}
