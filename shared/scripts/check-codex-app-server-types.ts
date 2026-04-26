import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const expectedDir = join(import.meta.dir, '..', 'src', 'generated', 'app-server')
const tempRoot = await mkdtemp(join(tmpdir(), 'hapi-codex-app-server-'))
const actualDir = join(tempRoot, 'app-server')

try {
    const generate = Bun.spawn([
        'codex',
        'app-server',
        'generate-ts',
        '--experimental',
        '--out',
        actualDir
    ], {
        stdout: 'inherit',
        stderr: 'inherit'
    })

    const generateExit = await generate.exited
    if (generateExit !== 0) {
        throw new Error(`codex app-server generate-ts failed with exit code ${generateExit}`)
    }

    const diff = Bun.spawn(['diff', '-qr', expectedDir, actualDir], {
        stdout: 'inherit',
        stderr: 'inherit'
    })
    const diffExit = await diff.exited
    if (diffExit !== 0) {
        throw new Error('Generated Codex app-server protocol types are out of date')
    }
} finally {
    await rm(tempRoot, { recursive: true, force: true })
}
