import { describe, expect, it } from 'vitest';
import { resolveCodexPermissionModeConfig } from './permissionModeConfig';

describe('resolveCodexPermissionModeConfig', () => {
    const workspaceWriteSandboxPolicy = {
        type: 'workspaceWrite',
        writableRoots: [],
        readOnlyAccess: { type: 'fullAccess' },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
    };

    it('uses on-request approvals for default mode', () => {
        expect(resolveCodexPermissionModeConfig('default')).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
            sandboxPolicy: workspaceWriteSandboxPolicy
        });
    });

    it('keeps safe-yolo escalation on failure', () => {
        expect(resolveCodexPermissionModeConfig('safe-yolo')).toEqual({
            approvalPolicy: 'on-failure',
            sandbox: 'workspace-write',
            sandboxPolicy: workspaceWriteSandboxPolicy
        });
    });
});
