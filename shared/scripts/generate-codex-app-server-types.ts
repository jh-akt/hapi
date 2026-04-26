import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = join(import.meta.dir, '..', 'src', 'generated', 'app-server')

await rm(outDir, { recursive: true, force: true })

const proc = Bun.spawn([
    'codex',
    'app-server',
    'generate-ts',
    '--experimental',
    '--out',
    outDir
], {
    stdout: 'inherit',
    stderr: 'inherit'
})

const exitCode = await proc.exited
if (exitCode !== 0) {
    throw new Error(`codex app-server generate-ts failed with exit code ${exitCode}`)
}
