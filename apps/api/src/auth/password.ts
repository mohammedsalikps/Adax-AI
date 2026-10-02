import { hash, verify } from '@node-rs/argon2'

// Argon2id with the library defaults (m=19456 KiB, t=2, p=1), which match the
// OWASP minimum recommendation.
export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

let dummy: Promise<string> | undefined
/** A real hash to verify against when the user does not exist, so timing does not reveal valid usernames. */
export function dummyHash(): Promise<string> {
  dummy ??= hash('adaxai-timing-equaliser')
  return dummy
}
