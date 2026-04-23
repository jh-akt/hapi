import type { Database } from 'bun:sqlite'

import type { StoredProject } from './types'
import { getProjectsByNamespace, upsertProject } from './projects'

export class ProjectStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getProjectsByNamespace(namespace: string): StoredProject[] {
        return getProjectsByNamespace(this.db, namespace)
    }

    upsertProject(namespace: string, path: string, name?: string): StoredProject {
        return upsertProject(this.db, namespace, path, name)
    }
}
