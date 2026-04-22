import type { SessionMetadataSummary } from '@/types/api'

export function isWindowsHostOs(os: string | null | undefined): boolean {
    return typeof os === 'string' && os.toLowerCase() === 'win32'
}

export function isRemoteTerminalSupported(metadata: SessionMetadataSummary | null | undefined): boolean {
    if (metadata?.source === 'native-attached') {
        return false
    }

    return !isWindowsHostOs(metadata?.os)
}
