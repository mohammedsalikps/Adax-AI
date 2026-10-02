import net from 'node:net'
import { type Config, loadConfig, loadDotEnv } from '../src/config.ts'

loadDotEnv()
const base = loadConfig()

/** Same settings as development, pointed at the dedicated test database. */
export const testConfig: Config = { ...base, env: 'test', db: { ...base.db, name: base.db.testName } }

/** A localhost port with nothing listening on it (connections are refused). */
export async function closedPort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address() as net.AddressInfo
  await new Promise<void>((resolve) => srv.close(() => resolve()))
  return port
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
