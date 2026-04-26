import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'

type RollbackThreadDialogProps = {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    sessionId: string | null
    threadId: string | null
    onRollback: (numTurns: number) => Promise<void>
    isPending: boolean
}

export function RollbackThreadDialog(props: RollbackThreadDialogProps) {
    const { t } = useTranslation()
    const [numTurns, setNumTurns] = useState(1)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (props.isOpen) {
            setNumTurns(1)
            setError(null)
        }
    }, [props.isOpen])

    const query = useQuery({
        queryKey: props.sessionId && props.threadId
            ? queryKeys.codexThreadTurns(props.sessionId, props.threadId)
            : ['codex-thread-turns', 'disabled'],
        queryFn: async () => {
            if (!props.api || !props.sessionId || !props.threadId) {
                throw new Error('Codex thread unavailable')
            }
            return await props.api.listCodexThreadTurns(props.sessionId, {
                threadId: props.threadId,
                limit: 20,
                sortDirection: 'desc'
            })
        },
        enabled: props.isOpen && Boolean(props.api && props.sessionId && props.threadId)
    })

    const maxTurns = useMemo(() => {
        const count = query.data?.data.length ?? 0
        return Math.max(1, count)
    }, [query.data?.data.length])

    const handleConfirm = async () => {
        setError(null)
        try {
            await props.onRollback(Math.min(Math.max(1, numTurns), maxTurns))
            props.onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('dialog.error.default'))
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.rollbackCodexThread.title')}</DialogTitle>
                    <DialogDescription className="mt-2">
                        {t('dialog.rollbackCodexThread.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 flex flex-col gap-2">
                    <label className="text-sm font-medium text-[var(--app-fg)]" htmlFor="rollback-turn-count">
                        {t('dialog.rollbackCodexThread.turns')}
                    </label>
                    <select
                        id="rollback-turn-count"
                        value={numTurns}
                        onChange={(event) => setNumTurns(Number(event.target.value))}
                        className="h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)]"
                        disabled={props.isPending}
                    >
                        {Array.from({ length: maxTurns }, (_, index) => index + 1).map((count) => (
                            <option key={count} value={count}>
                                {t('dialog.rollbackCodexThread.turnOption', { n: count })}
                            </option>
                        ))}
                    </select>
                    {query.isLoading ? (
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('dialog.rollbackCodexThread.loading')}
                        </div>
                    ) : null}
                    {query.error ? (
                        <div className="text-xs text-red-500">
                            {query.error instanceof Error ? query.error.message : t('dialog.rollbackCodexThread.loadFailed')}
                        </div>
                    ) : null}
                </div>

                {error ? (
                    <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.isPending}>
                        {t('button.cancel')}
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleConfirm} disabled={props.isPending}>
                        {props.isPending
                            ? t('dialog.rollbackCodexThread.confirming')
                            : t('dialog.rollbackCodexThread.confirm')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
