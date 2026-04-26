import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredProject } from './types'
import { normalizeFilesystemPath } from '../utils/filesystemPath'

type DbProjectRow = {
    id: string
    namespace: string
    path: string
    name: string | null
    created_at: number
    updated_at: number
}

function toStoredProject(row: DbProjectRow): StoredProject {
    return {
        id: row.id,
        namespace: row.namespace,
        path: row.path,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function listProjectRowsByNamespace(db: Database, namespace: string): DbProjectRow[] {
    return db.prepare(`
        SELECT *
        FROM projects
        WHERE namespace = ?
        ORDER BY updated_at DESC, created_at DESC
    `).all(namespace) as DbProjectRow[]
}

function choosePreferredProjectRow(current: StoredProject, candidate: StoredProject): StoredProject {
    if (candidate.updatedAt > current.updatedAt) {
        return {
            ...candidate,
            name: candidate.name ?? current.name
        }
    }

    if (candidate.updatedAt === current.updatedAt && candidate.createdAt > current.createdAt) {
        return {
            ...candidate,
            name: candidate.name ?? current.name
        }
    }

    if (!current.name && candidate.name) {
        return {
            ...current,
            name: candidate.name
        }
    }

    return current
}

export function getProjectsByNamespace(db: Database, namespace: string): StoredProject[] {
    const deduped = new Map<string, StoredProject>()

    for (const row of listProjectRowsByNamespace(db, namespace)) {
        const normalizedPath = normalizeFilesystemPath(row.path)
        if (!normalizedPath) {
            continue
        }

        const normalizedProject = toStoredProject({
            ...row,
            path: normalizedPath
        })
        const current = deduped.get(normalizedPath)
        deduped.set(
            normalizedPath,
            current ? choosePreferredProjectRow(current, normalizedProject) : normalizedProject
        )
    }

    return Array.from(deduped.values())
        .sort((left, right) => {
            if (left.updatedAt !== right.updatedAt) {
                return right.updatedAt - left.updatedAt
            }
            return right.createdAt - left.createdAt
        })
}

export function getProjectByPath(
    db: Database,
    namespace: string,
    path: string
): StoredProject | null {
    const normalizedPath = normalizeFilesystemPath(path)
    if (!normalizedPath) {
        return null
    }

    const matches = listProjectRowsByNamespace(db, namespace)
        .map((row) => ({
            row,
            normalizedPath: normalizeFilesystemPath(row.path)
        }))
        .filter((entry) => entry.normalizedPath === normalizedPath)

    const matched = matches[0]
    if (!matched) {
        return null
    }

    return toStoredProject({
        ...matched.row,
        path: normalizedPath
    })
}

export function upsertProject(
    db: Database,
    namespace: string,
    path: string,
    name?: string
): StoredProject {
    const normalizedPath = normalizeFilesystemPath(path)
    if (!normalizedPath) {
        throw new Error('Invalid project path')
    }

    const matchingRows = listProjectRowsByNamespace(db, namespace)
        .filter((row) => normalizeFilesystemPath(row.path) === normalizedPath)
    const now = Date.now()

    if (matchingRows.length > 0) {
        const primary = matchingRows[0]
        const nextName = name ?? primary.name ?? matchingRows.find((row) => row.name)?.name ?? null
        const duplicateIds = matchingRows
            .slice(1)
            .map((row) => row.id)

        if (duplicateIds.length > 0) {
            const placeholders = duplicateIds.map(() => '?').join(', ')
            db.prepare(`
                DELETE FROM projects
                WHERE namespace = ?
                  AND id IN (${placeholders})
            `).run(namespace, ...duplicateIds)
        }

        db.prepare(`
            UPDATE projects
            SET path = ?,
                name = ?,
                updated_at = ?
            WHERE id = ?
              AND namespace = ?
        `).run(
            normalizedPath,
            nextName ?? null,
            now,
            primary.id,
            namespace
        )

        const updated = getProjectByPath(db, namespace, normalizedPath)
        if (!updated) {
            throw new Error('Failed to update project')
        }
        return updated
    }

    const id = randomUUID()
    db.prepare(`
        INSERT INTO projects (
            id,
            namespace,
            path,
            name,
            created_at,
            updated_at
        ) VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        )
    `).run(
        id,
        namespace,
        normalizedPath,
        name ?? null,
        now,
        now
    )

    const created = getProjectByPath(db, namespace, normalizedPath)
    if (!created) {
        throw new Error('Failed to create project')
    }
    return created
}
