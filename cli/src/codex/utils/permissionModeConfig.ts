import type { CodexPermissionMode } from '@hapi/protocol/types';
import type { ApprovalPolicy, SandboxMode, SandboxPolicy } from '../appServerTypes';

export type CodexPermissionModeConfig = {
    approvalPolicy: ApprovalPolicy;
    sandbox: SandboxMode;
    sandboxPolicy: SandboxPolicy;
};

export function buildCodexSandboxPolicy(mode: SandboxMode): SandboxPolicy {
    switch (mode) {
        case 'read-only':
            return {
                type: 'readOnly',
                access: { type: 'fullAccess' },
                networkAccess: false
            };
        case 'workspace-write':
            return {
                type: 'workspaceWrite',
                writableRoots: [],
                readOnlyAccess: { type: 'fullAccess' },
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false
            };
        case 'danger-full-access':
            return { type: 'dangerFullAccess' };
    }
}

export function resolveCodexPermissionModeConfig(mode: CodexPermissionMode): CodexPermissionModeConfig {
    switch (mode) {
        case 'default':
            return {
                // Remote Codex sessions rely on HAPI's approval UI for sandbox escalation.
                // `on-request` keeps workspace-write sandboxing while still surfacing a
                // user-approvable elevation request when the model needs it.
                approvalPolicy: 'on-request',
                sandbox: 'workspace-write',
                sandboxPolicy: buildCodexSandboxPolicy('workspace-write')
            };
        case 'read-only':
            return {
                approvalPolicy: 'never',
                sandbox: 'read-only',
                sandboxPolicy: buildCodexSandboxPolicy('read-only')
            };
        case 'safe-yolo':
            return {
                // Keep escalation available when the workspace-write sandbox blocks a command.
                approvalPolicy: 'on-failure',
                sandbox: 'workspace-write',
                sandboxPolicy: buildCodexSandboxPolicy('workspace-write')
            };
        case 'yolo':
            return {
                approvalPolicy: 'never',
                sandbox: 'danger-full-access',
                sandboxPolicy: buildCodexSandboxPolicy('danger-full-access')
            };
    }

    const unexpectedMode: never = mode;
    throw new Error(`Unknown permission mode: ${unexpectedMode}`);
}

export function buildCodexPermissionModeCliArgs(mode: Exclude<CodexPermissionMode, 'default'>): string[] {
    const config = resolveCodexPermissionModeConfig(mode);
    if (typeof config.approvalPolicy !== 'string') {
        throw new Error('Granular Codex approval policy cannot be passed as CLI args');
    }
    return ['--ask-for-approval', config.approvalPolicy, '--sandbox', config.sandbox];
}
