import { useId, useMemo, useRef, useState } from 'react'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { SessionModelDialog } from '@/components/SessionModelDialog'
import { RollbackThreadDialog } from '@/components/RollbackThreadDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getModelOptionsForFlavor } from '@/components/AssistantChat/modelOptions'
import { getSessionModelLabel, getSessionModelReasoningEffortLabel } from '@/lib/sessionModelLabel'
import { useTranslation } from '@/lib/use-translation'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onViewFiles?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
    onSessionForked?: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const { session, api, onSessionDeleted } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const modelLabel = getSessionModelLabel(session)
    const modelReasoningEffortLabel = getSessionModelReasoningEffortLabel(session)
    const isNativeSession = session.metadata?.source === 'native-attached'
    const isArchivedSession = Boolean(session.metadata?.archivedAt ?? session.metadata?.archivedBy ?? session.metadata?.archiveReason)
    const codexThreadId = session.metadata?.codexSessionId?.trim() || null
    const codexThreadLifecycleSupported = session.metadata?.flavor === 'codex'
        && !isNativeSession
        && Boolean(codexThreadId)
    const agentFlavor = session.metadata?.flavor ?? null
    const controlledByUser = session.agentState?.controlledByUser === true
    const codexRemoteConfigSupported = agentFlavor === 'codex'
        && session.active
        && !isNativeSession
        && !controlledByUser
    const staticModelOptions = getModelOptionsForFlavor(agentFlavor, session.model)
    const codexModels = useCodexModels(api, session.id, session.model, codexRemoteConfigSupported)
    const modelOptions = agentFlavor === 'codex' && codexModels.modelOptions.length > 1
        ? codexModels.modelOptions
        : staticModelOptions
    const modelSelectionSupported = session.active
        && !isNativeSession
        && modelOptions.length > 0
        && (agentFlavor !== 'codex' || !controlledByUser)
    const modelUnavailableReason = !modelSelectionSupported && modelOptions.length > 0
        ? isNativeSession || controlledByUser
            ? t('session.action.modelUnavailable.native')
            : !session.active
                ? t('session.action.modelUnavailable.offline')
                : t('session.action.modelUnavailable.unsupported')
        : undefined

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [modelOpen, setModelOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [unarchiveOpen, setUnarchiveOpen] = useState(false)
    const [rollbackOpen, setRollbackOpen] = useState(false)
    const [compactOpen, setCompactOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const {
        archiveSession,
        unarchiveSession,
        forkSession,
        rollbackCodexThread,
        compactCodexThread,
        setModel,
        setModelReasoningEffort,
        renameSession,
        deleteSession,
        isPending
    } = useSessionActions(
        api,
        session.id,
        agentFlavor,
        codexRemoteConfigSupported,
        codexThreadLifecycleSupported
            ? {
                codexThreadId,
                sessionSource: session.metadata?.source ?? null,
                sessionActive: session.active,
                sessionPath: session.metadata?.path ?? null
            }
            : undefined
    )

    const handleFork = async () => {
        try {
            const nextSessionId = await forkSession()
            haptic.notification('success')
            props.onSessionForked?.(nextSessionId)
        } catch (error) {
            haptic.notification('error')
            addToast({
                title: t('session.forkFailed.title'),
                body: error instanceof Error ? error.message : t('session.forkFailed.body'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        }
    }

    const handleArchive = async () => {
        await archiveSession()
        props.onBack()
    }

    const handleModelChange = async (model: string | null) => {
        await setModel(model)
        haptic.notification('success')
    }

    const handleModelReasoningEffortChange = async (modelReasoningEffort: string | null) => {
        await setModelReasoningEffort(modelReasoningEffort)
        haptic.notification('success')
    }

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            {isNativeSession ? (
                                <span>{t('nativeSession.badge')}</span>
                            ) : null}
                            {isArchivedSession ? (
                                <span>{t('session.badge.archived')}</span>
                            ) : null}
                            {modelLabel ? (
                                <span>
                                    {t(modelLabel.key)}: {modelLabel.value}
                                </span>
                            ) : null}
                            {modelReasoningEffortLabel ? (
                                <span>
                                    {t(modelReasoningEffortLabel.key)}: {modelReasoningEffortLabel.value}
                                </span>
                            ) : null}
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onFork={session.metadata?.path ? handleFork : undefined}
                onRollback={codexThreadLifecycleSupported && !isArchivedSession ? () => setRollbackOpen(true) : undefined}
                onCompact={codexThreadLifecycleSupported && !isArchivedSession ? () => setCompactOpen(true) : undefined}
                onModel={modelSelectionSupported ? () => setModelOpen(true) : undefined}
                modelUnavailableReason={modelUnavailableReason}
                onRename={() => setRenameOpen(true)}
                onArchive={isArchivedSession ? undefined : () => setArchiveOpen(true)}
                onUnarchive={codexThreadLifecycleSupported && isArchivedSession ? () => setUnarchiveOpen(true) : undefined}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <SessionModelDialog
                isOpen={modelOpen}
                onClose={() => setModelOpen(false)}
                agentFlavor={agentFlavor}
                currentModel={session.model}
                currentModelReasoningEffort={session.modelReasoningEffort}
                modelOptions={modelOptions}
                codexModels={agentFlavor === 'codex' ? codexModels.models : undefined}
                onModelChange={handleModelChange}
                onModelReasoningEffortChange={
                    codexRemoteConfigSupported
                        ? handleModelReasoningEffortChange
                        : undefined
                }
                isPending={isPending}
            />

            <RollbackThreadDialog
                isOpen={rollbackOpen}
                onClose={() => setRollbackOpen(false)}
                api={api}
                sessionId={session.id}
                threadId={codexThreadId}
                onRollback={rollbackCodexThread}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={compactOpen}
                onClose={() => setCompactOpen(false)}
                title={t('dialog.compactCodexThread.title')}
                description={t('dialog.compactCodexThread.description', { name: title })}
                confirmLabel={t('dialog.compactCodexThread.confirm')}
                confirmingLabel={t('dialog.compactCodexThread.confirming')}
                onConfirm={compactCodexThread}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.title' : 'dialog.archive.title')}
                description={t(
                    codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.description' : 'dialog.archive.description',
                    { name: title }
                )}
                confirmLabel={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.confirm' : 'dialog.archive.confirm')}
                confirmingLabel={t(codexThreadLifecycleSupported ? 'dialog.archiveCodexThread.confirming' : 'dialog.archive.confirming')}
                onConfirm={handleArchive}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={unarchiveOpen}
                onClose={() => setUnarchiveOpen(false)}
                title={t('dialog.unarchive.title')}
                description={t('dialog.unarchive.description', { name: title })}
                confirmLabel={t('dialog.unarchive.confirm')}
                confirmingLabel={t('dialog.unarchive.confirming')}
                onConfirm={unarchiveSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )
}
