import { createApp } from './app.js'
import { loadEnv } from './config/env.js'
import { createContainer } from './composition-root.js'

const env = loadEnv()
const container = createContainer(env)

const app = createApp(container.useCases, container.verifier).listen(env.PORT, () => {
  console.log(`👥 social-service listening on port ${env.PORT}`)
})

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return // a second SIGINT/SIGTERM while we're already closing
  shuttingDown = true
  try {
    // Elysia's node adapter can throw "Elysia isn't running" from stop(); the
    // listener is torn down on exit regardless, so this is safe to ignore.
    await app.stop()
  } catch {
    /* already stopped */
  }
  await container.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
