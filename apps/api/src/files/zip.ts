import zlib from 'node:zlib'

/**
 * Minimal ZIP writer (deflate, UTF-8 names, no ZIP64): enough for dataset
 * exports well under 4 GB. Readers: Python `zipfile`, 7-Zip, Windows Explorer.
 */
export function createZip(entries: { name: string; data: Buffer }[], date = new Date()): Buffer {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    if (!/^[\w./-]+$/.test(e.name) || e.name.startsWith('/') || e.name.split('/').includes('..')) throw new Error(`unsafe zip entry name ${e.name}`)
    const name = Buffer.from(e.name, 'utf8')
    const deflated = zlib.deflateRawSync(e.data)
    const crc = zlib.crc32(e.data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4) // version needed
    head.writeUInt16LE(0x0800, 6) // UTF-8 names
    head.writeUInt16LE(8, 8) // deflate
    head.writeUInt16LE(dosTime, 10)
    head.writeUInt16LE(dosDate, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(deflated.length, 18)
    head.writeUInt32LE(e.data.length, 22)
    head.writeUInt16LE(name.length, 26)
    head.writeUInt16LE(0, 28)
    locals.push(head, name, deflated)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(dosTime, 12)
    dir.writeUInt16LE(dosDate, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(deflated.length, 20)
    dir.writeUInt32LE(e.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += head.length + name.length + deflated.length
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  if (offset + centralSize > 0xffffffff || entries.length > 0xffff) throw new Error('zip too large for this writer')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}
