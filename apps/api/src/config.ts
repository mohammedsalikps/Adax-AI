import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import pkg from '../package.json' with { type: 'json' }

export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(API_ROOT, '..', '..')

/** Loads the repo-root `.env` into process.env without overriding values already set. */
export function loadDotEnv(file = path.join(REPO_ROOT, '.env')): void {
  if (fs.existsSync(file)) process.loadEnvFile(file)
}

const port = z.coerce.number().int().min(1).max(65535)
const identifier = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'must be a lowercase SQL identifier')

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: port.default(4000),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: port.default(5433),
  DB_NAME: identifier.default('adaxai'),
  DB_TEST_NAME: identifier.default('adaxai_test'),
  DB_APP_USER: identifier.default('adaxai_app'),
  DB_APP_PASSWORD: z.string().min(1, 'is required (run `npm run setup`)'),
  DB_ADMIN_USER: identifier.default('adaxai_admin'),
  DB_ADMIN_PASSWORD: z.string().optional(),
  THERMAL_URL: z.url().default('http://127.0.0.1:8001'),
  /** Origin recorded on thermal images, clinical images and AI jobs. Only a real clinical deployment sets `clinical`. */
  DATA_ORIGIN: z.enum(['clinical', 'synthetic']).default('synthetic'),
  /** Defaults to true in production; local HTTP development needs false. */
  COOKIE_SECURE: z.enum(['true', 'false', '']).optional(),
  STORAGE_DIR: z.string().min(1).default('storage'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
  /** AI note drafting (Claude). Unset = the feature reports itself unavailable. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  /** Optional overrides of config/adaxai.yaml (ai.llm.model, ai.stt.*). */
  AI_NOTE_MODEL: z.string().optional().transform((v) => v || undefined),
  /** Speech-to-text via an OpenAI-compatible /audio/transcriptions endpoint. Unset key = unavailable. */
  AI_STT_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  AI_STT_BASE_URL: z.union([z.url(), z.literal('')]).optional().transform((v) => v || undefined),
  AI_STT_MODEL: z.string().optional().transform((v) => v || undefined),
  AI_STT_PROVIDER_NAME: z.string().optional().transform((v) => v || undefined),
})

export interface DbConfig {
  host: string
  port: number
  name: string
  testName: string
  appUser: string
  appPassword: string
  adminUser: string
  adminPassword: string | undefined
}

export interface Config {
  env: 'development' | 'test' | 'production'
  version: string
  api: { host: string; port: number }
  db: DbConfig
  thermalUrl: string
  dataOrigin: 'clinical' | 'synthetic'
  cookieSecure: boolean
  /** Absolute path for uploaded files (git-ignored). */
  storageDir: string
  maxUploadBytes: number
  ai: {
    anthropicApiKey: string | undefined
    /** Env overrides; undefined means "use config/adaxai.yaml". */
    noteModel: string | undefined
    stt: { apiKey: string | undefined; baseUrl: string | undefined; model: string | undefined; providerName: string | undefined }
  }
}

/** Validates the environment. Error messages name variables, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  const e = parsed.data
  return {
    env: e.NODE_ENV,
    version: pkg.version,
    api: { host: e.API_HOST, port: e.API_PORT },
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      name: e.DB_NAME,
      testName: e.DB_TEST_NAME,
      appUser: e.DB_APP_USER,
      appPassword: e.DB_APP_PASSWORD,
      adminUser: e.DB_ADMIN_USER,
      adminPassword: e.DB_ADMIN_PASSWORD || undefined,
    },
    thermalUrl: e.THERMAL_URL.replace(/\/+$/, ''),
    dataOrigin: e.DATA_ORIGIN,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
    storageDir: path.resolve(REPO_ROOT, e.STORAGE_DIR),
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    ai: {
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      noteModel: e.AI_NOTE_MODEL,
      stt: { apiKey: e.AI_STT_API_KEY, baseUrl: e.AI_STT_BASE_URL?.replace(/\/+$/, ''), model: e.AI_STT_MODEL, providerName: e.AI_STT_PROVIDER_NAME },
    },
  }
}
