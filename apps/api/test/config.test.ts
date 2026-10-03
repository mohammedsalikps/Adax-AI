import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

describe('loadConfig', () => {
  it('requires DB_APP_PASSWORD', () => {
    expect(() => loadConfig({})).toThrow(/DB_APP_PASSWORD/)
  })

  it('applies defaults for local development', () => {
    const c = loadConfig({ DB_APP_PASSWORD: 'x' })
    expect(c.api).toEqual({ host: '127.0.0.1', port: 4000 })
    expect(c.db).toMatchObject({ host: '127.0.0.1', port: 5433, name: 'adaxai', appUser: 'adaxai_app' })
    expect(c.thermalUrl).toBe('http://127.0.0.1:8001')
  })

  it('says what the data is: synthetic by default in development, and stated explicitly in production', () => {
    expect(loadConfig({ DB_APP_PASSWORD: 'x' }).dataOrigin).toBe('synthetic')
    // An unset variable must not label real records as synthetic.
    expect(() => loadConfig({ DB_APP_PASSWORD: 'x', NODE_ENV: 'production' })).toThrow(/DATA_ORIGIN/)
    expect(loadConfig({ DB_APP_PASSWORD: 'x', NODE_ENV: 'production', DATA_ORIGIN: 'clinical' }).dataOrigin).toBe('clinical')
    expect(loadConfig({ DB_APP_PASSWORD: 'x', NODE_ENV: 'production', DATA_ORIGIN: 'synthetic' }).dataOrigin).toBe('synthetic')
  })

  it('rejects invalid values and never echoes secrets', () => {
    const secret = 'super-secret-value-123'
    let message = ''
    try {
      loadConfig({ DB_APP_PASSWORD: secret, API_PORT: '99999', DB_NAME: 'Robert"; DROP' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/API_PORT/)
    expect(message).toMatch(/DB_NAME/)
    expect(message).not.toContain(secret)
  })
})

describe('test isolation from real AI providers', () => {
  it('the test configuration never carries provider keys, whatever .env contains', async () => {
    const { testConfig, createTestApp } = await import('./helpers.ts')
    expect(testConfig.ai.anthropicApiKey).toBeUndefined()
    expect(testConfig.ai.speech).toEqual({ provider: 'none', url: undefined, allowNonLoopback: false })
    const ctx = createTestApp()
    try {
      const { providersFromConfig } = await import('../src/ai/providers.ts')
      const { loadAppSettings } = await import('../src/settings/load.ts')
      const p = providersFromConfig(testConfig, loadAppSettings())
      expect([p.drafter, p.recommender, p.describer, p.qa, p.transcriber]).toEqual([null, null, null, null, null])
      // The important-points extractor is a rule set that runs in this process: always there, never a provider call.
      expect(p.extractor).toMatchObject({ provider: 'adaxai-rules', local: true })
    } finally {
      await ctx.close()
    }
  })
})
