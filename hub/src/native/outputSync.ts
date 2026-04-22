const MAX_OVERLAP_LENGTH = 16_384

function normalizeCapturedOutput(value: string): string {
    return value.replace(/\r\n/g, '\n')
}

export function diffCapturedTmuxOutput(previousSnapshot: string, nextSnapshot: string): string {
    const previous = normalizeCapturedOutput(previousSnapshot)
    const next = normalizeCapturedOutput(nextSnapshot)

    if (!next) {
        return ''
    }

    if (!previous) {
        return next
    }

    if (next.startsWith(previous)) {
        return next.slice(previous.length)
    }

    const maxOverlap = Math.min(previous.length, next.length, MAX_OVERLAP_LENGTH)
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        if (previous.slice(-overlap) === next.slice(0, overlap)) {
            return next.slice(overlap)
        }
    }

    return next
}
