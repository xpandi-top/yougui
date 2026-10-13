import { cleanupOrphans, createApp } from './app.ts'
import { D1Store } from './d1.ts'
import { R2FileStore } from './r2.ts'

export interface Env {
  DB: D1Database
  FILES: R2Bucket
  ALLOWED_ORIGINS?: string
  SETUP_SECRET?: string
  MAX_FILE_BYTES?: string
  QUOTA_BYTES?: string
  /** 可选：upcdatabase.org API key（wrangler secret put UPCDATABASE_KEY） */
  UPCDATABASE_KEY?: string
}

function build(env: Env) {
  const store = new D1Store(env.DB)
  const files = new R2FileStore(env.FILES)
  const app = createApp({
    store,
    files,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    setupSecret: env.SETUP_SECRET || undefined,
    maxFileBytes: Number(env.MAX_FILE_BYTES) || 20 * 1024 * 1024,
    quotaBytes: Number(env.QUOTA_BYTES) || 5 * 1024 ** 3,
    upcdatabaseKey: env.UPCDATABASE_KEY || undefined,
  })
  return { app, store, files }
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return build(env).app.fetch(req, env, ctx)
  },
  async scheduled(_event: ScheduledController, env: Env) {
    const { store, files } = build(env)
    const n = await cleanupOrphans(store, files, Date.now())
    if (n) console.log(`cleaned ${n} orphan files`)
  },
} satisfies ExportedHandler<Env>
