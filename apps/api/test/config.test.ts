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
