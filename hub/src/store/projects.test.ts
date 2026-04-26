import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getProjectsByNamespace, upsertProject } from './projects'

function createProjectsDb(): Database {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            path TEXT NOT NULL,
            name TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(namespace, path)
        );
    `)
    return db
}

describe('projects store', () => {
    it('normalizes home-relative project paths on upsert', () => {
        const db = createProjectsDb()
        const expectedPath = join(homedir(), 'Code', 'demo-project')

        const project = upsertProject(db, 'default', '～/Code/demo-project/', 'demo')

        expect(project.path).toBe(expectedPath)
        expect(getProjectsByNamespace(db, 'default')).toEqual([
            expect.objectContaining({
                path: expectedPath,
                name: 'demo'
            })
        ])
    })

    it('deduplicates existing alias paths that resolve to the same project', () => {
        const db = createProjectsDb()
        const canonicalPath = join(homedir(), 'Code', 'dup-project')

        db.prepare(`
            INSERT INTO projects (id, namespace, path, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('project-1', 'default', '~/Code/dup-project', null, 1, 10)
        db.prepare(`
            INSERT INTO projects (id, namespace, path, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('project-2', 'default', canonicalPath, 'duplicate', 2, 20)

        const projects = getProjectsByNamespace(db, 'default')

        expect(projects).toEqual([
            {
                id: 'project-2',
                namespace: 'default',
                path: canonicalPath,
                name: 'duplicate',
                createdAt: 2,
                updatedAt: 20
            }
        ])
    })
})
