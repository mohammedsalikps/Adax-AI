import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface StoredFile {
  storageKey: string
  sha256: string
  sizeBytes: number
}

/** Writes bytes under STORAGE_DIR/yyyy/mm/<uuid><ext>. Never overwrites. */
export async function storeBytes(storageDir: string, data: Buffer, ext: string): Promise<StoredFile> {
  const now = new Date()
  const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : ''
  const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${safeExt}`
  const full = resolveStoragePath(storageDir, storageKey)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, data, { flag: 'wx' })
  return { storageKey, sha256: crypto.createHash('sha256').update(data).digest('hex'), sizeBytes: data.length }
}

/** Absolute path for a storage key; refuses anything that would escape STORAGE_DIR. */
export function resolveStoragePath(storageDir: string, storageKey: string): string {
  const root = path.resolve(storageDir)
  const full = path.resolve(root, storageKey)
  if (!full.startsWith(root + path.sep)) throw new Error('storage key escapes storage directory')
  return full
}

export const readStoredBytes = (storageDir: string, storageKey: string) => fs.readFile(resolveStoragePath(storageDir, storageKey))
