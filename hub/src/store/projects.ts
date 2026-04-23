import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredProject } from './types'

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

export function getProjectsByNamespace(db: Database, namespace: string): StoredProject[] {
    const rows = db.prepare(`
        SELECT *
        FROM projects
        WHERE namespace = ?
        ORDER BY updated_at DESC, created_at DESC
    `).all(namespace) as DbProjectRow[]

    return rows.map(toStoredProject)
}

export function getProjectByPath(
    db: Database,
    namespace: string,
    path: string
): StoredProject | null {
    const row = db.prepare(`
        SELECT *
        FROM projects
        WHERE namespace = ?
          AND path = ?
        LIMIT 1
    `).get(namespace, path) as DbProjectRow | undefined

    return row ? toStoredProject(row) : null
}

export function upsertProject(
    db: Database,
    namespace: string,
    path: string,
    name?: string
): StoredProject {
    const existing = getProjectByPath(db, namespace, path)
    const now = Date.now()

    if (existing) {
        const nextName = name === undefined ? existing.name : name
        db.prepare(`
            UPDATE projects
            SET name = @name,
                updated_at = @updated_at
            WHERE id = @id
              AND namespace = @namespace
        `).run({
            id: existing.id,
            namespace,
            name: nextName ?? null,
            updated_at: now
        })

        const updated = getProjectByPath(db, namespace, path)
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
            @id,
            @namespace,
            @path,
            @name,
            @created_at,
            @updated_at
        )
    `).run({
        id,
        namespace,
        path,
        name: name ?? null,
        created_at: now,
        updated_at: now
    })

    const created = getProjectByPath(db, namespace, path)
    if (!created) {
        throw new Error('Failed to create project')
    }
    return created
}
