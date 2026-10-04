import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pinnedLocalModel } from '../src/ai/providers.ts'
import { llmUrlProblem } from '../src/ai/llm/local.ts'
import { REPO_ROOT } from '../src/config.ts'
import { loadAppSettings } from '../src/settings/load.ts'

// What the local language model is, where it came from and how it is started, checked from the files in the repository (no download, no model, no
// network). The lock files pin exact bytes; the launcher is the only thing that downloads anything; the server it starts must be closed in on the
// computer it runs on.

const read = (...p: string[]) => fs.readFileSync(path.join(REPO_ROOT, ...p), 'utf8')
const model = JSON.parse(read('services', 'llm', 'models.lock.json'))
const runtime = JSON.parse(read('services', 'llm', 'runtime.lock.json'))
const launcher = read('scripts', 'llm.mjs')
const HEX64 = /^[0-9a-f]{64}$/
const HEX40 = /^[0-9a-f]{40}$/

describe('the pinned model', () => {
  it('names one exact file: a revision, a size and a SHA-256, from a URL that carries that revision', () => {
    expect(model.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    expect(model.revision).toMatch(HEX40)
    expect(model.file.sha256).toMatch(HEX64)
    expect(Number.isInteger(model.file.bytes) && model.file.bytes > 1e9).toBe(true)
    expect(model.file.url).toBe(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file.name}`)
    expect(model.license).toBe('Apache-2.0')
    expect(model.alias).toMatch(/^[a-z0-9._-]+$/)
  })

  it('is what a run records: the alias, the weights hash and the runtime come from the lock files', () => {
    expect(pinnedLocalModel()).toEqual({ alias: model.alias, weightsSha256: model.file.sha256, runtime: `${runtime.name} ${runtime.release}` })
  })
})

describe('the pinned runtime', () => {
  it('names one release and, for every platform, one exact archive: a size and a SHA-256, from a URL that carries the release', () => {
    expect(runtime.release).toMatch(/^b\d+$/)
    expect(runtime.commit).toMatch(HEX40)
    expect(runtime.license).toBe('MIT')
    expect(Object.keys(runtime.assets).length).toBeGreaterThan(0)
    for (const [platform, a] of Object.entries(runtime.assets) as [string, { name: string; url: string; bytes: number; sha256: string; server: string }][]) {
      expect(a.sha256, platform).toMatch(HEX64)
      expect(Number.isInteger(a.bytes) && a.bytes > 1e6, platform).toBe(true)
      expect(a.url, platform).toBe(`https://github.com/ggml-org/llama.cpp/releases/download/${runtime.release}/${a.name}`)
      expect(a.server, platform).toMatch(/^llama-server(\.exe)?$/)
    }
  })
})

/** What the launcher WOULD run (nothing is started): its arguments and the names of the environment it would hand over. */
function dryRun(extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'llm.mjs'), 'dev', '--dry-run'], { env: { ...process.env, ...extraEnv }, encoding: 'utf8' })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

describe('the launcher, run without starting anything', () => {
  it('would start the server closed in: offline, no web page, no slot endpoints, one request at a time, a browser origin that cannot exist, loopback only', () => {
    const r = dryRun()
    expect(r.status, r.err).toBe(0)
    const plan = JSON.parse(r.out.trim().split('\n').at(-1)!) as { args: string[]; host: string; env: string[] }
    for (const flag of ['--offline', '--no-webui', '--no-slots', '--jinja']) expect(plan.args, flag).toContain(flag)
    const value = (flag: string) => plan.args[plan.args.indexOf(flag) + 1]
    expect(value('--host')).toBe('127.0.0.1')
    expect(plan.host).toBe('127.0.0.1')
    expect(value('--parallel')).toBe('1')
    expect(value('--reasoning')).toBe('off')
    // Nothing of a request is kept for the next one: an answer depends on its prompt alone, and no earlier patient's prompt stays in the server's memory.
    for (const flag of ['--no-cache-prompt', '--no-cache-idle-slots']) expect(plan.args, flag).toContain(flag)
    expect(value('--cache-ram')).toBe('0')
    expect(value('--ctx-checkpoints')).toBe('0')
    expect(value('--cors-origins')).toMatch(/\.invalid$/)
    // Nothing that makes the server fetch a model or listen widely.
    for (const flag of ['--hf-repo', '--hf-file', '-hf', '--model-url', '--docker-repo']) expect(plan.args, flag).not.toContain(flag)
    expect(plan.args.join(' ')).not.toContain('0.0.0.0')
  })

  it('would hand it only what a program needs and the secret: none of the application’s passwords or keys, even when they are in the environment', () => {
    const r = dryRun({ DB_APP_PASSWORD: 'x-secret-1', DB_ADMIN_PASSWORD: 'x-secret-2', ANTHROPIC_API_KEY: 'x-secret-3', SESSION_SECRET: 'x-secret-4', AI_STT_API_KEY: 'x-secret-5', LLM_API_KEY: 'x-secret-6' })
    const plan = JSON.parse(r.out.trim().split('\n').at(-1)!) as { env: string[] }
    expect(plan.env).toContain('LLAMA_API_KEY')
    for (const name of ['DB_APP_PASSWORD', 'DB_ADMIN_PASSWORD', 'ANTHROPIC_API_KEY', 'SESSION_SECRET', 'AI_STT_API_KEY', 'LLM_API_KEY']) expect(plan.env, name).not.toContain(name)
    // And the plan itself carries no value of the environment.
    expect(r.out).not.toMatch(/x-secret-/)
  })

  it('refuses another address unless an operator allows it on purpose, in either spelling of yes', () => {
    expect(dryRun({ LLM_HOST: '0.0.0.0' }).status).toBe(1)
    expect(dryRun({ LLM_HOST: '0.0.0.0' }).err).toMatch(/not a loopback address/)
    for (const yes of ['1', 'true']) expect(dryRun({ LLM_HOST: '0.0.0.0', LLM_ALLOW_NON_LOOPBACK: yes }).status, yes).toBe(0)
  })
})

describe('the launcher’s source', () => {
  it('starts the server closed in: offline, without a web page or slot endpoints, one request at a time, reachable only with the secret, from a browser nowhere', () => {
    for (const flag of ["'--offline'", "'--no-webui'", "'--no-slots'", "'--cors-origins'", "'--parallel', '1'", "'--reasoning', 'off'", "'--no-cache-prompt'", "'--cache-ram', '0'"]) expect(launcher, flag).toContain(flag)
    expect(launcher).toContain('LLAMA_API_KEY')
    // The secret is made with the owner-only file mode, and is never printed.
    expect(launcher).toContain('0o600')
    expect(launcher).not.toMatch(/console\.log\([^)]*\bkey\b/i)
    // It listens on this computer unless an operator says otherwise on purpose.
    expect(launcher).toMatch(/const HOST = e\.LLM_HOST \|\| '127\.0\.0\.1'/)
    expect(launcher).toContain('LLM_ALLOW_NON_LOOPBACK')
  })

  it('never lets the server download anything or listen widely, and gives it only an allow-listed environment (no database passwords, no provider keys)', () => {
    for (const flag of ['--hf-repo', '--hf-file', '-hf', '--model-url', '--docker-repo', '0.0.0.0']) expect(launcher, flag).not.toContain(flag)
    expect(launcher).toContain('ENV_ALLOW')
    const allow = /const ENV_ALLOW = (\/[^\n]+\/i)/.exec(launcher)![1]!
    for (const secret of ['DB_APP_PASSWORD', 'DB_ADMIN_PASSWORD', 'ANTHROPIC_API_KEY', 'SESSION_SECRET', 'AI_STT_API_KEY']) expect(new RegExp(allow.slice(1, -2), 'i').test(secret), secret).toBe(false)
  })

  it('is the only thing that downloads: the application code never fetches a model', () => {
    const api = fs.readdirSync(path.join(REPO_ROOT, 'apps', 'api', 'src', 'consult')).map((f) => read('apps', 'api', 'src', 'consult', f)).join('\n')
    expect(api).not.toMatch(/huggingface|github\.com|\.gguf/i)
    expect(read('apps', 'api', 'src', 'ai', 'llm', 'local.ts')).not.toMatch(/huggingface|github\.com|\.gguf/i)
  })

  it('keeps what it downloads out of git', () => {
    expect(read('.gitignore')).toMatch(/^\.data\/?$/m)
  })
})

describe('the shipped settings', () => {
  it('choose the local model on this computer, with hosted egress off', () => {
    const s = loadAppSettings()
    expect(s.ai.reasoning.provider).toBe('local')
    expect(llmUrlProblem(s.ai.reasoning.url, false)).toBeNull()
    expect(s.ai.egress.hostedProviders).toBe(false)
    expect(s.ai.features.consultationDraft).toBe(true)
  })

  it('the example environment file holds no secret for it', () => {
    const lines = read('.env.example').split('\n').filter((l) => l.startsWith('LLM_'))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines.filter((x) => /KEY/.test(x))) expect(l, l).toMatch(/=\s*$/)
  })
})
