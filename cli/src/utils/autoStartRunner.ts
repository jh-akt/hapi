import { isRunnerRunningCurrentlyInstalledHappyVersion } from '@/runner/controlClient'
import { logger } from '@/ui/logger'
import { spawnHappyCLI } from '@/utils/spawnHappyCLI'

const RUNNER_STARTUP_SETTLE_MS = 200

export async function maybeAutoStartRunner(): Promise<void> {
    logger.debug('Ensuring hapi background service is running & matches our version...')

    if (await isRunnerRunningCurrentlyInstalledHappyVersion()) {
        return
    }

    logger.debug('Starting hapi background service...')

    const runnerProcess = spawnHappyCLI(['runner', 'start-sync'], {
        detached: true,
        stdio: 'ignore',
        env: process.env
    })
    runnerProcess.unref()

    await new Promise((resolve) => setTimeout(resolve, RUNNER_STARTUP_SETTLE_MS))
}
