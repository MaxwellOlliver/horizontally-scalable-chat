import { createApp } from './app.js'
import { loadEnv } from './config/env.js'
import { createContainer } from './composition-root.js'

const env = loadEnv()
const { useCases, db } = await createContainer(env)

const app = createApp(useCases).listen(env.PORT, () => {
  console.log(`🔐 auth-service listening on port ${env.PORT}`)
})

const shutdown = async () => {
  await app.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
